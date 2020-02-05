<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

class DiscussionToolsHooks {

	public static function onRegistration() {
		global $wgLocaltimezone;
		// If $wgLocaltimezone isn't hard-coded, it is evaluated from the system
		// timezone. On some systems this isn't guaranteed to be static, for example
		// on Debian, GMT can get converted to UTC, instead of Europe/London.
		//
		// Timestamp parsing assumes that the timezone never changes.
		//
		// HACK: Do not run this test on CI as $wgLocaltimezone is not configured.
		if ( !$wgLocaltimezone && !getenv( 'ZUUL_PROJECT' ) ) {
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
		global $wgDiscussionToolsEnable;
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
				( $wgDiscussionToolsEnable && $title->isTalkPage() )
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
	 * Implements the ListDefinedTags, ChangeTagsListActive, and
	 * ChangeTagsAllowedAdd hooks, to populate core Special:Tags with the change
	 * tags in use by VisualEditor.
	 *
	 * @param array &$tags Available change tags.
	 */
	public static function onListDefinedTags( &$tags ) {
		$tags[] = 'discussiontools';
		// Features:
		$tags[] = 'discussiontools-reply';
		$tags[] = 'discussiontools-edit';
		$tags[] = 'discussiontools-newsection';
		// Input methods:
		$tags[] = 'discussiontools-source';
		$tags[] = 'discussiontools-visual';
	}
}
