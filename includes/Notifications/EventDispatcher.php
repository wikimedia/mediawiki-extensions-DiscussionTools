<?php
/**
 * DiscussionTools event dispatcher
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Notifications;

use ChangeTags;
use DeferredUpdates;
use EchoEvent;
use Error;
use ExtensionRegistry;
use IDBAccessObject;
use Iterator;
use MediaWiki\Extension\DiscussionTools\CommentItem;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\Extension\DiscussionTools\HeadingItem;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Extension\DiscussionTools\SubscriptionItem;
use MediaWiki\Extension\DiscussionTools\SubscriptionStore;
use MediaWiki\Extension\DiscussionTools\ThreadItem;
use MediaWiki\MediaWikiServices;
use MediaWiki\Page\PageIdentity;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\User\UserIdentity;
use ParserOptions;
use RequestContext;
use Title;
use Wikimedia\Assert\Assert;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

class EventDispatcher {
	/**
	 * @param RevisionRecord $revRecord
	 * @return CommentParser
	 */
	private static function getParsedRevision( RevisionRecord $revRecord ): CommentParser {
		$services = MediaWikiServices::getInstance();

		$pageRecord = $services->getPageStore()->getPageByReference( $revRecord->getPage() ) ?:
			$services->getPageStore()->getPageByReference( $revRecord->getPage(), IDBAccessObject::READ_LATEST );

		Assert::postcondition( $pageRecord !== null, 'Revision had no page' );

		// If the $revRecord was fetched from the primary database, this will also fetch the content
		// from the primary database (using the same query flags)
		$status = $services->getParserOutputAccess()->getParserOutput(
			$pageRecord,
			ParserOptions::newCanonical( 'canonical' ),
			$revRecord
		);
		if ( !$status->isOK() ) {
			throw new Error( 'Could not load revision for notifications' );
		}

		$parserOutput = $status->getValue();
		$html = $parserOutput->getText();

		$doc = DOMUtils::parseHTML( $html );
		$container = DOMCompat::getBody( $doc );
		return CommentParser::newFromGlobalState( $container );
	}

	/**
	 * @param array &$events
	 * @param RevisionRecord $newRevRecord
	 */
	public static function generateEventsForRevision( array &$events, RevisionRecord $newRevRecord ) {
		$services = MediaWikiServices::getInstance();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		if ( !$dtConfig->get( 'DiscussionToolsEnableTopicSubscriptionBackend' ) ) {
			// Feature disabled for all users
			return;
		}

		$revisionStore = $services->getRevisionStore();
		$userFactory = $services->getUserFactory();
		$oldRevRecord = $revisionStore->getPreviousRevision( $newRevRecord, IDBAccessObject::READ_LATEST );

		$title = Title::newFromLinkTarget(
			$newRevRecord->getPageAsLinkTarget()
		);
		if ( !HookUtils::isAvailableForTitle( $title ) ) {
			// Not a talk page
			return;
		}

		$user = $newRevRecord->getUser();
		if ( !$user ) {
			// User can be null if the user is deleted, but this is unlikely
			// to be the case if the user just made an edit
			return;
		}

		if ( $oldRevRecord !== null ) {
			$oldParser = self::getParsedRevision( $oldRevRecord );
		} else {
			// Page creation
			$doc = DOMUtils::parseHTML( '' );
			$container = DOMCompat::getBody( $doc );
			$oldParser = CommentParser::newFromGlobalState( $container );
		}
		$newParser = self::getParsedRevision( $newRevRecord );

		self::generateEventsFromParsers( $events, $oldParser, $newParser, $newRevRecord, $title, $user );
	}

	/**
	 * For each level 2 heading, get a list of comments in the thread grouped by names, then IDs.
	 * (Compare by name first, as ID could be changed by a parent comment being moved/deleted.)
	 * Comments in level 3+ sub-threads are grouped together with the parent thread.
	 *
	 * For any other headings (including level 3+ before the first level 2 heading, level 1, and
	 * section zero placeholder headings), ignore comments in those threads.
	 *
	 * @param ThreadItem[] $items
	 * @return CommentItem[][][]
	 */
	private static function groupCommentsByThreadAndName( array $items ): array {
		$comments = [];
		$threadName = null;
		foreach ( $items as $item ) {
			if ( $item instanceof HeadingItem && ( $item->getHeadingLevel() < 2 || $item->isPlaceholderHeading() ) ) {
				$threadName = null;
			} elseif ( $item instanceof HeadingItem && $item->getHeadingLevel() === 2 ) {
				$threadName = $item->getName();
			} elseif ( $item instanceof CommentItem && $threadName !== null ) {
				$comments[ $threadName ][ $item->getName() ][ $item->getId() ] = $item;
			}
		}
		return $comments;
	}

	/**
	 * Helper for generateEventsForRevision(), separated out for easier testing.
	 *
	 * @param array &$events
	 * @param CommentParser $oldParser
	 * @param CommentParser $newParser
	 * @param RevisionRecord $newRevRecord
	 * @param PageIdentity $title
	 * @param UserIdentity $user
	 */
	protected static function generateEventsFromParsers(
		array &$events,
		CommentParser $oldParser,
		CommentParser $newParser,
		RevisionRecord $newRevRecord,
		PageIdentity $title,
		UserIdentity $user
	) {
		$newComments = self::groupCommentsByThreadAndName( $newParser->getThreadItems() );
		$oldComments = self::groupCommentsByThreadAndName( $oldParser->getThreadItems() );
		$addedComments = [];

		foreach ( $newComments as $threadName => $threadNewComments ) {
			foreach ( $threadNewComments as $commentName => $nameNewComments ) {
				// Usually, there will be 0 or 1 $nameNewComments, and 0 $nameOldComments,
				// and $addedCount will be 0 or 1.
				//
				// But when multiple replies are added in one edit, or in multiple edits within the same
				// minute, there may be more, and the complex logic below tries to make the best guess
				// as to which comments are actually new. See the 'multiple' and 'sametime' test cases.
				//
				$nameOldComments = $oldComments[ $threadName ][ $commentName ] ?? [];
				$addedCount = count( $nameNewComments ) - count( $nameOldComments );

				if ( $addedCount > 0 ) {
					// For any name that occurs more times in new than old, report that many new comments,
					// preferring IDs that did not occur in old, then preferring comments lower in the thread.
					foreach ( array_reverse( $nameNewComments ) as $commentId => $newComment ) {
						if ( $addedCount > 0 && !isset( $nameOldComments[ $commentId ] ) ) {
							$addedComments[] = $newComment;
							$addedCount--;
						}
					}
					foreach ( array_reverse( $nameNewComments ) as $commentId => $newComment ) {
						if ( $addedCount > 0 ) {
							$addedComments[] = $newComment;
							$addedCount--;
						}
					}
					Assert::postcondition( $addedCount === 0, 'Reported expected number of comments' );
				}
			}
		}

		$mentionedUsers = [];
		foreach ( $events as &$event ) {
			if ( $event['type'] === 'mention' || $event['type'] === 'mention-summary' ) {
				// Save mentioned users in our events, so that we can exclude them from our notification,
				// to avoid duplicate notifications for a single comment.
				// Array is keyed by user id so we can do a simple array merge.
				$mentionedUsers += $event['extra']['mentioned-users'];
			}

			if ( count( $addedComments ) === 1 ) {
				// If this edit was a new user talk message according to Echo,
				// and we also found exactly one new comment,
				// add some extra information to the edit-user-talk event.
				if ( $event['type'] === 'edit-user-talk' ) {
					$event['extra'] += [
						'comment-id' => $addedComments[0]->getId(),
						'comment-name' => $addedComments[0]->getName(),
						'content' => $addedComments[0]->getBodyText( true ),
					];
				}

				// Similarly for mentions.
				// We don't handle 'content' in this case, as Echo makes its own snippets.
				if ( $event['type'] === 'mention' ) {
					$event['extra'] += [
						'comment-id' => $addedComments[0]->getId(),
						'comment-name' => $addedComments[0]->getName(),
					];
				}
			}
		}

		if ( $addedComments ) {
			// It's a bit weird to do this here, in the middle of the hook handler for Echo. However:
			// * Echo calls this from a PageSaveComplete hook handler as a DeferredUpdate,
			//   which is exactly how we would do this otherwise
			// * It allows us to reuse the generated comment trees without any annoying caching
			static::addCommentChangeTag( $newRevRecord );
			// For very similar reasons, we do logging here
			static::logAddedComments( $addedComments, $newRevRecord, $title, $user );
		}

		foreach ( $addedComments as $newComment ) {
			// Ignore comments by other users, e.g. in case of reverts or a discussion being moved.
			// TODO: But what about someone signing another's comment?
			if ( $newComment->getAuthor() !== $user->getName() ) {
				continue;
			}
			$heading = $newComment->getSubscribableHeading();
			if ( !$heading ) {
				continue;
			}
			$events[] = [
				'type' => 'dt-subscribed-new-comment',
				'title' => $title,
				'extra' => [
					'subscribed-comment-name' => $heading->getName(),
					'comment-id' => $newComment->getId(),
					'comment-name' => $newComment->getName(),
					'content' => $newComment->getBodyText( true ),
					'section-title' => $heading->getLinkableTitle(),
					'revid' => $newRevRecord->getId(),
					'mentioned-users' => $mentionedUsers,
				],
				'agent' => $user,
			];
		}
	}

	/**
	 * Add our change tag for a revision that adds new comments.
	 *
	 * @param RevisionRecord $newRevRecord
	 */
	protected static function addCommentChangeTag( RevisionRecord $newRevRecord ) {
		// Unclear if DeferredUpdates::addCallableUpdate() is needed,
		// but every extension does it that way.
		DeferredUpdates::addCallableUpdate( static function () use ( $newRevRecord ) {
			ChangeTags::addTags( [ 'discussiontools-added-comment' ], null, $newRevRecord->getId() );
		} );
	}

	/**
	 * Return all users subscribed to a comment
	 *
	 * @param EchoEvent $event
	 * @param int $batchSize
	 * @return UserIdentity[]|Iterator<UserIdentity>
	 */
	public static function locateSubscribedUsers( EchoEvent $event, $batchSize = 500 ) {
		$commentName = $event->getExtraParam( 'subscribed-comment-name' );

		$subscriptionStore = MediaWikiServices::getInstance()->getService( 'DiscussionTools.SubscriptionStore' );
		$subscriptionItems = $subscriptionStore->getSubscriptionItemsForTopic(
			$commentName,
			SubscriptionStore::STATE_SUBSCRIBED
		);

		// Update notified timestamps
		$subscriptionStore->updateSubscriptionNotifiedTimestamp(
			null,
			$commentName
		);

		// TODD: Have this return an Iterator instead?
		$users = array_map( static function ( SubscriptionItem $item ) {
			return $item->getUserIdentity();
		}, $subscriptionItems );

		return $users;
	}

	/**
	 * Log stuff to EventLogging's Schema:TalkPageEvent
	 * If you don't have EventLogging installed, does nothing.
	 *
	 * @param array $addedComments
	 * @param RevisionRecord $newRevRecord
	 * @param PageIdentity $title
	 * @param UserIdentity $identity
	 * @return bool Whether events were logged
	 */
	protected static function logAddedComments( $addedComments, $newRevRecord, $title, $identity ) {
		global $wgDTSchemaEditAttemptStepOversample, $wgDBname;
		$request = RequestContext::getMain()->getRequest();
		// We've reached here through Echo's post-save deferredupdate, which
		// might either be after an API request from DiscussionTools or a
		// regular POST from WikiEditor. Both should have this value snuck
		// into their request if their session is being logged.
		if ( !$request->getVal( 'editingStatsId' ) ) {
			return false;
		}
		$editingStatsId = $request->getVal( 'editingStatsId' );

		$extensionRegistry = ExtensionRegistry::getInstance();
		if ( !$extensionRegistry->isLoaded( 'EventLogging' ) ) {
			return false;
		}
		$inSample = self::inEventSample( $editingStatsId );
		$shouldOversample = $wgDTSchemaEditAttemptStepOversample || (
			$extensionRegistry->isLoaded( 'WikimediaEvents' ) &&
			// @phan-suppress-next-line PhanUndeclaredClassMethod
			\WikimediaEvents\WikimediaEventsHooks::shouldSchemaEditAttemptStepOversample( RequestContext::getMain() )
		);
		if ( !$inSample && !$shouldOversample ) {
			return false;
		}

		$user = MediaWikiServices::getInstance()
			->getUserFactory()
			->newFromUserIdentity( $identity );

		$isDiscussionTools = (bool)$request->getVal( 'dttags' );

		foreach ( $addedComments as $comment ) {
			$heading = $comment->getSubscribableHeading();
			$parent = $comment->getParent();
			if ( !$heading || !$parent ) {
				continue;
			}
			$data = [
				'$schema' => '/analytics/mediawiki/talk_page_edit/1.0.0',
				'component_type' => $parent->getType() === 'heading' ? 'comment' : 'response',
				'topic_id' => $heading->getId(),
				'comment_id' => $comment->getId(),
				'comment_parent_id' => $parent->getId(),
				'action' => 'publish',
				'session_id' => $editingStatsId,
				'page_id' => $newRevRecord->getPageId(),
				'page_namespace' => $title->getNamespace(),
				'revision_id' => $newRevRecord->getId() ?: 0,
				'performer' => [
					'user_id' => $user->getId(),
					'user_edit_count' => $user->getEditCount() ?: 0,
					// Retention-safe values:
					'user_is_anonymous' => !$user->isRegistered(),
					'user_edit_count_bucket' => \UserBucketProvider::getUserEditCountBucket( $user ),
				],
				'database' => $wgDBname,
				// This is unreliable, but sufficient for our purposes; we
				// mostly just want to see the difference between DT and
				// everything-else:
				'integration' => $isDiscussionTools ? 'discussiontools' : 'page',
			];

			\EventLogging::submit( 'mediawiki.talk_page_edit', $data );
		}

		return true;
	}

	/**
	 * Should the current session be sampled for EventLogging?
	 *
	 * @param string $sessionId
	 * @return bool Whether to sample the session
	 */
	protected static function inEventSample( $sessionId ) {
		global $wgDTSchemaEditAttemptStepSamplingRate, $wgWMESchemaEditAttemptStepSamplingRate;
		// Sample 6.25%
		$samplingRate = 0.0625;
		if ( isset( $wgDTSchemaEditAttemptStepSamplingRate ) ) {
			$samplingRate = $wgDTSchemaEditAttemptStepSamplingRate;
		}
		if ( isset( $wgWMESchemaEditAttemptStepSamplingRate ) ) {
			$samplingRate = $wgWMESchemaEditAttemptStepSamplingRate;
		}
		if ( $samplingRate === 0 ) {
			return false;
		}
		$inSample = \EventLogging::sessionInSample(
			(int)( 1 / $samplingRate ), $sessionId
		);
		return $inSample;
	}

}
