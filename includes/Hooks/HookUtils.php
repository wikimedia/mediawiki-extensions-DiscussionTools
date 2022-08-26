<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use ExtensionRegistry;
use IContextSource;
use MediaWiki\Extension\DiscussionTools\CommentUtils;
use MediaWiki\Extension\DiscussionTools\ContentThreadItemSet;
use MediaWiki\Extension\Gadgets\GadgetRepo;
use MediaWiki\Extension\VisualEditor\ParsoidHelper;
use MediaWiki\Linker\LinkTarget;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\User\UserIdentity;
use MWException;
use OutputPage;
use Psr\Log\NullLogger;
use RequestContext;
use Title;
use TitleValue;
use Wikimedia\Assert\Assert;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

class HookUtils {
	public const REPLYTOOL = 'replytool';
	public const NEWTOPICTOOL = 'newtopictool';
	public const SOURCEMODETOOLBAR = 'sourcemodetoolbar';
	public const TOPICSUBSCRIPTION = 'topicsubscription';
	public const AUTOTOPICSUB = 'autotopicsub';
	public const VISUALENHANCEMENTS = 'visualenhancements';
	public const VISUALENHANCEMENTS_REPLY = 'visualenhancements_reply';
	public const VISUALENHANCEMENTS_PAGEFRAME = 'visualenhancements_pageframe';

	/**
	 * @var string[] List of all sub-features. Will be used to generate:
	 *  - Feature override global: $wgDiscussionTools_FEATURE
	 *  - Body class: ext-discussiontools-FEATURE-enabled
	 *  - User option: discussiontools-FEATURE
	 */
	public const FEATURES = [
		// Can't use static:: in compile-time constants
		self::REPLYTOOL,
		self::NEWTOPICTOOL,
		self::SOURCEMODETOOLBAR,
		self::TOPICSUBSCRIPTION,
		self::AUTOTOPICSUB,
		self::VISUALENHANCEMENTS,
		self::VISUALENHANCEMENTS_REPLY,
		self::VISUALENHANCEMENTS_PAGEFRAME,
	];

	public const FEATURES_CONFLICT_WITH_GADGET = [
		self::REPLYTOOL,
	];

	protected static $propCache = [];

	/**
	 * Check if a title has a page prop, and use an in-memory cache to avoid extra queries
	 *
	 * @param Title $title Title
	 * @param string $prop Page property
	 * @return bool Title has page property
	 */
	public static function hasPagePropCached( Title $title, string $prop ): bool {
		$id = $title->getArticleId();
		if ( !isset( static::$propCache[ $id ] ) ) {
			static::$propCache[ $id ] = [];
		}
		if ( !isset( static::$propCache[ $id ][ $prop ] ) ) {
			$services = MediaWikiServices::getInstance();
			$props = $services->getPageProps()->getProperties( $title, $prop );
			static::$propCache[ $id ][ $prop ] = isset( $props[ $id ] );
		}
		return static::$propCache[ $id ][ $prop ];
	}

	/**
	 * Parse a revision by using the discussion parser on the HTML provided by Parsoid.
	 *
	 * @param RevisionRecord $revRecord
	 * @return ContentThreadItemSet
	 */
	public static function parseRevisionParsoidHtml( RevisionRecord $revRecord ): ContentThreadItemSet {
		$services = MediaWikiServices::getInstance();
		$parsoidHelper = new ParsoidHelper(
			$services->getMainConfig(),
			new NullLogger(),
			false
		);

		// Get HTML for the revision
		$status = $parsoidHelper->requestRestbasePageHtml( $revRecord );

		if ( !$status->isOK() ) {
			[ 'message' => $msg, 'params' => $params ] = $status->getErrors()[0];
			throw new MWException( wfMessage( $msg, ...$params )->inLanguage( 'en' )->useDatabase( false )->text() );
		}

		$title = TitleValue::newFromPage( $revRecord->getPage() );

		$response = $status->getValue();
		$html = $response['body'];

		// Run the discussion parser on it
		$doc = DOMUtils::parseHTML( $html );
		$container = DOMCompat::getBody( $doc );

		CommentUtils::unwrapParsoidSections( $container );

		$parser = $services->getService( 'DiscussionTools.CommentParser' );
		return $parser->parse( $container, $title );
	}

