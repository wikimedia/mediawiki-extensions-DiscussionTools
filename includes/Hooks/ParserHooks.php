<?php
/**
 * DiscussionTools parser hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use ConfigFactory;
use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Hook\ParserAfterTidyHook;
use MediaWiki\Hook\ParserOutputPostCacheTransformHook;
use Parser;
use ParserOutput;

class ParserHooks implements
	ParserAfterTidyHook,
	ParserOutputPostCacheTransformHook
{
	/** @var ConfigFactory */
	private $configFactory;

	/**
	 * @param ConfigFactory $configFactory
	 */
	public function __construct(
		ConfigFactory $configFactory
	) {
		$this->configFactory = $configFactory;
	}

	/**
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserAfterTidy
	 *
	 * @param Parser $parser
	 * @param string &$text
	 */
	public function onParserAfterTidy( $parser, &$text ) {
		if ( $parser->getOptions()->getInterfaceMessage() ) {
			return;
		}

		$title = $parser->getTitle();

		// This condition must be unreliant on current enablement config or user preference.
		// In other words, include parser output of talk pages with DT disabled.
		//
		// This is similar to HookUtils::isAvailableForTitle, but instead of querying the
		// database for the latest metadata of a page that exists, we check metadata of
		// the given ParserOutput object only (this runs before the edit is saved).
		if ( $title->isTalkPage() || $parser->getOutput()->getNewSection() ) {
			$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
			$talkExpiry = $dtConfig->get( 'DiscussionToolsTalkPageParserCacheExpiry' );
			// Override parser cache expiry of talk pages (T280605).
			// Note, this can only shorten it. MediaWiki ignores values higher than the default.
			if ( $talkExpiry > 0 ) {
				$parser->getOutput()->updateCacheExpiry( $talkExpiry );
			}
		}

		// Always apply the DOM transform if DiscussionTools are available for this page,
		// to allow linking to individual comments from Echo 'mention' and 'edit-user-talk'
		// notifications (T253082, T281590), and to reduce parser cache fragmentation (T279864).
		// The extra buttons are hidden in CSS (ext.discussionTools.init.styles module) when
		// the user doesn't have DiscussionTools features enabled.
		if ( HookUtils::isAvailableForTitle( $title ) ) {
			// This modifies $text
			CommentFormatter::addDiscussionTools( $text, $parser->getOutput(), $parser->getTitle() );

			$parser->getOutput()->addModuleStyles( [
				'ext.discussionTools.init.styles',
			] );
		}
	}

	/**
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserOutputPostCacheTransform
	 *
	 * @param ParserOutput $parserOutput
	 * @param string &$text
	 * @param array &$options
	 */
	public function onParserOutputPostCacheTransform( $parserOutput, &$text, &$options ): void {
		if ( !$options['enableSectionEditLinks'] ) {
			$text = CommentFormatter::removeInteractiveTools( $text );
		}
	}
}
