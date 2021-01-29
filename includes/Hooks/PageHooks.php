<?php
/**
 * DiscussionTools page hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use MediaWiki\Extension\DiscussionTools\Hooks;
use MediaWiki\Hook\BeforePageDisplayHook;
use MediaWiki\Hook\OutputPageBeforeHTMLHook;
use MediaWiki\MediaWikiServices;
use OutputPage;
use Skin;
use VisualEditorHooks;

class PageHooks implements
	BeforePageDisplayHook,
	OutputPageBeforeHTMLHook
{
	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output
	 * @param Skin $skin
	 * @return void This hook must not abort, it must return no value
	 */
	public function onBeforePageDisplay( $output, $skin ) : void {
		$user = $output->getUser();
		// Load modules if any DT feature is enabled for this user
		if ( Hooks::isFeatureEnabledForOutput( $output ) ) {
			$output->addModuleStyles( [
				'ext.discussionTools.init.styles'
			] );
			$output->addModules( [
				'ext.discussionTools.init'
			] );

			$output->addJsConfigVars(
				'wgDiscussionToolsFeaturesEnabled',
				[
					'replytool' => Hooks::isFeatureEnabledForOutput( $output, 'replytool' ),
					'newtopictool' => Hooks::isFeatureEnabledForOutput( $output, 'newtopictool' ),
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
	 * OutputPageBeforeHTML hook handler
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/OutputPageBeforeHTML
	 *
	 * @param OutputPage $output OutputPage object that corresponds to the page
	 * @param string &$text Text that will be displayed, in HTML
	 * @return bool|void This hook must not abort, it must return true or null.
	 */
	public function onOutputPageBeforeHTML( $output, &$text ) {
		// Check after the parser cache if reply links need to be added for
		// non-cacheable reasons i.e. query string or cookie
		// The addReplyLinks method is responsible for ensuring that
		// reply links aren't added twice.
		if ( Hooks::isFeatureEnabledForOutput( $output, 'replytool' ) ) {
			Hooks::addReplyLinks( $text, $output->getLanguage() );
		}
		return true;
	}
}
