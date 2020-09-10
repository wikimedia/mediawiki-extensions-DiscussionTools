<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools;

use Action;
use ConfigException;
use MediaWiki\MediaWikiServices;
use OutputPage;
use RecentChange;
use RequestContext;
use Skin;
use User;
use VisualEditorHooks;

class Hooks {

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

	public static function onRegistration() : void {
		// Use globals instead of Config. Accessing it so early blows up unrelated extensions (T255704).
		global $wgLocaltimezone;
		// If $wgLocaltimezone isn't hard-coded, it is evaluated from the system
		// timezone. On some systems this isn't guaranteed to be static, for example
		// on Debian, GMT can get converted to UTC, instead of Europe/London.
		//
		// Timestamp parsing assumes that the timezone never changes.
		//
		// HACK: Do not run this test on CI as $wgLocaltimezone is not configured.
		if ( !$wgLocaltimezone && !getenv( 'ZUUL_PROJECT' ) ) {
			throw new ConfigException( 'DiscussionTools requires $wgLocaltimezone to be set' );
		}
	}

	/**
	 * Check if the tool is available on a given page
	 *
	 * @param OutputPage $output
	 * @return bool
	 */
	private static function isAvailable( OutputPage $output ) : bool {
		// Don't show on edit pages, history, etc.
		if ( Action::getActionName( $output->getContext() ) !== 'view' ) {
			return false;
		}

		$title = $output->getTitle();
		// Only wikitext pages (e.g. not Flow boards)
		if ( $title->getContentModel() !== CONTENT_MODEL_WIKITEXT ) {
			return false;
		}

		// Query parameter override to load on any wikitext page for testing
		if ( $output->getRequest()->getVal( 'dtenable' ) ) {
			return true;
		}

		$user = $output->getUser();
		$services = MediaWikiServices::getInstance();
		$optionsLookup = $services->getUserOptionsLookup();

		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
		$userEnabled = $dtConfig->get( 'DiscussionToolsEnable' ) && (
			!$dtConfig->get( 'DiscussionToolsBeta' ) ||
			$optionsLookup->getOption( $user, 'discussiontools-betaenable' )
		);

		// Finally check the user has the tool enabled and that the page
		// supports discussions.
		return $userEnabled && (
			// `wantSignatures` includes talk pages
			$services->getNamespaceInfo()->wantSignatures( $title->getNamespace() ) ||
			// Treat pages with __NEWSECTIONLINK__ as talk pages (T245890)
			$output->showNewSectionLink()
			// TODO: Consider not loading if forceHideNewSectionLink is true.
		);
	}

	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output The page view.
	 * @param Skin $skin The skin that's going to build the UI.
	 */
	public static function onBeforePageDisplay( OutputPage $output, Skin $skin ) : void {
		if ( self::isAvailable( $output ) ) {
			$output->addModules( [
				'ext.discussionTools.init'
			] );

			$services = MediaWikiServices::getInstance();
			$optionsLookup = $services->getUserOptionsLookup();
			$req = $output->getRequest();
			$user = $output->getUser();
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
		}
	}

	/**
	 * Set static (not request-specific) JS configuration variables
	 *
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ResourceLoaderGetConfigVars
	 * @param array &$vars Array of variables to be added into the output of the startup module
	 * @param string $skinName Current skin name to restrict config variables to a certain skin
	 */
	public static function onResourceLoaderGetConfigVars( array &$vars, string $skinName ) : void {
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()
			->makeConfig( 'discussiontools' );

		$vars['wgDTSchemaEditAttemptStepSamplingRate'] =
			$dtConfig->get( 'DTSchemaEditAttemptStepSamplingRate' );
		$vars['wgDTSchemaEditAttemptStepOversample'] =
			$dtConfig->get( 'DTSchemaEditAttemptStepOversample' );
	}

	/**
	 * Handler for the GetPreferences hook, to add and hide user preferences as configured
	 *
	 * @param User $user The user object
	 * @param array &$preferences Their preferences object
	 */
	public static function onGetPreferences( User $user, array &$preferences ) {
		$api = [ 'type' => 'api' ];
		$preferences['discussiontools-editmode'] = [
			'type' => 'api',
			'validation-callback' => function ( $value ) {
				return in_array( $value, [ '', 'source', 'visual' ], true );
			},
		];
	}

	/**
	 * Handler for the GetBetaPreferences hook, to add and hide user beta preferences as configured
	 *
	 * @param User $user The user object
	 * @param array &$preferences Their preferences object
	 */
	public static function onGetBetaPreferences( User $user, array &$preferences ) : void {
		$coreConfig = RequestContext::getMain()->getConfig();
		$iconpath = $coreConfig->get( 'ExtensionAssetsPath' ) . '/DiscussionTools/images';

		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()
			->makeConfig( 'discussiontools' );

		if (
			$dtConfig->get( 'DiscussionToolsEnable' ) &&
			$dtConfig->get( 'DiscussionToolsBeta' )
		) {
			$preferences['discussiontools-betaenable'] = [
				'version' => '1.0',
				'label-message' => 'discussiontools-preference-label',
				'desc-message' => 'discussiontools-preference-description',
				'screenshot' => [
					'ltr' => "$iconpath/betafeatures-icon-DiscussionTools-ltr.svg",
					'rtl' => "$iconpath/betafeatures-icon-DiscussionTools-rtl.svg",
				],
				'info-message' => 'discussiontools-preference-info-link',
				'discussion-message' => 'discussiontools-preference-discussion-link',
				'requirements' => [
					'javascript' => true
				]
			];
		}
	}

	/**
	 * Implements the ListDefinedTags and ChangeTagsListActive hooks, to
	 * populate core Special:Tags with the change tags in use by DiscussionTools.
	 *
	 * @param array &$tags Available change tags.
	 */
	public static function onListDefinedTags( array &$tags ) : void {
		$tags = array_merge( $tags, static::$tags );
	}

	/**
	 * Implements the RecentChange_save hook, to add an allowed set of changetags
	 * to edits.
	 *
	 * @param RecentChange $recentChange
	 * @return bool
	 */
	public static function onRecentChangeSave( RecentChange $recentChange ) : bool {
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
