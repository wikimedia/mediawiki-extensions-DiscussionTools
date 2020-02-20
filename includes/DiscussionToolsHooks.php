<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

use MediaWiki\MediaWikiServices;

class DiscussionToolsHooks {

	private static $tags = [
		'discussiontools',
		// Features:
		'discussiontools-reply',
		'discussiontools-edit',
		'discussiontools-newtopic',
		// Input methods:
		'discussiontools-source',
		'discussiontools-visual',
	];

	public static function onRegistration() {
		$coreConfig = RequestContext::getMain()->getConfig();
		// If $wgLocaltimezone isn't hard-coded, it is evaluated from the system
		// timezone. On some systems this isn't guaranteed to be static, for example
		// on Debian, GMT can get converted to UTC, instead of Europe/London.
		//
		// Timestamp parsing assumes that the timezone never changes.
		//
		// HACK: Do not run this test on CI as $wgLocaltimezone is not configured.
		if ( !$coreConfig->get( 'Localtimezone' ) && !getenv( 'ZUUL_PROJECT' ) ) {
			throw new \ConfigException( 'DiscussionTools requires $wgLocaltimezone to be set' );
		}
	}

	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output The page view.
	 * @param Skin $skin The skin that's going to build the UI.
	 */
	public static function onBeforePageDisplay( OutputPage $output, Skin $skin ) {
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()
			->makeConfig( 'discussiontools' );
		$title = $output->getTitle();
		$actionName = Action::getActionName( $output->getContext() );
		$req = $output->getRequest();

		if (
			// Don't show on edit pages
			$actionName !== 'edit' &&
			$actionName !== 'submit' &&
			// Only wikitext pages (e.g. not Flow boards)
			$title->getContentModel() === CONTENT_MODEL_WIKITEXT &&
			(
				// Query parameter to load on any wikitext page for testing
				$req->getVal( 'dtenable' ) ||
				// If configured, load on all talk pages
				( $dtConfig->get( 'DiscussionToolsEnable' ) && $title->isTalkPage() )
				// TODO: Allow non talk pages to be treated as talk pages
				// using a magic word.
			)
		) {
			$output->addModules( [
				'ext.discussionTools.init'
			] );
		}
	}

	/**
	 * Implements the ListDefinedTags and ChangeTagsListActive hooks, to
	 * populate core Special:Tags with the change tags in use by DiscussionTools.
	 *
	 * @param array &$tags Available change tags.
	 */
	public static function onListDefinedTags( &$tags ) {
		$tags = array_merge( $tags, static::$tags );
	}

	/**
	 * Implements the RecentChange_save hook, to add a whitelisted set of changetags
	 * to edits.
	 *
	 * @param RecentChange $recentChange
	 * @return bool
	 */
	public static function onRecentChangeSave( RecentChange $recentChange ) {
		// only apply to api edits, since there's no case where discussiontools
		// should be using the form-submit method.
		if ( !defined( 'MW_API' ) ) {
			return true;
		}
		$request = RequestContext::getMain()->getRequest();
		$tags = explode( ',', $request->getVal( 'dttags' ) );

		$tags = array_values( array_intersect( $tags, static::$tags ) );

		if ( $tags ) {
			$recentChange->addTags( $tags );
		}

		return true;
	}
}