	/**
	 * @param UserIdentity $user
	 * @param string $feature Feature to check for
	 * @return bool
	 */
	public static function featureConflictsWithGadget( UserIdentity $user, string $feature ) {
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()
			->makeConfig( 'discussiontools' );
		$gadgetName = $dtConfig->get( 'DiscussionToolsConflictingGadgetName' );
		if ( !$gadgetName ) {
			return false;
		}

		if ( !in_array( $feature, static::FEATURES_CONFLICT_WITH_GADGET ) ) {
			return false;
		}

		$extensionRegistry = ExtensionRegistry::getInstance();
		if ( $extensionRegistry->isLoaded( 'Gadgets' ) ) {
			$gadgetsRepo = GadgetRepo::singleton();
			$match = array_search( $gadgetName, $gadgetsRepo->getGadgetIds() );
			if ( $match !== false ) {
				try {
					return $gadgetsRepo->getGadget( $gadgetName )
						->isEnabled( $user );
				} catch ( \InvalidArgumentException $e ) {
					return false;
				}
			}
		}
		return false;
	}

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

		if (
			( $feature === static::TOPICSUBSCRIPTION || $feature === static::AUTOTOPICSUB ) &&
			!$user->isRegistered()
		) {
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

		// Being in the "test" group for this feature means it's enabled. This
		// overrules the wiki's beta feature setting. (However, a user who's
		// in the control group can still bypass this and enable the feature
		// normally.)
		$abtest = static::determineUserABTestBucket( $user, $feature );
		if ( $abtest === 'test' ) {
			return true;
		}

		// No feature-specific override found.

		if ( $dtConfig->get( 'DiscussionToolsBeta' ) ) {
			$betaenabled = $optionsLookup->getOption( $user, 'discussiontools-betaenable', 0 );
			return (bool)$betaenabled;
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
			if ( static::featureConflictsWithGadget( $user, $feature ) ) {
				return false;
			}
			// Check for a specific feature
			$enabled = $optionsLookup->getOption( $user, 'discussiontools-' . $feature );
			// `null` means there is no user option for this feature, so it must be enabled
			return $enabled === null ? true : $enabled;
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
	 * Currently this just checks whether the user is logged in, and assigns
	 * them to a consistent bucket based on their ID.
	 *
	 * @param UserIdentity $user
	 * @param string|null $feature Feature to check for (one of static::FEATURES)
	 *  Null will check for any DT feature.
	 * @return string 'test' if in the test group, 'control' if in the control group, or '' if
	 * 	they're not in the test
	 */
	public static function determineUserABTestBucket( UserIdentity $user, ?string $feature = null ): string {
		$services = MediaWikiServices::getInstance();
		$optionsManager = $services->getUserOptionsManager();
		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );

		$abtest = $dtConfig->get( 'DiscussionToolsABTest' );

		if (
			$user->isRegistered() &&
			( $feature ? ( $abtest == $feature ) : (bool)$abtest )
		) {
			return $user->getId() % 2 == 0 ? 'test' : 'control';
		}
		return '';
	}

	/**
	 * Check if the tools are available for a given title
	 *
	 * @param Title $title
	 * @param string|null $feature Feature to check for (one of static::FEATURES)
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	public static function isAvailableForTitle( Title $title, ?string $feature = null ): bool {
		// Only wikitext pages (e.g. not Flow boards, special pages)
		if ( $title->getContentModel() !== CONTENT_MODEL_WIKITEXT ) {
			return false;
		}
		if ( !$title->canExist() ) {
			return false;
		}

		$services = MediaWikiServices::getInstance();

		if ( $feature === static::VISUALENHANCEMENTS ) {
			$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
			$namespaces = $dtConfig->get( 'DiscussionTools_visualenhancements_namespaces' );
			if ( is_array( $namespaces ) ) {
				// Only allow visual enhancements in specified namespaces
				return in_array( $title->getNamespace(), $namespaces, true );
			}
		}

		$hasNewSectionLink = static::hasPagePropCached( $title, 'newsectionlink' );

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
		// Only show on normal page views (not history etc.), and in edit mode for previews
		if (
			// Don't try to call $output->getActionName if testing for NEWTOPICTOOL as we use
			// the hook onGetActionName to override the action for the tool on empty pages.
			// If we tried to call it here it would set up infinite recursion (T312689)
			$feature !== static::NEWTOPICTOOL &&
			!in_array( $output->getActionName(), [ 'view', 'edit', 'submit' ] )
		) {
			return false;
		}

		$title = $output->getTitle();
		// Don't show on pages without a Title
		if ( !$title ) {
			return false;
		}

		// Topic subscription is not available on your own talk page, as you will
		// get 'edit-user-talk' notifications already. (T276996)
		if (
			( $feature === static::TOPICSUBSCRIPTION || $feature === static::AUTOTOPICSUB ) &&
			$title->equals( $output->getUser()->getTalkPage() )
		) {
			return false;
		}

		// Subfeatures are disabled if the main feature is disabled
		if ( (
			$feature === static::VISUALENHANCEMENTS_REPLY ||
			$feature === static::VISUALENHANCEMENTS_PAGEFRAME
		) && !self::isFeatureEnabledForOutput( $output, static::VISUALENHANCEMENTS ) ) {
			return false;
		}

		// ?dtenable=1 overrides all user and title checks
		$queryEnable = $output->getRequest()->getRawVal( 'dtenable' ) ?:
			// Extra hack for parses from API, where this parameter isn't passed to derivative requests
			RequestContext::getMain()->getRequest()->getRawVal( 'dtenable' );

		if ( $queryEnable ) {
			return true;
		}

		if ( $queryEnable === '0' ) {
			// ?dtenable=0 forcibly disables the feature regardless of any other checks (T285578)
			return false;
		}

		if ( !static::isAvailableForTitle( $title, $feature ) ) {
			return false;
		}

		$isMobile = false;
		if ( ExtensionRegistry::getInstance()->isLoaded( 'MobileFrontend' ) ) {
			$mobFrontContext = MediaWikiServices::getInstance()->getService( 'MobileFrontend.Context' );
			$isMobile = $mobFrontContext->shouldDisplayMobileView();
		}
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'discussiontools' );

		if ( $isMobile ) {
			// Enabling mobile removes MobileFrontend's reply and new topic tools, so always
			// enable these tools as a replacement.
			return $dtConfig->get( 'DiscussionToolsEnableMobile' ) && (
				$feature === null ||
				$feature === static::REPLYTOOL ||
				$feature === static::NEWTOPICTOOL ||
				$feature === static::SOURCEMODETOOLBAR ||
				// Even though mobile ignores user preferences, TOPICSUBSCRIPTION must
				// still be disabled if the user isn't registered.
				( $feature === static::TOPICSUBSCRIPTION && $output->getUser()->isRegistered() ) ||
				// Even though mobile ignores user preferences, VISUALENHANCEMENTS must
				// still be disabled if is unavailable on the wiki.
				(
					(
						$feature === static::VISUALENHANCEMENTS ||
						$feature === static::VISUALENHANCEMENTS_REPLY ||
						$feature === static::VISUALENHANCEMENTS_PAGEFRAME
					) &&
					$dtConfig->get( 'DiscussionTools_' . $feature ) !== 'unavailable'
				)
			);
		}

		return static::isFeatureEnabledForUser( $output->getUser(), $feature );
	}

	/**
	 * Check if the "New section" tab would be shown in a normal skin.
	 *
	 * @param IContextSource $context
	 * @return bool
	 */
	public static function shouldShowNewSectionTab( IContextSource $context ): bool {
		$title = $context->getTitle();
		$output = $context->getOutput();

		// Match the logic in MediaWiki core (as defined in SkinTemplate::buildContentNavigationUrlsInternal):
		// https://gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/core/+/add6d0a0e38167a710fb47fac97ff3004451494c/includes/skins/SkinTemplate.php#1317
		// * __NONEWSECTIONLINK__ is not present (OutputPage::forceHideNewSectionLink) and...
		//   - This is the current revision of a non-redirect in a talk namespace or...
		//   - __NEWSECTIONLINK__ is present (OutputPage::showNewSectionLink)
		return (
			!static::hasPagePropCached( $title, 'nonewsectionlink' ) &&
			( ( $title->isTalkPage() && !$title->isRedirect() && $output->isRevisionCurrent() ) ||
				static::hasPagePropCached( $title, 'newsectionlink' ) )
		);
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
			( $req->getRawVal( 'action' ) === 'edit' || $req->getRawVal( 'veaction' ) === 'editsource' ) &&
			$req->getRawVal( 'section' ) === 'new' &&
			// Adding a new topic with preloaded text is not supported yet (T269310)
			!(
				$req->getCheck( 'editintro' ) || $req->getCheck( 'preload' ) ||
				$req->getCheck( 'preloadparams' ) || $req->getCheck( 'preloadtitle' )
			) &&
			// User has new topic tool enabled (and not using &dtenable=0)
			static::isFeatureEnabledForOutput( $out, static::NEWTOPICTOOL )
		);
	}

