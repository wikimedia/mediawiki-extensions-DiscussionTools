<?php
/**
 * DiscussionTools page hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use Article;
use Html;
use IContextSource;
use MediaWiki\Actions\Hook\GetActionNameHook;
use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Extension\DiscussionTools\SubscriptionStore;
use MediaWiki\Hook\BeforePageDisplayHook;
use MediaWiki\Hook\OutputPageBeforeHTMLHook;
use MediaWiki\MediaWikiServices;
use MediaWiki\Page\Hook\BeforeDisplayNoArticleTextHook;
use OOUI\ButtonWidget;
use OutputPage;
use RequestContext;
use Skin;
use VisualEditorHooks;

class PageHooks implements
	BeforeDisplayNoArticleTextHook,
	BeforePageDisplayHook,
	GetActionNameHook,
	OutputPageBeforeHTMLHook
{
	/** @var SubscriptionStore */
	protected $subscriptionStore;

	/**
	 * @param SubscriptionStore $subscriptionStore
	 */
	public function __construct( SubscriptionStore $subscriptionStore ) {
		$this->subscriptionStore = $subscriptionStore;
	}

	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output
	 * @param Skin $skin
	 * @return void This hook must not abort, it must return no value
	 */
	public function onBeforePageDisplay( $output, $skin ): void {
		$user = $output->getUser();
		$req = $output->getRequest();
		// Load style modules if the tools can be available for the title
		// as this means the DOM may have been modified in the parser cache.
		if ( HookUtils::isAvailableForTitle( $output->getTitle() ) ) {
			$output->addModuleStyles( [
				'ext.discussionTools.init.styles',
			] );
		}
		// Load modules if any DT feature is enabled for this user
		if ( HookUtils::isFeatureEnabledForOutput( $output ) ) {
			$output->addModules( [
				'ext.discussionTools.init'
			] );

			$enabledVars = [];
			foreach ( HookUtils::FEATURES as $feature ) {
				$enabledVars[$feature] = HookUtils::isFeatureEnabledForOutput( $output, $feature );
			}
			$output->addJsConfigVars( 'wgDiscussionToolsFeaturesEnabled', $enabledVars );

			$services = MediaWikiServices::getInstance();
			$optionsLookup = $services->getUserOptionsLookup();
			$editor = $optionsLookup->getOption( $user, 'discussiontools-editmode' );
			// User has no preferred editor yet
			// If the user has a preferred editor, this will be evaluated in the client
			if ( !$editor ) {
				// Check which editor we would use for articles
				// VE pref is 'visualeditor'/'wikitext'. Here we describe the mode,
				// not the editor, so 'visual'/'source'
				$editor = VisualEditorHooks::getPreferredEditor( $user, $req ) === 'visualeditor' ?
					'visual' : 'source';
				$output->addJsConfigVars(
					'wgDiscussionToolsFallbackEditMode',
					$editor
				);
			}
			$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
			$abstate = $dtConfig->get( 'DiscussionToolsABTest' ) ?
				$optionsLookup->getOption( $user, 'discussiontools-abtest' ) :
				false;
			if ( $abstate ) {
				$output->addJsConfigVars(
					'wgDiscussionToolsABTestBucket',
					$abstate
				);
			}
		}

		// Replace the action=edit&section=new form with the new topic tool.
		if (
			HookUtils::shouldUseNewTopicTool( $output->getContext() ) &&
			// unless we got here via a redlink, in which case we want to allow the empty
			// state to be displayed:
			$req->getVal( 'redlink' ) !== '1'
		) {
			$output->addJsConfigVars( 'wgDiscussionToolsStartNewTopicTool', true );

			// For no-JS compatibility, redirect to the old new section editor if JS is unavailable.
			// This isn't great, because the user has to load the page twice. But making a page that is
			// both a view mode and an edit mode seems difficult, so I'm cutting some corners here.
			// (Code below adapted from VisualEditor.)
			$params = $output->getRequest()->getValues();
			$params['dtenable'] = '0';
			$url = wfScript() . '?' . wfArrayToCgi( $params );
			$escapedUrl = htmlspecialchars( $url );

			// Redirect if the user has no JS (<noscript>)
			$output->addHeadItem(
				'dt-noscript-fallback',
				"<noscript><meta http-equiv=\"refresh\" content=\"0; url=$escapedUrl\"></noscript>"
			);
			// Redirect if the user has no ResourceLoader
			$output->addScript( Html::inlineScript(
				"(window.NORLQ=window.NORLQ||[]).push(" .
					"function(){" .
						"location.href=\"$url\";" .
					"}" .
				");"
			) );
		}
	}

	/**
	 * OutputPageBeforeHTML hook handler
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/OutputPageBeforeHTML
	 *
	 * @param OutputPage $output OutputPage object that corresponds to the page
	 * @param string &$text Text that will be displayed, in HTML
	 * @return bool|void This hook must not abort, it must return true or null.
	 */
	public function onOutputPageBeforeHTML( $output, &$text ) {
		$lang = $output->getLanguage();
		// Check after the parser cache if tools need to be added for
		// non-cacheable reasons i.e. query string or cookie
		// The addDiscussionTools method is responsible for ensuring that
		// tools aren't added twice.
		foreach ( CommentFormatter::USE_WITH_FEATURES as $feature ) {
			if ( HookUtils::isFeatureEnabledForOutput( $output, $feature ) ) {
				CommentFormatter::addDiscussionTools( $text );
				break;
			}
		}

		$this->addFeatureBodyClasses( $output );

		if ( HookUtils::isFeatureEnabledForOutput( $output, HookUtils::TOPICSUBSCRIPTION ) ) {
			$text = CommentFormatter::postprocessTopicSubscription(
				$text, $lang, $this->subscriptionStore, $output->getUser()
			);
		}
		if ( HookUtils::isFeatureEnabledForOutput( $output, HookUtils::REPLYTOOL ) ) {
			$text = CommentFormatter::postprocessReplyTool(
				$text, $lang
			);
		}

		return true;
	}

	/**
	 * GetActionName hook handler
	 *
	 * @param IContextSource $context Request context
	 * @param string &$action Default action name, reassign to change it
	 * @return void This hook must not abort, it must return no value
	 */
	public function onGetActionName( IContextSource $context, string &$action ): void {
		if ( $action === 'edit' && HookUtils::shouldUseNewTopicTool( $context ) ) {
			$action = 'view';
		}
	}

	/**
	 * BeforeDisplayNoArticleText hook handler
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/BeforeDisplayNoArticleText
	 *
	 * @param Article $article The (empty) article
	 * @return bool|void This hook can abort
	 */
	public function onBeforeDisplayNoArticleText( $article ) {
		// We want to override the empty state for articles on which we would be enabled
		$title = $article->getTitle();
		$oldid = $article->getOldID();
		if ( $oldid || $title->hasSourceText() ) {
			// The default display will probably be useful here, so leave it.
			return true;
		}
		$context = $article->getContext();
		$output = $context->getOutput();
		if ( !HookUtils::isFeatureEnabledForOutput( $output, HookUtils::NEWTOPICTOOL ) || !$title->isTalkPage() ) {
			// Our empty states are all about using the new topic tool, but
			// expect to be on a talk page, so fall back if it's not
			// available or if we're in a non-talk namespace that still has
			// DT features enabled
			return true;
		}
		$output->enableOOUI();
		$output->enableClientCache( false );

		// OutputPageBeforeHTML won't have run, since there's no parsed text
		// to display, but we need these classes or reply links won't show
		// after a topic is posted.
		$this->addFeatureBodyClasses( $output );

		$coreConfig = RequestContext::getMain()->getConfig();
		$iconpath = $coreConfig->get( 'ExtensionAssetsPath' ) . '/DiscussionTools/images';

		$dir = $context->getLanguage()->getDir();
		$lang = $context->getLanguage()->getHtmlCode();

		$output->addHTML(
			// This being mw-parser-output is a lie, but makes the reply controller cope much better with everything
			Html::openElement( 'div', [ 'class' => "ext-discussiontools-emptystate mw-parser-output noarticletext" ] ) .
			Html::openElement( 'div', [ 'class' => "ext-discussiontools-emptystate-text" ] )
		);
		if ( $title->equals( $output->getUser()->getTalkPage() ) ) {
			$output->addHTML(
				Html::rawElement( 'h3', [], $context->msg( 'discussiontools-emptystate-title-self' )->parse() ) .
				Html::rawElement( 'p', [], $context->msg( 'discussiontools-emptystate-desc-self' )->parse() )
			);
		} else {
			$titleMsg = $title->getNamespace() == NS_USER_TALK ?
				'discussiontools-emptystate-title-user' :
				'discussiontools-emptystate-title';
			$output->addHTML(
				Html::rawElement( 'h3', [], $context->msg( $titleMsg )->parse() ) .
				Html::rawElement( 'p', [],
					$context->msg(
						$title->getNamespace() == NS_USER_TALK ?
							'discussiontools-emptystate-desc-user' :
							'discussiontools-emptystate-desc'
					)->parse()
				) .
				new ButtonWidget( [
					'label' => $context->msg( 'discussiontools-emptystate-button' )->text(),
					'href' => $title->getLocalURL( 'action=edit&section=new' ),
					'flags' => [ 'primary', 'progressive' ]
				] )
			);
		}
		$output->addHTML(
			Html::closeElement( 'div' ) .
			Html::element( 'img', [
				'src' => $iconpath . '/emptystate.svg',
				'class' => "ext-discussiontools-emptystate-logo",
				// This is a purely decorative element
				'alt' => "",
			] ) .
			Html::closeElement( 'div' )
		);

		return false;
	}

	/**
	 * Helper to add feature-toggle classes to the output's body
	 *
	 * @param OutputPage $output
	 * @return void
	 */
	protected function addFeatureBodyClasses( OutputPage $output ): void {
		foreach ( HookUtils::FEATURES as $feature ) {
			// Add a CSS class for each enabled feature
			if ( HookUtils::isFeatureEnabledForOutput( $output, $feature ) ) {
				$output->addBodyClasses( "ext-discussiontools-$feature-enabled" );
			}
		}
	}
}
