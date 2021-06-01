<?php
/**
 * DiscussionTools parser hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use Article;
use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Hook\ParserAfterParseHook;
use MediaWiki\Hook\ParserAfterTidyHook;
use MediaWiki\Hook\ParserOptionsRegisterHook;
use MediaWiki\MediaWikiServices;
use MediaWiki\Page\Hook\ArticleParserOptionsHook;
use Parser;
use ParserOptions;
use StripState;

class ParserHooks implements
	ParserAfterParseHook,
	ParserAfterTidyHook,
	ArticleParserOptionsHook,
	ParserOptionsRegisterHook
{
	/**
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserAfterParse
	 *
	 * @param Parser $parser
	 * @param string &$text
	 * @param StripState $stripState
	 */
	public function onParserAfterParse( $parser, &$text, $stripState ) : void {
		$title = $parser->getTitle();

		// This condition must be unreliant on current enablement config or user preference.
		// In other words, include parser output of talk pages with DT disabled.
		//
		// This is similar to HookUtils::isAvailableForTitle, but instead of querying the
		// database for the latest metadata of a page that exists, we check metadata of
		// the given ParserOutput object only (this runs before the edit is saved).
		if ( $title->isTalkPage() || $parser->getOutput()->getNewSection() ) {
			$services = MediaWikiServices::getInstance();
			$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
			$talkExpiry = $dtConfig->get( 'DiscussionToolsTalkPageParserCacheExpiry' );
			// Override parser cache expiry of talk pages (T280605).
			// Note, this can only shorten it. MediaWiki ignores values higher than the default.
			if ( $talkExpiry > 0 ) {
				$parser->getOutput()->updateCacheExpiry( $talkExpiry );
			}
		}
	}

	/**
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserAfterTidy
	 *
	 * @param Parser $parser
	 * @param string &$text
	 */
	public function onParserAfterTidy( $parser, &$text ) {
		$popts = $parser->getOptions();
		// ParserOption for dtreply was set in onArticleParserOptions
		if ( $popts->getOption( 'dtreply' ) ) {
			CommentFormatter::addDiscussionTools( $text );
		}
	}

	/**
	 * @param Article $article Article about to be parsed
	 * @param ParserOptions $popts Mutable parser options
	 * @return bool|void True or no return value to continue or false to abort
	 */
	public function onArticleParserOptions( Article $article, ParserOptions $popts ) {
		$services = MediaWikiServices::getInstance();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		if (
			!$dtConfig->get( 'DiscussionToolsUseParserCache' ) ||
			!HookUtils::isAvailableForTitle( $article->getTitle() )
		) {
			return;
		}

		foreach ( CommentFormatter::USE_WITH_FEATURES as $feature ) {
			if (
				// If the feature is enabled by default, always apply the DOM transform
				$dtConfig->get( 'DiscussionTools_' . $feature ) === 'available' ||
				// ...or if has been enabled by the user
				HookUtils::isFeatureEnabledForUser( $popts->getUser(), $feature )
			) {
				$popts->setOption( 'dtreply', true );
				return;
			}
		}
	}

	/**
	 * Register additional parser options
	 *
	 * @param array &$defaults
	 * @param array &$inCacheKey
	 * @param array &$lazyLoad
	 * @return bool|void
	 */
	public function onParserOptionsRegister( &$defaults, &$inCacheKey, &$lazyLoad ) {
		$defaults['dtreply'] = null;
		$inCacheKey['dtreply'] = true;
	}
}
