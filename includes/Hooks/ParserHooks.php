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
use MediaWiki\Hook\ParserAfterTidyHook;
use MediaWiki\Hook\ParserOptionsRegisterHook;
use MediaWiki\MediaWikiServices;
use MediaWiki\Page\Hook\ArticleParserOptionsHook;
use Parser;
use ParserOptions;

class ParserHooks implements
	ParserAfterTidyHook,
	ArticleParserOptionsHook,
	ParserOptionsRegisterHook
{
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
			$dtConfig->get( 'DiscussionToolsUseParserCache' ) &&
			HookUtils::isAvailableForTitle( $article->getTitle() ) && (
				// If the reply tool is enabled by default, always apply the DOM transform
				// TODO: Check any feature in CommentFormatter::USE_WITH_FEATURES
				$dtConfig->get( 'DiscussionTools_' . HookUtils::REPLYTOOL ) === 'available' ||
				// ...or if enabled for a specific user
				HookUtils::isFeatureEnabledForUser( $popts->getUser(), HookUtils::REPLYTOOL )
			)
		) {
			$popts->setOption( 'dtreply', true );
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
