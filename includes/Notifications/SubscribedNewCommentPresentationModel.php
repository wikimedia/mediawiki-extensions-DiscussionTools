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
		return $this->isUserTalkPage() ? 'edit-user-talk' : 'chat';
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
		$title = $this->event->getTitle();
		$id = $this->event->getExtraParam( 'comment-id' );
		// TODO: Handle bundles
		return [
			// Need FullURL so the section is included
			'url' => $title->createFragmentTarget( $id )->getFullURL(),
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
			return new RawMessage( $this->getContentSnippet() );
		}
	}

	/**
	 * @return string
	 */
	protected function getContentSnippet() {
		$content = $this->event->getExtraParam( 'content' );
		return $this->language->truncateForVisual( $content, EchoDiscussionParser::DEFAULT_SNIPPET_LENGTH );
	}

	/**
	 * @return bool
	 */
	protected function isUserTalkPage() {
		// Would like to do $this->event->getTitle()->equals( $this->user->getTalkPage() )
		// but $this->user is private in the parent class
		$username = $this->getViewingUserForGender();
		return $this->event->getTitle()->getNamespace() === NS_USER_TALK &&
			$this->event->getTitle()->getText() === $username;
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

		// TODO: Add unsubscribe link

		return [ $this->getAgentLink(), $viewChangesLink ];
	}
}
