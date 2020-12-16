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
use ExtensionRegistry;
use MediaWiki\MediaWikiServices;
use MWExceptionHandler;
use OutputPage;
use PageProps;
use RecentChange;
use RequestContext;
use Skin;
use Throwable;
use Title;
use User;
use VisualEditorHooks;
use WebRequest;

class Hooks {

	private const TAGS = [
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
		global $wgLocaltimezone, $wgFragmentMode;
		// HACK: Do not run these tests on CI as the globals are not configured.
		if ( getenv( 'ZUUL_PROJECT' ) ) {
			return;
		}
		// If $wgLocaltimezone isn't hard-coded, it is evaluated from the system
		// timezone. On some systems this isn't guaranteed to be static, for example
		// on Debian, GMT can get converted to UTC, instead of Europe/London.
		// Timestamp parsing assumes that the timezone never changes.
		if ( !$wgLocaltimezone ) {
			throw new ConfigException( 'DiscussionTools requires $wgLocaltimezone to be set' );
		}
		// If $wgFragmentMode is set to use 'legacy' encoding, determining the IDs of our thread
		// headings is harder, especially since the implementation is different in Parsoid.
		if ( !isset( $wgFragmentMode[0] ) || $wgFragmentMode[0] !== 'html5' ) {
			throw new ConfigException( 'DiscussionTools requires $wgFragmentMode to be set to ' .
				"[ 'html5', 'legacy' ] or [ 'html5' ]" );
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
		// Don't show on pages without a Title
		if ( !$title ) {
			return false;
		}

		// Don't show on mobile
		if ( ExtensionRegistry::getInstance()->isLoaded( 'MobileFrontend' ) ) {
			$mobFrontContext = MediaWikiServices::getInstance()->getService( 'MobileFrontend.Context' );
			if ( $mobFrontContext->shouldDisplayMobileView() ) {
				return false;
			}
		}

		return self::isAvailableForTitleAndUser(
			$title,
			$output->getUser(),
			// overrideAllChecks
			// Query parameter override to load on any wikitext page for testing
			$output->getRequest()->getVal( 'dtenable' ) ||
				// Extra hack for parses from API, where this parameter isn't passed to derivative requests
				RequestContext::getMain()->getRequest()->getVal( 'dtenable' ),
			// overrideUserEnabled
			$output->getRequest()->getCookie( 'discussiontools-tempenable' ) ?: false
		);
	}

	/**
	 * Check if the tool should be available for a given title and user
	 *
	 * @param Title $title
	 * @param User $user
	 * @param bool $overrideAllChecks Override all checks, excluding those which make
	 *  it technically impossible to load reply links (content model check).
	 * @param bool $overrideUserPrefs Override user preference check
	 * @return bool
	 */
	private static function isAvailableForTitleAndUser(
		Title $title,
		User $user,
		bool $overrideAllChecks = false,
		bool $overrideUserPrefs = false
	) {
		// Only wikitext pages (e.g. not Flow boards)
		if ( $title->getContentModel() !== CONTENT_MODEL_WIKITEXT ) {
			return false;
		}
		if ( $overrideAllChecks ) {
			return true;
		}

		$services = MediaWikiServices::getInstance();
		$optionsLookup = $services->getUserOptionsLookup();

		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
		$isBeta = $dtConfig->get( 'DiscussionToolsBeta' );
		$userEnabled = $overrideUserPrefs || (
			$dtConfig->get( 'DiscussionToolsEnable' ) && (
				( $isBeta && $optionsLookup->getOption( $user, 'discussiontools-betaenable' ) ) ||
				( !$isBeta && $optionsLookup->getOption( $user, 'discussiontools-replytool' ) )
			)
		);

		$props = PageProps::getInstance()->getProperties( $title, 'newsectionlink' );
		$hasNewSectionLink = isset( $props[ $title->getArticleId() ] );

		// Finally check the user has the tool enabled and that the page
		// supports discussions.
		return $userEnabled && (
			// `wantSignatures` includes talk pages
			$services->getNamespaceInfo()->wantSignatures( $title->getNamespace() ) ||
			// Treat pages with __NEWSECTIONLINK__ as talk pages (T245890)
			$hasNewSectionLink
			// TODO: Consider not loading if forceHideNewSectionLink is true.
		);
	}

	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output
	 * @param Skin $skin The skin that's going to build the UI.
	 */
	public static function onBeforePageDisplay( OutputPage $output, Skin $skin ) : void {
		if ( self::isAvailable( $output ) ) {
			$output->addModuleStyles( [
				'ext.discussionTools.init.styles'
			] );
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
	 * OutputPageBeforeHTML hook handler
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/OutputPageBeforeHTML
	 *
	 * @param OutputPage $output The OutputPage object to which wikitext is added
	 * @param string &$text The HTML to be wrapped inside the #mw-content-text element
	 * @return bool
	 */
	public static function onOutputPageBeforeHTML( OutputPage $output, string &$text ) : bool {
		// TODO: This is based on the current user, is there an issue with caching?
		if ( !self::isAvailable( $output ) ) {
			return true;
		}

		$start = microtime( true );
		try {
			// Add reply links and hidden data about comment ranges.
			$newText = CommentFormatter::addReplyLinks( $text );
		} catch ( Throwable $e ) {
			// Catch errors, so that they don't cause the entire page to not display.
			// Log it and add the request ID in a comment to make it easier to find in the logs.
			MWExceptionHandler::logException( $e );

			$requestId = htmlspecialchars( WebRequest::getRequestId() );
			$info = "<!-- [$requestId] DiscussionTools could not add reply links on this page -->";
			$text .= "\n" . $info;

			return true;
		}

		$text = $newText;

		$duration = microtime( true ) - $start;

		$stats = MediaWikiServices::getInstance()->getStatsdDataFactory();
		$stats->timing( 'discussiontools.addReplyLinks', $duration * 1000 );

		return true;
	}

	/**
	 * Handler for the GetPreferences hook, to add and hide user preferences as configured
	 *
	 * @param User $user
	 * @param array &$preferences
	 */
	public static function onGetPreferences( User $user, array &$preferences ) {
		$services = MediaWikiServices::getInstance();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		if (
			$dtConfig->get( 'DiscussionToolsEnable' ) &&
			!$dtConfig->get( 'DiscussionToolsBeta' )
		) {
			$preferences['discussiontools-replytool'] = [
				'type' => 'toggle',
				'label-message' => 'discussiontools-preference-replytool',
				'help-message' => 'discussiontools-preference-replytool-help',
				'section' => 'editing/discussion',
			];
		}

		$preferences['discussiontools-showadvanced'] = [
			'type' => 'api',
		];

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
	 * @param User $user
	 * @param array &$preferences
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
		$tags = array_merge( $tags, static::TAGS );
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

		$tags = array_values( array_intersect( $tags, static::TAGS ) );

		if ( $tags ) {
			$recentChange->addTags( $tags );
		}

		return true;
	}
}
