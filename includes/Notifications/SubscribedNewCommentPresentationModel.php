<?php
/**
 * EchoEventPresentationModel for new comments in a subscribed section
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Notifications;

use EchoDiscussionParser;
use EchoEvent;
use EchoEventPresentationModel;
use EchoPresentationModelSection;
use Language;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionRecord;
use Message;
use RawMessage;
use User;

class SubscribedNewCommentPresentationModel extends EchoEventPresentationModel {

	/**
	 * @var EchoPresentationModelSection
	 */
	private $section;

	/**
	 * @inheritDoc
	 */
	protected function __construct( EchoEvent $event, Language $language, User $user, $distributionType ) {
		parent::__construct( $event, $language, $user, $distributionType );
		$this->section = new EchoPresentationModelSection( $event, $user, $language );
	}

	/**
	 * @inheritDoc
	 */
	public function getIconType() {
		return 'chat';
	}

	/**
	 * @inheritDoc
	 */
	public function canRender() {
		return (bool)$this->event->getTitle();
	}

	/**
	 * @inheritDoc
	 */
	public function getPrimaryLink() {
		return [
			'url' => $this->getCommentLink(),
			'label' => $this->msg( 'discussiontools-notification-subscribed-new-comment-view' )->text()
		];
	}

	/**
	 * @inheritDoc
	 */
	protected function getHeaderMessageKey() {
		if ( $this->isBundled() ) {
			return 'discussiontools-notification-subscribed-new-comment-header-bundled';
		} else {
			return 'discussiontools-notification-subscribed-new-comment-header';
		}
	}

	/**
	 * @inheritDoc
	 */
	public function getHeaderMessage() {
		if ( $this->isBundled() ) {
			$count = $this->getNotificationCountForOutput();
			$msg = $this->msg( $this->getHeaderMessageKey() );

			// Repeat is B/C until unused parameter is removed from translations
			$msg->numParams( $count, $count );
			$msg->plaintextParams( $this->section->getTruncatedSectionTitle() );
			return $msg;
		} else {
			$msg = parent::getHeaderMessage();
			$msg->params( $this->getTruncatedTitleText( $this->event->getTitle(), true ) );
			$msg->plaintextParams( $this->section->getTruncatedSectionTitle() );
			return $msg;
		}
	}

	/**
	 * @inheritDoc
	 */
	public function getCompactHeaderMessage() {
		$msg = $this->getMessageWithAgent( 'discussiontools-notification-subscribed-new-comment-header-compact' );
		$msg->plaintextParams( $this->getContentSnippet() );
		return $msg;
	}

	/**
	 * @inheritDoc
	 */
	public function getBodyMessage() {
		if ( !$this->isBundled() ) {
			return new RawMessage( '$1', [ Message::plaintextParam( $this->getContentSnippet() ) ] );
		}
	}

	/**
	 * Get a link to the individual comment, if available.
	 *
	 * @return string Full URL linking to the comment
	 */
	protected function getCommentLink() {
		$title = $this->event->getTitle();
		if ( !$this->userCan( RevisionRecord::DELETED_TEXT ) ) {
			return $title->getFullURL();
		}
		if ( !$this->isBundled() ) {
			// For a single-comment notification, make a pretty(ish) direct link to the comment.
			// The browser scrolls and we highlight it client-side.
			$id = $this->event->getExtraParam( 'comment-id' );
			return $title->createFragmentTarget( $id )->getFullURL();
		} else {
			// For a multi-comment notification, we can't make a direct link, because we don't know
			// which comment appears first on the page; the best we can do is a link to the section.
			// We handle both scrolling and highlighting client-side, using the ugly parameter
			// listing all comments.
			$id = $this->event->getExtraParam( 'section-title' );
			$bundledIds = [];
			$bundledIds[] = $this->event->getExtraParam( 'comment-id' );
			foreach ( $this->getBundledEvents() as $event ) {
				$bundledIds[] = $event->getExtraParam( 'comment-id' );
			}
			$params = [ 'dtnewcomments' => implode( '|', $bundledIds ) ];
			return $title->createFragmentTarget( $id )->getFullURL( $params );
		}
	}

	/**
	 * Get a snippet of the individual comment, if available.
	 *
	 * @return string The snippet, as plain text (may be empty)
	 */
	protected function getContentSnippet() {
		if ( !$this->userCan( RevisionRecord::DELETED_TEXT ) ) {
			return '';
		}
		$content = $this->event->getExtraParam( 'content' );
		return $this->language->truncateForVisual( $content, EchoDiscussionParser::DEFAULT_SNIPPET_LENGTH );
	}

	/**
	 * @inheritDoc
	 */
	public function getSecondaryLinks() {
		$title = $this->event->getTitle();

		$url = $title->getLocalURL( [
			'oldid' => 'prev',
			'diff' => $this->event->getExtraParam( 'revid' )
		] );
		$viewChangesLink = [
			'url' => $url,
			'label' => $this->msg( 'notification-link-text-view-changes', $this->getViewingUserForGender() )->text(),
			'description' => '',
			'icon' => 'changes',
			'prioritized' => true,
		];

		$links = [
			$this->getAgentLink(),
			$viewChangesLink,
		];

		$subscriptionStore = MediaWikiServices::getInstance()->getService( 'DiscussionTools.SubscriptionStore' );
		$items = $subscriptionStore->getSubscriptionItemsForUser(
			$this->getUser(),
			[ $this->event->getExtraParam( 'subscribed-comment-name' ) ]
		);
		$isSubscribed = count( $items ) && !$items[0]->isMuted();
		if ( $isSubscribed ) {
			$commentName = $this->event->getExtraParam( 'subscribed-comment-name' );
			$links[] = $this->getDynamicActionLink(
				$this->event->getTitle(),
				'bellOutline',
				$this->msg( 'discussiontools-topicsubscription-action-unsubscribe-button' )->text(),
				null,
				[
					'tokenType' => 'csrf',
					'params' => [
						'action' => 'discussiontoolssubscribe',
						'page' => $this->event->getTitle(),
						'commentname' => $commentName,
						// 'subscribe' is unset
					],
					'messages' => [
						'confirmation' => [
							'title' => $this->msg( 'discussiontools-topicsubscription-notify-unsubscribed-title' ),
							'description' => $this->msg( 'discussiontools-topicsubscription-notify-unsubscribed-body' )
						]
					]
				],
				[
					'action' => 'dtunsubscribe',
					'commentname' => $commentName,
				]
			);
		}

		return $links;
	}
}
