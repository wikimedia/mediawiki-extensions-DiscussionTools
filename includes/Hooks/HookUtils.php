<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use Action;
use ExtensionRegistry;
use IContextSource;
use MediaWiki\MediaWikiServices;
use MediaWiki\User\UserIdentity;
use OutputPage;
use RequestContext;
use Title;

class HookUtils {
	public const REPLYTOOL = 'replytool';
	public const NEWTOPICTOOL = 'newtopictool';
	public const SOURCEMODETOOLBAR = 'sourcemodetoolbar';
	public const TOPICSUBSCRIPTION = 'topicsubscription';
	/**
	 * @var string[] List of all sub-features. Will be used to generate:
	 *  - Feature override global: $wgDiscussionTools_FEATURE
	 *  - Body class: ext-discussiontools-FEATURE-enabled
	 *  - User option: discussiontools-FEATURE
	 */
	public const FEATURES = [
		self::REPLYTOOL,
		self::NEWTOPICTOOL,
		self::SOURCEMODETOOLBAR,
		self::TOPICSUBSCRIPTION,
	];

	/**
	 * Check if a DiscussionTools feature is available to this user
	 *
	 * @param UserIdentity $user
	 * @param string|null $feature Feature to check for (one of static::FEATURES)
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	public static function isFeatureAvailableToUser( UserIdentity $user, ?string $feature = null ): bool {
		$services = MediaWikiServices::getInstance();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		if ( !$dtConfig->get( 'DiscussionToolsEnable' ) ) {
			return false;
		}

		if ( $feature === self::TOPICSUBSCRIPTION && !$user->isRegistered() ) {
			// Users must be logged in to use topic subscription
			return false;
		}

		$optionsLookup = $services->getUserOptionsLookup();

		if ( $feature ) {
			// Feature-specific override
			if ( $dtConfig->get( 'DiscussionTools_' . $feature ) !== 'default' ) {
				// Feature setting can be 'available' or 'unavailable', overriding any BetaFeatures settings
				return $dtConfig->get( 'DiscussionTools_' . $feature ) === 'available';
			}
		} else {
			// Non-feature-specific override, check for any feature
			foreach ( static::FEATURES as $feat ) {
				if ( $dtConfig->get( 'DiscussionTools_' . $feat ) === 'available' ) {
					return true;
				}
			}
		}

		// No feature-specific override found.

		if ( $dtConfig->get( 'DiscussionToolsBeta' ) ) {
			$betaenabled = $optionsLookup->getOption( $user, 'discussiontools-betaenable', -1 );
			if ( $betaenabled !== -1 ) {
				// betaenable doesn't have a default value, so we can check
				// for it being unset like this. If the user has explicitly
				// enabled or disabled it, we should immediately return that.
				return $betaenabled;
			}
			// Otherwise, being in the "test" group for this feature means
			// it's effectively beta-enabled.
			return static::determineUserABTestBucket( $user, $feature ) === 'test';
		}

		// Assume that if BetaFeature is turned off, or user has it enabled, that
		// some features are available.
		// If this isn't the case, then DiscussionToolsEnable should have been set to false.
		return true;
	}

	/**
	 * Check if a DiscussionTools feature is enabled by this user
	 *
	 * @param UserIdentity $user
	 * @param string|null $feature Feature to check for (one of static::FEATURES)
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	public static function isFeatureEnabledForUser( UserIdentity $user, ?string $feature = null ): bool {
		if ( !static::isFeatureAvailableToUser( $user, $feature ) ) {
			return false;
		}
		$services = MediaWikiServices::getInstance();
		$optionsLookup = $services->getUserOptionsLookup();
		if ( $feature ) {
			// Check for a specific feature
			return $optionsLookup->getOption( $user, 'discussiontools-' . $feature );
		} else {
			// Check for any feature
			foreach ( static::FEATURES as $feat ) {
				if ( $optionsLookup->getOption( $user, 'discussiontools-' . $feat ) ) {
					return true;
				}
			}
			return false;
		}
	}

	/**
	 * Work out the A/B test bucket for the current user
	 *
	 * Checks whether the user has been enrolled in the last A/B test, if any was enabled.
	 *
	 * If the A/B test is enabled, and the user is eligible and not enrolled, it will enroll them.
	 *
	 * @param UserIdentity $user
	 * @param string|null $feature Feature to check for (one of static::FEATURES)
	 *  Null will check for any DT feature.
	 * @return string 'test' if in the test group, 'control' if in the control group, or '' if they've
	 *  never been in the test
	 */
	private static function determineUserABTestBucket( $user, $feature = null ): string {
		$services = MediaWikiServices::getInstance();
		$optionsManager = $services->getUserOptionsManager();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		$abtest = $dtConfig->get( 'DiscussionToolsABTest' );
		$abstate = $optionsManager->getOption( $user, 'discussiontools-abtest' );

		if (
			$user->isRegistered() &&
			( $abtest == 'all' || ( !$feature && $abtest ) || ( $feature && $abtest == $feature ) )
		) {
			// The A/B test is enabled, and the user is qualified to be in the
			// test by being logged in.
			if ( !$abstate && $optionsManager->getOption( $user, 'discussiontools-editmode' ) === '' ) {
				// Assign the user to a group. This is only being done to
				// users who have never used the tool before, for which we're
				// using the presence of discussiontools-editmode as a proxy,
				// as it should be set as soon as the user interacts with the tool.
				$abstate = $user->getId() % 2 == 0 ? 'test' : 'control';
				$optionsManager->setOption( $user, 'discussiontools-abtest', $abstate );
				$optionsManager->saveOptions( $user );
			}
		}
		return $abstate;
	}

