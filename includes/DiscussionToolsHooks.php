<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */
class DiscussionToolsHooks {
	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output The page view.
	 * @param Skin $skin The skin that's going to build the UI.
	 */
	public static function onBeforePageDisplay( OutputPage $output, Skin $skin ) {
		$title = $output->getTitle();
		if (
			// Only wikitext pages (e.g. not Flow boards)
			$title->getContentModel() === CONTENT_MODEL_WIKITEXT &&
			$title->isTalkPage()
			// TODO: Allow non talk pages to be treated as talk pages
			// using a magic word.
		) {
			// TODO: Load talk page enhancements
		}
	}
}
