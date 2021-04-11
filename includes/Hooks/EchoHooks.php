<?php
/**
 * DiscussionTools echo hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use EchoEvent;
use MediaWiki\Extension\DiscussionTools\Notifications\EventDispatcher;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionRecord;

class EchoHooks {
	/**
	 * Add notification events to Echo
	 *
	 * @param array &$notifications
	 * @param array &$notificationCategories
	 * @param array &$icons
	 */
	public static function onBeforeCreateEchoEvent(
		array &$notifications,
		array &$notificationCategories,
		array &$icons
	) {
		$services = MediaWikiServices::getInstance();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
		if ( $dtConfig->get( 'DiscussionTools_' . HookUtils::TOPICSUBSCRIPTION ) === 'unavailable' ) {
			// Topic subscriptions not available on wiki.
			return;
		}

		$notificationCategories['dt-subscription'] = [
			'priority' => 3,
			'tooltip' => 'echo-pref-tooltip-dt-subscription',
		];

		$notifications['dt-subscribed-new-comment'] = [
			'category' => 'dt-subscription',
			'group' => 'interactive',
			'section' => 'message',
			'user-locators' => [
				'MediaWiki\\Extension\\DiscussionTools\\Notifications\\EventDispatcher::locateSubscribedUsers'
			],
			'user-filters' => [
				[
					"EchoUserLocator::locateFromEventExtra",
					[ "mentioned-users" ]
				]
			],
			'presentation-model' =>
				'MediaWiki\\Extension\\DiscussionTools\\Notifications\\SubscribedNewCommentPresentationModel',
			'bundle' => [
				'web' => true,
				'email' => true,
				'expandable' => true,
			],
		];
	}

	/**
	 * @param EchoEvent $event
	 * @param string &$bundleString
	 * @return bool
	 */
	public static function onEchoGetBundleRules( EchoEvent $event, string &$bundleString ) : bool {
		switch ( $event->getType() ) {
			case 'dt-subscribed-new-comment':
				$bundleString = $event->getType() . '-' . $event->getExtraParam( 'subscribed-comment-name' );
				break;
		}
		return true;
	}

	/**
	 * @param array &$events
	 * @param RevisionRecord $revision
	 * @param bool $isRevert
	 */
	public static function onEchoGetEventsForRevision( array &$events, RevisionRecord $revision, bool $isRevert ) {
		if ( $isRevert ) {
			return;
		}
		EventDispatcher::generateEventsForRevision( $events, $revision );
	}
}
