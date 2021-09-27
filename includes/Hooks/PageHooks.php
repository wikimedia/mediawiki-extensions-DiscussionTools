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
use ConfigFactory;
use Html;
use IContextSource;
use MediaWiki\Actions\Hook\GetActionNameHook;
use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Extension\DiscussionTools\SubscriptionStore;
use MediaWiki\Hook\BeforePageDisplayHook;
use MediaWiki\Hook\OutputPageBeforeHTMLHook;
use MediaWiki\Page\Hook\BeforeDisplayNoArticleTextHook;
use MediaWiki\User\UserNameUtils;
use MediaWiki\User\UserOptionsLookup;
use OOUI\ButtonWidget;
use OutputPage;
use RequestContext;
use Skin;
use SpecialPage;
use VisualEditorHooks;

class PageHooks implements
	BeforeDisplayNoArticleTextHook,
	BeforePageDisplayHook,
	GetActionNameHook,
	OutputPageBeforeHTMLHook
{
	/** @var ConfigFactory */
	private $configFactory;

	/** @var SubscriptionStore */
	private $subscriptionStore;

	/** @var UserNameUtils */
	private $userNameUtils;

	/** @var UserOptionsLookup */
	private $userOptionsLookup;

	/**
	 * @param ConfigFactory $configFactory
	 * @param SubscriptionStore $subscriptionStore
	 * @param UserNameUtils $userNameUtils
	 * @param UserOptionsLookup $userOptionsLookup
	 */
	public function __construct(
		ConfigFactory $configFactory,
		SubscriptionStore $subscriptionStore,
		UserNameUtils $userNameUtils,
		UserOptionsLookup $userOptionsLookup
	) {
		$this->configFactory = $configFactory;
		$this->subscriptionStore = $subscriptionStore;
		$this->userNameUtils = $userNameUtils;
		$this->userOptionsLookup = $userOptionsLookup;
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

			$editor = $this->userOptionsLookup->getOption( $user, 'discussiontools-editmode' );
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
			$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
			$abstate = $dtConfig->get( 'DiscussionToolsABTest' ) ?
				$this->userOptionsLookup->getOption( $user, 'discussiontools-abtest' ) :
				false;
			if ( $abstate ) {
				$output->addJsConfigVars(
					'wgDiscussionToolsABTestBucket',
					$abstate
				);
			}
		}

		// Replace the action=edit&section=new form with the new topic tool.
		if ( HookUtils::shouldOpenNewTopicTool( $output->getContext() ) ) {
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

		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
		if ( !$dtConfig->get( 'DiscussionToolsUseParserCache' ) ) {
			foreach ( CommentFormatter::USE_WITH_FEATURES as $feature ) {
				if ( HookUtils::isFeatureEnabledForOutput( $output, $feature ) ) {
					CommentFormatter::addDiscussionTools( $text );
					break;
				}
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
		if ( $action === 'edit' && (
			HookUtils::shouldOpenNewTopicTool( $context ) ||
			HookUtils::shouldDisplayEmptyState( $context )
		) ) {
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
		$context = $article->getContext();
		if ( !HookUtils::shouldDisplayEmptyState( $context ) ) {
			// Our empty states are all about using the new topic tool, but
			// expect to be on a talk page, so fall back if it's not
			// available or if we're in a non-talk namespace that still has
			// DT features enabled
			return true;
		}

		$output = $context->getOutput();
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
		$titleMsg = false;
		$descMsg = false;
		$descParams = [];
		$buttonMsg = 'discussiontools-emptystate-button';
		$title = $context->getTitle();
		if ( $title->getNamespace() == NS_USER_TALK ) {
			// This is a user talk page
			$isIP = $this->userNameUtils->isIP( $title->getText() );
			if ( $title->equals( $output->getUser()->getTalkPage() ) ) {
				// This is your own user talk page
				if ( $isIP ) {
					// You're an IP editor, so this is only *sort of* your talk page
					$titleMsg = 'discussiontools-emptystate-title-self-anon';
					$descMsg = 'discussiontools-emptystate-desc-self-anon';
					$query = $context->getRequest()->getValues();
					unset( $query['title'] );
					$descParams = [
						SpecialPage::getTitleFor( 'CreateAccount' )->getFullURL( [
							'returnto' => $context->getTitle()->getFullText(),
							'returntoquery' => wfArrayToCgi( $query ),
						] ),
						SpecialPage::getTitleFor( 'Userlogin' )->getFullURL( [
							'returnto' => $context->getTitle()->getFullText(),
							'returntoquery' => wfArrayToCgi( $query ),
						] ),
					];
				} else {
					// You're logged in, this is very much your talk page
					$titleMsg = 'discussiontools-emptystate-title-self';
					$descMsg = 'discussiontools-emptystate-desc-self';
				}
				$buttonMsg = false;
			} elseif ( $isIP ) {
				// This is an IP editor
				$titleMsg = 'discussiontools-emptystate-title-user-anon';
				$descMsg = 'discussiontools-emptystate-desc-user-anon';
			} else {
				// This is any other user
				$titleMsg = 'discussiontools-emptystate-title-user';
				$descMsg = 'discussiontools-emptystate-desc-user';
			}
		} else {
			// This is any other page on which DT is enabled
			$titleMsg = 'discussiontools-emptystate-title';
			$descMsg = 'discussiontools-emptystate-desc';
		}
		$output->addHTML( Html::rawElement( 'h3', [],
			$context->msg( $titleMsg )->parse()
		) );
		$output->addHTML( Html::rawElement( 'div', [ 'class' => 'plainlinks' ],
			$context->msg( $descMsg, $descParams )->parseAsBlock()
		) );
		if ( $buttonMsg ) {
			$output->addHTML( new ButtonWidget( [
				'label' => $context->msg( $buttonMsg )->text(),
				'href' => $title->getLocalURL( 'action=edit&section=new' ),
				'flags' => [ 'primary', 'progressive' ]
			] ) );
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