	/**
	 * Check if this page view should display the "empty state" message for empty talk pages.
	 *
	 * @param IContextSource $context
	 * @return bool
	 */
	public static function shouldDisplayEmptyState( IContextSource $context ): bool {
		$req = $context->getRequest();
		$out = $context->getOutput();
		$user = $context->getUser();
		$title = $context->getTitle();

		$optionsLookup = MediaWikiServices::getInstance()->getUserOptionsLookup();

		return (
			(
				// When following a red link from another page (but not when clicking the 'Edit' tab)
				(
					$req->getRawVal( 'action' ) === 'edit' && $req->getRawVal( 'redlink' ) === '1' &&
					// …if not disabled by the user
					$optionsLookup->getOption( $user, 'discussiontools-newtopictool-createpage' )
				) ||
				// When the new topic tool will be opened (usually when clicking the 'Add topic' tab)
				static::shouldOpenNewTopicTool( $context ) ||
				// In read mode (accessible for non-existent pages by clicking 'Cancel' in editor)
				$req->getRawVal( 'action', 'view' ) === 'view'
			) &&
			// Only in talk namespaces, not including other namespaces that isAvailableForTitle() allows
			$title->isTalkPage() &&
			// Only if the subject page or the user exists (T288319, T312560)
			static::pageSubjectExists( $title ) &&
			// The default display will probably be more useful for links to old revisions of deleted
			// pages (existing pages are already excluded in shouldShowNewSectionTab())
			$req->getIntOrNull( 'oldid' ) === null &&
			// Only if "New section" tab would be shown by the skin.
			// If the page doesn't exist, this only happens in talk namespaces.
			// If the page exists, it also considers magic words on the page.
			static::shouldShowNewSectionTab( $context ) &&
			// User has new topic tool enabled (and not using &dtenable=0)
			static::isFeatureEnabledForOutput( $out, static::NEWTOPICTOOL )
		);
	}