	/**
	 * Check if the tools are available for a given title
	 *
	 * @param Title $title
	 * @return bool
	 */
	public static function isAvailableForTitle( Title $title ): bool {
		// Only wikitext pages (e.g. not Flow boards, special pages)
		if ( $title->getContentModel() !== CONTENT_MODEL_WIKITEXT ) {
			return false;
		}
		if ( !$title->canExist() ) {
			return false;
		}

		$services = MediaWikiServices::getInstance();

		$props = $services->getPageProps()->getProperties( $title, 'newsectionlink' );
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
	 * @param string|null $feature Feature to check for (one of static::FEATURES)
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	public static function isFeatureEnabledForOutput( OutputPage $output, ?string $feature = null ): bool {
		// Don't show on edit pages, history, etc.
		if ( $feature !== self::NEWTOPICTOOL && Action::getActionName( $output->getContext() ) !== 'view' ) {
			return false;
		}

		$title = $output->getTitle();
		// Don't show on pages without a Title
		if ( !$title ) {
			return false;
		}

		$isMobile = false;
		if ( ExtensionRegistry::getInstance()->isLoaded( 'MobileFrontend' ) ) {
			$mobFrontContext = MediaWikiServices::getInstance()->getService( 'MobileFrontend.Context' );
			$isMobile = $mobFrontContext->shouldDisplayMobileView();
		}

		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'discussiontools' );

		if ( $isMobile && (
			!$dtConfig->get( 'DiscussionToolsEnableMobile' ) ||
			// Still disable some features for now
			$feature === self::TOPICSUBSCRIPTION
		) ) {
			return false;
		}

		// Topic subscription is not available on your own talk page, as you will
		// get 'edit-user-talk' notifications already. (T276996)
		if ( $feature === self::TOPICSUBSCRIPTION && $title->equals( $output->getUser()->getTalkPage() ) ) {
			return false;
		}

		// New topic tool is not available if __NONEWSECTIONLINK__ is set
		// We may need to move this check to the client when we support
		// launching the tool from other pages.
		if ( $feature === self::NEWTOPICTOOL ) {
			$services = MediaWikiServices::getInstance();
			$props = $services->getPageProps()->getProperties( $title, 'nonewsectionlink' );
			if ( isset( $props[ $title->getArticleId() ] ) ) {
				return false;
			}
		}

		// ?dtenable=1 overrides all user and title checks
		$queryEnable = $output->getRequest()->getRawVal( 'dtenable' ) ?:
			// Extra hack for parses from API, where this parameter isn't passed to derivative requests
			RequestContext::getMain()->getRequest()->getRawVal( 'dtenable' );

		if (
			$feature === self::TOPICSUBSCRIPTION &&
			!$dtConfig->get( 'DiscussionToolsEnableTopicSubscriptionBackend' )
		) {
			// Can't be enabled via query, because the tables may not exist yet (T280082)
			$queryEnable = false;
		}

		if ( $queryEnable ) {
			return true;
		}

		if ( $queryEnable === "0" ) {
			// ?dtenable=0 forcibly disables the feature regardless of any other checks (T285578)
			return false;
		}

		return static::isAvailableForTitle( $title ) &&
			static::isFeatureEnabledForUser( $output->getUser(), $feature );
	}

	/**
	 * Check if this page view should open the new topic tool on page load.
	 *
	 * @param IContextSource $context
	 * @return bool
	 */
	public static function shouldOpenNewTopicTool( IContextSource $context ): bool {
		$req = $context->getRequest();
		$out = $context->getOutput();

		return (
			// ?title=...&action=edit&section=new
			// ?title=...&veaction=editsource&section=new
			( $req->getVal( 'action' ) === 'edit' || $req->getVal( 'veaction' ) === 'editsource' ) &&
			$req->getVal( 'section' ) === 'new' &&
			// Adding a new topic with preloaded text is not supported yet (T269310)
			!(
				$req->getVal( 'editintro' ) || $req->getVal( 'preload' ) ||
				$req->getVal( 'preloadparams' ) || $req->getVal( 'preloadtitle' )
			) &&
			// User has new topic tool enabled (and not using &dtenable=0)
			self::isFeatureEnabledForOutput( $out, self::NEWTOPICTOOL )
		);
	}

	/**
	 * Check if this page view should display the empty state for talk pages that don't exist.
	 *
	 * @param IContextSource $context
	 * @return bool
	 */
	public static function shouldDisplayEmptyState( IContextSource $context ): bool {
		$req = $context->getRequest();
		$out = $context->getOutput();
		$title = $context->getTitle();

		return (
			(
				// When following a red link from another page (but not when clicking the 'Edit' tab)
				( $req->getVal( 'action' ) === 'edit' && $req->getVal( 'redlink' ) === '1' ) ||
				// When the new topic tool will be opened (usually when clicking the 'Add topic' tab)
				self::shouldOpenNewTopicTool( $context ) ||
				// In read mode (accessible for non-existent pages by clicking 'Cancel' in editor)
				$req->getVal( 'action', 'view' ) === 'view'
			) &&
			// Duh
			!$title->exists() &&
			// Only in talk namespaces, not including other namespaces that isAvailableForTitle() allows
			$title->isTalkPage() &&
			// The default display will probably be more useful for...
			// ...Permanent links to revisions of pages which have been deleted
			$req->getIntOrNull( 'oldid' ) === null &&
			// ...Non-existent pages with default content, e.g. in 'MediaWiki:' namespace
			!$title->hasSourceText() &&
			// User has new topic tool enabled (and not using &dtenable=0)
			self::isFeatureEnabledForOutput( $out, self::NEWTOPICTOOL )
		);
	}
}
