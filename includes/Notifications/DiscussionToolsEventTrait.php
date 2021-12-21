<?php
/**
 * Common code for all Echo event presentation models for DiscussionTools events.
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Notifications;

use EchoDiscussionParser;
use MediaWiki\Revision\RevisionRecord;
use WikiMap;

/**
 * This trait must be only used on EchoEventPresentationModel subclasses.
 *
 * @property \EchoEvent $event
 * @property \Language $language
 */
trait DiscussionToolsEventTrait {

	/**
	 * @param int $type RevisionRecord::DELETED_* constant
	 * @return bool
	 */
	abstract protected function userCan( $type );

	/**
	 * @return bool
	 */
	abstract protected function isBundled();

	/**
	 * @return \EchoEvent[]
	 */
	abstract protected function getBundledEvents();

	/**
	 * @return int[]|false
	 */
	abstract protected function getBundledIds();

	/**
	 * Get a link to the individual comment, if available.
	 *
	 * @return string|null Full URL linking to the comment, null if not available
	 */
	protected function getCommentLink(): ?string {
		if ( !$this->userCan( RevisionRecord::DELETED_TEXT ) ) {
			return null;
		}
		$title = $this->event->getTitle();
		if ( !$this->isBundled() ) {
			// For a single-comment notification, make a pretty(ish) direct link to the comment.
			// The browser scrolls and we highlight it client-side.
			$commentId = $this->event->getExtraParam( 'comment-id' );
			if ( !$commentId ) {
				return null;
			}
			return $title->createFragmentTarget( $commentId )->getFullURL();
		} else {
			// For a multi-comment notification, we can't make a direct link, because we don't know
			// which comment appears first on the page; the best we can do is a link to the section.
			// We handle both scrolling and highlighting client-side, using the ugly parameter
			// listing all comments.

			// Bundling works differently for different notification types:
			// * Subscribed topic notifications are bundled per-section.
			// * User talk page notifications are bundled per-page (so basically, always bundled).
			// * Mention notifications are *never* bundled.
			// Code below tries to avoid assumptions in case this behavior changes.

			$sectionTitles = [ $this->event->getExtraParam( 'section-title' ) ];
			$commentIds = [ $this->event->getExtraParam( 'comment-id' ) ];
			foreach ( $this->getBundledEvents() as $event ) {
				$sectionTitles[] = $event->getExtraParam( 'section-title' );
				$commentIds[] = $event->getExtraParam( 'comment-id' );
			}
			$commentIds = array_values( array_filter( $commentIds ) );
			$sectionTitles = array_values( array_unique( array_filter( $sectionTitles ) ) );
			if ( !$commentIds ) {
				return null;
			}
			$params = [ 'dtnewcomments' => implode( '|', $commentIds ) ];
			if ( count( $sectionTitles ) === 1 ) {
				return $title->createFragmentTarget( $sectionTitles[0] )->getFullURL( $params );
			} else {
				return $title->getFullURL( $params );
			}
		}
	}

	/**
	 * Get a snippet of the individual comment, if available.
	 *
	 * @return string The snippet, as plain text (may be empty)
	 */
	protected function getContentSnippet(): string {
		if ( !$this->userCan( RevisionRecord::DELETED_TEXT ) ) {
			return '';
		}
		// Note that we store plain text in the 'content' param.
		// Echo also has a 'content' param (for mention notifications), but it contains wikitext.
		$content = $this->event->getExtraParam( 'content' );
		if ( !$content ) {
			return '';
		}
		return $this->language->truncateForVisual( $content, EchoDiscussionParser::DEFAULT_SNIPPET_LENGTH );
	}

	/**
	 * Add mark-as-read params to a link array
	 *
	 * Taken from EchoEventPresentationModel::getPrimaryLinkWithMarkAsRead
	 * TODO: Upstream to Echo?
	 *
	 * @param array $link Link
	 * @return array
	 */
	protected function addMarkAsRead( $link ) {
		global $wgEchoCrossWikiNotifications;
		if ( $link ) {
			$eventIds = [ $this->event->getId() ];
			if ( $this->getBundledIds() ) {
				$eventIds = array_merge( $eventIds, $this->getBundledIds() );
			}

			$queryParams = [ 'markasread' => implode( '|', $eventIds ) ];
			if ( $wgEchoCrossWikiNotifications ) {
				$queryParams['markasreadwiki'] = WikiMap::getCurrentWikiId();
			}

			$link['url'] = wfAppendQuery( $link['url'], $queryParams );
		}
		return $link;
	}

}
