<?php
/**
 * DiscussionTools resource loader hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use Config;
use ConfigFactory;
use MediaWiki\ResourceLoader\Hook\ResourceLoaderGetConfigVarsHook;

class ResourceLoaderHooks implements
	ResourceLoaderGetConfigVarsHook
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
	 * Set static (not request-specific) JS configuration variables
	 *
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ResourceLoaderGetConfigVars
	 * @param array &$vars Array of variables to be added into the output of the startup module
	 * @param string $skin Current skin name to restrict config variables to a certain skin
	 * @param Config $config
	 */
	public function onResourceLoaderGetConfigVars( array &$vars, $skin, Config $config ): void {
		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );

		$vars['wgDTSchemaEditAttemptStepSamplingRate'] =
			$dtConfig->get( 'DTSchemaEditAttemptStepSamplingRate' );
		$vars['wgDTSchemaEditAttemptStepOversample'] =
			$dtConfig->get( 'DTSchemaEditAttemptStepOversample' );

		$abtest = $dtConfig->get( 'DiscussionToolsABTest' );
		if ( $abtest ) {
			$vars['wgDiscussionToolsABTest'] = $abtest;
		}
	}

}
