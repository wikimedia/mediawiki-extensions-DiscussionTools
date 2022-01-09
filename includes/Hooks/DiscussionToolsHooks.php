<?php
/**
 * DiscussionTools hooks for listening to our own hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use ExtensionRegistry;
use IContextSource;
use MediaWiki\Extension\DiscussionTools\OverflowMenuItem;
use MediaWiki\MediaWikiServices;
use MediaWiki\User\UserNameUtils;

class DiscussionToolsHooks implements
	DiscussionToolsAddOverflowMenuItemsHook
{

	/**
	 * @param OverflowMenuItem[] &$overflowMenuItems
	 * @param string[] &$resourceLoaderModules
	 * @param array $threadItemData
	 * @param IContextSource $contextSource
	 * @return bool|void
	 */
	public function onDiscussionToolsAddOverflowMenuItems(
		array &$overflowMenuItems,
		array &$resourceLoaderModules,
		array $threadItemData,
		IContextSource $contextSource
	) {
		if (
			( $threadItemData['type'] ?? null ) === 'heading' &&
			!( $threadItemData['uneditableSection'] ?? false ) &&
			$contextSource->getSkin()->getSkinName() === 'minerva'
		) {
			$overflowMenuItems[] = new OverflowMenuItem(
				'edit',
				'edit',
				$contextSource->msg( 'skin-view-edit' ),
				2
			);
		}

		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'discussiontools' );
		if ( $dtConfig->get( 'DiscussionToolsEnableThanks' ) ) {
			$user = $contextSource->getUser();
			$showThanks = ExtensionRegistry::getInstance()->isLoaded( 'Thanks' );
			if ( $showThanks && ( $threadItemData['type'] ?? null ) === 'comment' && $user->isNamed() ) {
				$userNameUtils = MediaWikiServices::getInstance()->getUserNameUtils();
				$recipient = $userNameUtils->getCanonical( $threadItemData['author'], UserNameUtils::RIGOR_NONE );

				if (
					$recipient !== $user->getName() &&
					!$userNameUtils->isIP( $recipient )
				) {
					$overflowMenuItems[] = new OverflowMenuItem(
						'thank',
						'heart',
						$contextSource->msg( 'thanks-button-thank' ),
					);
				}
			}
		}
	}
}
