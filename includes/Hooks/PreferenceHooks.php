<?php
/**
 * DiscussionTools preference hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use ConfigFactory;
use MediaWiki\Auth\Hook\LocalUserCreatedHook;
use MediaWiki\MediaWikiServices;
use MediaWiki\Preferences\Hook\GetPreferencesHook;
use RequestContext;
use User;

class PreferenceHooks implements
	LocalUserCreatedHook,
	GetPreferencesHook
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
	 * Handler for the GetPreferences hook, to add and hide user preferences as configured
	 *
	 * @param User $user
	 * @param array &$preferences
	 */
	public function onGetPreferences( $user, &$preferences ) {
		if ( HookUtils::isFeatureAvailableToUser( $user ) ) {
			$preferences['discussiontools-summary'] = [
				'type' => 'info',
				'default' => wfMessage( 'discussiontools-preference-summary' )->parse(),
				'raw' => true,
				'section' => 'editing/discussion',
			];
		}
		foreach ( HookUtils::FEATURES as $feature ) {
			if ( HookUtils::isFeatureAvailableToUser( $user, $feature ) ) {
				$preferences["discussiontools-$feature"] = [
					'type' => 'toggle',
					'label-message' => "discussiontools-preference-$feature",
					'help-message' => "discussiontools-preference-$feature-help",
					'section' => 'editing/discussion',
				];
			}
		}

		if ( isset( $preferences['discussiontools-' . HookUtils::SOURCEMODETOOLBAR] ) ) {
			// Hide this option when it would have no effect
			// (both reply tool and new topic tool are disabled)
			$preferences['discussiontools-' . HookUtils::SOURCEMODETOOLBAR]['hide-if'] = [ 'AND',
				[ '===', 'discussiontools-' . HookUtils::REPLYTOOL, '' ],
				[ '===', 'discussiontools-' . HookUtils::NEWTOPICTOOL, '' ],
			];
		}

		$preferences['discussiontools-showadvanced'] = [
			'type' => 'api',
		];
		$preferences['discussiontools-abtest'] = [
			'type' => 'api',
		];

		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
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
			'validation-callback' => static function ( $value ) {
				return in_array( $value, [ '', 'source', 'visual' ], true );
			},
		];
	}

	/**
	 * Handler for the GetBetaFeaturePreferences hook, to add and hide user beta preferences as configured
	 *
	 * @param User $user
	 * @param array &$preferences
	 */
	public static function onGetBetaFeaturePreferences( User $user, array &$preferences ): void {
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
	 * Handler for LocalUserCreated hook.
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/LocalUserCreated
	 * @param User $user User object for the created user
	 * @param bool $autocreated Whether this was an auto-creation
	 * @return bool|void True or no return value to continue or false to abort
	 */
	public function onLocalUserCreated( $user, $autocreated ) {
		// We want new users to be created with email-subscriptions to our notifications enabled
		if ( !$autocreated ) {
			$userOptionsManager = MediaWikiServices::getInstance()->getUserOptionsManager();
			$userOptionsManager->setOption( $user, 'echo-subscriptions-email-dt-subscription', true );
			$user->saveSettings();
		}
	}

}
