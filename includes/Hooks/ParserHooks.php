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
use ConfigFactory;
use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Hook\ParserAfterParseHook;
use MediaWiki\Hook\ParserAfterTidyHook;
use MediaWiki\Hook\ParserOptionsRegisterHook;
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
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserAfterParse
	 *
	 * @param Parser $parser
	 * @param string &$text
	 * @param StripState $stripState
	 */
	public function onParserAfterParse( $parser, &$text, $stripState ): void {
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
	}

	/**
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserAfterTidy
	 *
	 * @param Parser $parser
	 * @param string &$text
	 */
	public function onParserAfterTidy( $parser, &$text ) {
		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
		if ( !$dtConfig->get( 'DiscussionToolsUseParserCache' ) ) {
			return;
		}

		if ( $parser->getOptions()->getInterfaceMessage() || $parser->getOptions()->getIsPreview() ) {
			return;
		}

		// Always apply the DOM transform if DiscussionTools are available for this page,
		// to allow linking to individual comments from Echo 'mention' and 'edit-user-talk'
		// notifications (T253082, T281590), and to reduce parser cache fragmentation (T279864).
		// The extra buttons are hidden in CSS (ext.discussionTools.init.styles module) when
		// the user doesn't have DiscussionTools features enabled.
		if ( HookUtils::isAvailableForTitle( $parser->getTitle() ) ) {
			// This modifies $text
			CommentFormatter::addDiscussionTools( $text, $parser->getOutput() );

			$parser->getOutput()->addModuleStyles( [
				'ext.discussionTools.init.styles',
			] );
		}
	}

	/**
	 * @param Article $article Article about to be parsed
	 * @param ParserOptions $popts Mutable parser options
	 * @return bool|void True or no return value to continue or false to abort
	 */
	public function onArticleParserOptions( Article $article, ParserOptions $popts ) {
		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );

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
				HookUtils::isFeatureEnabledForUser( $popts->getUserIdentity(), $feature )
			) {
				// For backwards-compatibility until the canonical cache entries
				// without DiscussionTools DOM transform expire (T280599)
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
