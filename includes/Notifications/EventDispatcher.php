<?php
/**
 * DiscussionTools event dispatcher
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Notifications;

use EchoEvent;
use Error;
use IDBAccessObject;
use Iterator;
use MediaWiki\Extension\DiscussionTools\CommentItem;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\Extension\DiscussionTools\HeadingItem;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Extension\DiscussionTools\SubscriptionItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem;
use MediaWiki\MediaWikiServices;
use MediaWiki\Page\PageIdentity;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\User\UserIdentity;
use ParserOptions;
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

		$pageRecord = $services->getPageStore()->getPageByReference( $revRecord->getPage() );
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

		if ( $oldRevRecord === null ) {
			// TODO: Handle page creation (oldRevRecord = null?)
			return;
		}

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

		$oldParser = self::getParsedRevision( $oldRevRecord );
		$newParser = self::getParsedRevision( $newRevRecord );

		self::generateEventsFromParsers( $events, $oldParser, $newParser, $newRevRecord, $title, $user );
	}

	/**
	 * For each top-level heading, get a list of comments in the thread grouped by names, then IDs.
	 * (Compare by name first, as ID could be changed by a parent comment being moved/deleted.)
	 *
	 * @param ThreadItem[] $items
	 * @return CommentItem[][][]
	 */
	private static function groupCommentsByThreadAndName( array $items ): array {
		$comments = [];
		$threadName = null;
		foreach ( $items as $item ) {
			if ( $item instanceof HeadingItem && ( $item->getHeadingLevel() <= 2 || $item->isPlaceholderHeading() ) ) {
				$threadName = $item->getName();
			} elseif ( $item instanceof CommentItem ) {
				Assert::invariant( $threadName !== null, 'Comments are always preceded by headings' );
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
		foreach ( $events as $event ) {
			if ( $event['type'] === 'mention' || $event['type'] === 'mention-summary' ) {
				// Array is keyed by user id so we can do a simple array merge
				$mentionedUsers += $event['extra']['mentioned-users'];
			}
		}

		foreach ( $addedComments as $newComment ) {
			// Ignore comments by other users, e.g. in case of reverts or a discussion being moved.
			// TODO: But what about someone signing another's comment?
			if ( $newComment->getAuthor() !== $user->getName() ) {
				continue;
			}
			$heading = $newComment->getHeading();
			// Find a level 2 heading, because the interface doesn't allow subscribing to other headings.
			// (T286736)
			while ( $heading instanceof HeadingItem && $heading->getHeadingLevel() !== 2 ) {
				$heading = $heading->getParent();
			}
			if ( !( $heading instanceof HeadingItem ) ) {
				continue;
			}
			// Check if the name corresponds to a section that contain no comments (only sub-sections).
			// The interface doesn't allow subscribing to them either, because they can't be distinguished
			// from each other. (T285796)
			if ( $heading->getName() === 'h-' ) {
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
					'section-title' => $heading->getText(),
					'revid' => $newRevRecord->getId(),
					'mentioned-users' => $mentionedUsers,
				],
				'agent' => $user,
			];
		}
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
			1
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

}