	/**
	 * Return whether the corresponding subject page exists, or (if the page is a user talk page,
	 * excluding subpages) whether the user is registered or a valid IP address.
	 *
	 * @param LinkTarget $talkPage
	 * @return bool
	 */
	private static function pageSubjectExists( LinkTarget $talkPage ): bool {
		$services = MediaWikiServices::getInstance();
		$namespaceInfo = $services->getNamespaceInfo();
		Assert::precondition( $namespaceInfo->isTalk( $talkPage->getNamespace() ), "Page is a talk page" );

		if ( $talkPage->getNamespace() === NS_USER_TALK && strpos( $talkPage->getText(), '/' ) === false ) {
			if ( $services->getUserNameUtils()->isIP( $talkPage->getText() ) ) {
				return true;
			}
			$subjectUser = $services->getUserFactory()->newFromName( $talkPage->getText() );
			if ( $subjectUser && $subjectUser->isRegistered() ) {
				return true;
			}
			return false;
		} else {
			$subjectPage = $namespaceInfo->getSubjectPage( $talkPage );
			return $services->getPageStore()->getPageForLink( $subjectPage )->exists();
		}
	}

	/**
	 * Check if we should be adding automatic topic subscriptions for this user on this page.
	 *
	 * @param UserIdentity $user
	 * @param Title $title
	 * @return bool
	 */
	public static function shouldAddAutoSubscription( UserIdentity $user, Title $title ): bool {
		// This duplicates the logic from isFeatureEnabledForOutput(),
		// because we don't have access to the request or the output here.

		// Topic subscription is not available on your own talk page, as you will
		// get 'edit-user-talk' notifications already. (T276996)
		// (can't use User::getTalkPage() to check because this is a UserIdentity)
		if ( $title->inNamespace( NS_USER_TALK ) && $title->getText() === $user->getName() ) {
			return false;
		}

		// Users flagged as bots shouldn't be autosubscribed. They can
		// manually subscribe if it becomes relevant. (T301933)
		$user = MediaWikiServices::getInstance()
			->getUserFactory()
			->newFromUserIdentity( $user );
		if ( $user->isBot() ) {
			return false;
		}

		// Check if the user has automatic subscriptions enabled, and the tools are enabled on the page.
		return static::isAvailableForTitle( $title ) &&
			static::isFeatureEnabledForUser( $user, static::AUTOTOPICSUB );
	}
}
