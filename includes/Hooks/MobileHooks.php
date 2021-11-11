<?php
/**
 * DiscussionTools mobile hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use MediaWiki\MediaWikiServices;

class MobileHooks {
	/**
	 * Decide whether mobile frontend should be allowed to activate
	 *
	 * @param \Title $title
	 * @param \OutputPage $output
	 * @return bool|void This hook can return false to abort, causing the talk overlay to not be shown
	 */
	public static function onMinervaNeueTalkPageOverlay( $title, $output ) {
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()
			->makeConfig( 'discussiontools' );
		if ( !$dtConfig->get( 'DiscussionToolsEnableMobile' ) ) {
			return true;
		}
		if ( HookUtils::isFeatureEnabledForOutput( $output ) ) {
			return false;
		}
		return true;
	}
}
