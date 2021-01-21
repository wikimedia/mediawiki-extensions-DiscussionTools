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
	 * Check if a DiscussionTools feature is available to this user
	 *
	 * @param User $user
	 * @param string|null $feature Feature to check for: 'replytool' or 'newtopictool'.
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	private static function isFeatureAvailableToUser( User $user, ?string $feature = null ) : bool {
		$services = MediaWikiServices::getInstance();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		if ( !$dtConfig->get( 'DiscussionToolsEnable' ) ) {
			return false;
		}

		$optionsLookup = $services->getUserOptionsLookup();

		// Feature-specific override
		if ( $feature ) {
			if ( $dtConfig->get( 'DiscussionTools_' . $feature ) !== 'default' ) {
				// Feature setting can be 'available' or 'unavailable', overriding any BetaFeatures settings
				return $dtConfig->get( 'DiscussionTools_' . $feature ) === 'available';
			}
		} else {
			// Non-feature-specific override
			if (
				$dtConfig->get( 'DiscussionTools_replytool' ) === 'available' ||
				$dtConfig->get( 'DiscussionTools_newtopictool' ) === 'available'
			) {
				return true;
			}
		}

		// No feature-specific override found.

		if ( $dtConfig->get( 'DiscussionToolsBeta' ) ) {
			$betaenabled = $optionsLookup->getOption( $user, 'discussiontools-betaenable', -1 );
			if ( $betaenabled !== -1 ) {
				// betaenable doesn't have a default value, so we can check
				// for it being unset like this. If the user has explicitly
				// enabled or disabled it, we should immediatly return that.
				return $betaenabled;
			}
			// Otherwise, being in the "test" group for this feature means
			// it's effectively beta-enabled.
			return self::determineUserABTestBucket( $user, $feature ) === 'test';
		}

		// Assume that if BetaFeature is turned off, or user has it enabled, that
		// some features are available.
		// If this isn't the case, then DiscussionToolsEnable should have been set to false.
		return true;
	}

	/**
	 * Check if a DiscussionTools feature is enabled by this user
	 *
	 * @param User $user
	 * @param string|null $feature Feature to check for: 'replytool' or 'newtopictool'.
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	private static function isFeatureEnabledForUser( User $user, ?string $feature = null ) : bool {
		$services = MediaWikiServices::getInstance();
		$optionsLookup = $services->getUserOptionsLookup();
		return static::isFeatureAvailableToUser( $user, $feature ) && (
			// Check for a specific feature
			( $feature && $optionsLookup->getOption( $user, 'discussiontools-' . $feature ) ) ||
			// Check for any feature
			( !$feature && (
				$optionsLookup->getOption( $user, 'discussiontools-newtopictool' ) ||
				$optionsLookup->getOption( $user, 'discussiontools-replytool' )
			) )
		);
	}

	/**
	 * Work out the A/B test bucket for the current user
	 *
	 * Checks whether the A/B test is enabled and whether the user is enrolled
	 * in it; if they're eligible and not enrolled, it will enroll them.
	 *
	 * @param User $user
	 * @param string|null $feature Feature to check for: 'replytool' or 'newtopictool'.
	 *  Null will check for any DT feature.
	 * @return string 'test' if in the test group, 'control' if in the control group, or '' if they've
	 *  never been in the test
	 */
	private static function determineUserABTestBucket( $user, $feature = null ) : string {
		$services = MediaWikiServices::getInstance();
		$optionsManager = $services->getUserOptionsManager();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		$abtest = $dtConfig->get( 'DiscussionToolsABTest' );
		if (
			!$user->isAnon() &&
			( $abtest == 'all' || ( !$feature && $abtest ) || ( $feature && $abtest == $feature ) )
		) {
			// The A/B test is enabled, and the user is qualified to be in the
			// test by being logged in.
			$abstate = $optionsManager->getOption( $user, 'discussiontools-abtest' );
			if ( !$abstate && $optionsManager->getOption( $user, 'discussiontools-editmode' ) === '' ) {
				// Assign the user to a group. This is only being done to
				// users who have never used the tool before, for which we're
				// using the presence of discussiontools-editmode as a proxy,
				// as it should be set as soon as the user interacts with the tool.
				$abstate = $user->getId() % 2 == 0 ? 'test' : 'control';
				$optionsManager->setOption( $user, 'discussiontools-abtest', $abstate );
				$optionsManager->saveOptions( $user );
			}
			return $abstate;
		}
		return '';
	}

	/**
	 * Check if the tools are available for a given title
	 *
	 * @param Title $title
	 * @return bool
	 */
	private static function isAvailableForTitle( Title $title ) : bool {
		// Only wikitext pages (e.g. not Flow boards)
		if ( $title->getContentModel() !== CONTENT_MODEL_WIKITEXT ) {
			return false;
		}

		$services = MediaWikiServices::getInstance();

		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		$props = PageProps::getInstance()->getProperties( $title, 'newsectionlink' );
		$hasNewSectionLink = isset( $props[ $title->getArticleId() ] );

		// Check that the page supports discussions.
		// Treat pages with __NEWSECTIONLINK__ as talk pages (T245890)
		return $hasNewSectionLink ||
			// `wantSignatures` includes talk pages
			$services->getNamespaceInfo()->wantSignatures( $title->getNamespace() );
			// TODO: Consider not loading if forceHideNewSectionLink is true.
	}

	/**
	 * Check if the tool is available on a given page
	 *
	 * @param OutputPage $output
	 * @param string|null $feature Feature to check for: 'replytool' or 'newtopictool'.
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	private static function isFeatureEnabledForOutput( OutputPage $output, ?string $feature = null ) : bool {
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

		// ?dtenable=1 overrides all user and title checks
		if (
			$output->getRequest()->getVal( 'dtenable' ) ||
			// Extra hack for parses from API, where this parameter isn't passed to derivative requests
			RequestContext::getMain()->getRequest()->getVal( 'dtenable' )
		) {
			return true;
		}

		return static::isAvailableForTitle( $title ) && (
			static::isFeatureEnabledForUser( $output->getUser(), $feature ) ||
			// The cookie hack allows users to enable all features when they are not
			// yet available on the wiki
			$output->getRequest()->getCookie( 'discussiontools-tempenable' ) ?: false
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
		$user = $output->getUser();
		// Load modules if any DT feature is enabled for this user
		if ( static::isFeatureEnabledForOutput( $output ) ) {
			$output->addModuleStyles( [
				'ext.discussionTools.init.styles'
			] );
			$output->addModules( [
				'ext.discussionTools.init'
			] );

			$output->addJsConfigVars(
				'wgDiscussionToolsFeaturesEnabled',
				[
					'replytool' => static::isFeatureEnabledForOutput( $output, 'replytool' ),
					'newtopictool' => static::isFeatureEnabledForOutput( $output, 'newtopictool' ),
				]
			);

			$services = MediaWikiServices::getInstance();
			$optionsLookup = $services->getUserOptionsLookup();
			$req = $output->getRequest();
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
		if ( !static::isFeatureEnabledForOutput( $output, 'replytool' ) ) {
			return true;
		}

		$start = microtime( true );
		try {
			// Add reply links and hidden data about comment ranges.
			$newText = CommentFormatter::addReplyLinks( $text, $output->getLanguage() );
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
		if ( static::isFeatureAvailableToUser( $user, 'replytool' ) ) {
			$preferences['discussiontools-replytool'] = [
				'type' => 'toggle',
				'label-message' => 'discussiontools-preference-replytool',
				'help-message' => 'discussiontools-preference-replytool-help',
				'section' => 'editing/discussion',
			];
		}
		if ( static::isFeatureAvailableToUser( $user, 'newtopictool' ) ) {
			$preferences['discussiontools-newtopictool'] = [
				'type' => 'toggle',
				'label-message' => 'discussiontools-preference-newtopictool',
				'help-message' => 'discussiontools-preference-newtopictool-help',
				'section' => 'editing/discussion',
			];
		}

		$preferences['discussiontools-showadvanced'] = [
			'type' => 'api',
		];
		$preferences['discussiontools-abtest'] = [
			'type' => 'api',
		];

		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()
			->makeConfig( 'discussiontools' );
		if (
			!$dtConfig->get( 'DiscussionToolsEnable' ) ||
			!$dtConfig->get( 'DiscussionToolsBeta' )
		) {
			// When out of beta, preserve the user preference in case we
			// bring back the beta feature for a new sub-feature. (T272071)
			$preferences['discussiontools-betaenable'] = [
				'type' => 'api'
			];
		}

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
