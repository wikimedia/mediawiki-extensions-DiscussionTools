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
use ExtensionRegistry;
use Language;
use MediaWiki\MediaWikiServices;
use MWExceptionHandler;
use OutputPage;
use PageProps;
use RequestContext;
use Throwable;
use Title;
use User;
use WebRequest;

class Hooks {

	private const REPLY_LINKS_COMMENT = '<!-- DiscussionTools addReplyLinks called -->';

	/**
	 * Check if a DiscussionTools feature is available to this user
	 *
	 * @param User $user
	 * @param string|null $feature Feature to check for: 'replytool' or 'newtopictool'.
	 *  Null will check for any DT feature.
	 * @return bool
	 */
	public static function isFeatureAvailableToUser( User $user, ?string $feature = null ) : bool {
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
	public static function isFeatureEnabledForUser( User $user, ?string $feature = null ) : bool {
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
	public static function isAvailableForTitle( Title $title ) : bool {
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
	public static function isFeatureEnabledForOutput( OutputPage $output, ?string $feature = null ) : bool {
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
	 * Add reply links to some HTML
	 *
	 * @param string &$text Parser text output
	 * @param Language $lang Interface language
	 */
	public static function addReplyLinks( string &$text, Language $lang ) {
		$start = microtime( true );

		// Never add links twice.
		// This is required because we try again to add links to cached content
		// to support query string or cookie enabling
		if ( strpos( $text, static::REPLY_LINKS_COMMENT ) !== false ) {
			return;
		}

		$text = $text . "\n" . static::REPLY_LINKS_COMMENT;

		try {
			// Add reply links and hidden data about comment ranges.
			$newText = CommentFormatter::addReplyLinks( $text, $lang );
		} catch ( Throwable $e ) {
			// Catch errors, so that they don't cause the entire page to not display.
			// Log it and add the request ID in a comment to make it easier to find in the logs.
			MWExceptionHandler::logException( $e );

			$requestId = htmlspecialchars( WebRequest::getRequestId() );
			$info = "<!-- [$requestId] DiscussionTools could not add reply links on this page -->";
			$text .= "\n" . $info;

			return;
		}

		$text = $newText;
		$duration = microtime( true ) - $start;

		$stats = MediaWikiServices::getInstance()->getStatsdDataFactory();
		$stats->timing( 'discussiontools.addReplyLinks', $duration * 1000 );
	}
}
