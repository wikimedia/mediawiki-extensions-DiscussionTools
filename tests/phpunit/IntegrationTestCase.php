<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWikiIntegrationTestCase;

abstract class IntegrationTestCase extends MediaWikiIntegrationTestCase {

	use TestUtils;

	/**
	 * Setup the MW environment
	 *
	 * @param array $config
	 * @param array $data
	 */
	protected function setupEnv( array $config, array $data ): void {
		$this->setMwGlobals( $config );
		$this->setMwGlobals( [
			'wgArticlePath' => $config['wgArticlePath'],
			'wgNamespaceAliases' => $config['wgNamespaceIds'],
			'wgMetaNamespace' => strtr( $config['wgFormattedNamespaces'][NS_PROJECT], ' ', '_' ),
			'wgMetaNamespaceTalk' => strtr( $config['wgFormattedNamespaces'][NS_PROJECT_TALK], ' ', '_' ),
			// TODO: Move this to $config
			'wgLocaltimezone' => $data['localTimezone']
		] );
		$this->setUserLang( $config['wgContentLanguage'] );
		$this->setContentLang( $config['wgContentLanguage'] );
	}
}
