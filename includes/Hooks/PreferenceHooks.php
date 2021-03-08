<?php
/**
 * DiscussionTools preference hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use MediaWiki\MediaWikiServices;
use MediaWiki\Preferences\Hook\GetPreferencesHook;
use RequestContext;
use User;

class PreferenceHooks implements
	GetPreferencesHook
{
	/**
	 * Handler for the GetPreferences hook, to add and hide user preferences as configured
	 *
	 * @param User $user
	 * @param array &$preferences
	 */
	public function onGetPreferences( $user, &$preferences ) {
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

		if ( isset( $preferences['discussiontools-sourcemodetoolbar'] ) ) {
			// Hide this option when it would have no effect
			// (both reply tool and new topic tool are disabled)
			$preferences['discussiontools-sourcemodetoolbar']['hide-if'] = [ 'AND',
				[ '===', 'discussiontools-replytool', '' ],
				[ '===', 'discussiontools-newtopictool', '' ],
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
	 * Handler for the GetBetaFeaturePreferences hook, to add and hide user beta preferences as configured
	 *
	 * @param User $user
	 * @param array &$preferences
	 */
	public static function onGetBetaFeaturePreferences( User $user, array &$preferences ) : void {
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
}
