<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\MainConfigNames;
use MediaWiki\Page\PageProps;
use MediaWiki\Registration\ExtensionRegistry;
use MediaWiki\Title\Title;
use MediaWikiIntegrationTestCase;

/**
 * @covers \MediaWiki\Extension\DiscussionTools\Hooks\HookUtils
 */
class HookUtilsTest extends MediaWikiIntegrationTestCase {

	public static function provideIsAvailableForTitle() {
		$ve = HookUtils::VISUALENHANCEMENTS;
		$reply = HookUtils::REPLYTOOL;
		return [
			// Visual enhancements
			'VE: talk page' =>
				[ $ve, NS_TALK, [], [], true ],
			'VE: talk page with NOTALK' =>
				[ $ve, NS_TALK, [ 'notalk' ], [], false ],
			'VE: talk page with ARCHIVEDTALK' =>
				[ $ve, NS_TALK, [ 'archivedtalk' ], [], true ],
			'VE: project page' =>
				[ $ve, NS_PROJECT, [], [], false ],
			'VE: project page with NEWSECTIONLINK' =>
				[ $ve, NS_PROJECT, [ 'newsectionlink' ], [], true ],
			'VE: project page with ARCHIVEDTALK' =>
				[ $ve, NS_PROJECT, [ 'archivedtalk' ], [], true ],
			'VE: signature project page' =>
				[ $ve, NS_PROJECT, [], [ NS_PROJECT ], false ],
			'VE: main page with NEWSECTIONLINK' =>
				[ $ve, NS_MAIN, [ 'newsectionlink' ], [], false ],
			'VE: signature main page with NEWSECTIONLINK' =>
				[ $ve, NS_MAIN, [ 'newsectionlink' ], [ NS_MAIN ], true ],

			// Reply tool
			'Reply: talk page' =>
				[ $reply, NS_TALK, [], [], true ],
			'Reply: talk page with ARCHIVEDTALK' =>
				[ $reply, NS_TALK, [ 'archivedtalk' ], [], false ],
			'Reply: project page' =>
				[ $reply, NS_PROJECT, [], [], false ],
			'Reply: project page with NEWSECTIONLINK' =>
				[ $reply, NS_PROJECT, [ 'newsectionlink' ], [], true ],
			'Reply: signature project page' =>
				[ $reply, NS_PROJECT, [], [ NS_PROJECT ], true ],

			// Any feature
			'Any: talk page with ARCHIVEDTALK' =>
				[ null, NS_TALK, [ 'archivedtalk' ], [], true ],
			'Any: talk page with NOTALK' =>
				[ null, NS_TALK, [ 'notalk' ], [], false ],
			'Any: main page' =>
				[ null, NS_MAIN, [], [], false ],
		];
	}

	/**
	 * @dataProvider provideIsAvailableForTitle
	 */
	public function testIsAvailableForTitle(
		?string $feature, int $ns, array $props, array $signatureNamespaces, bool $expected
	) {
		if ( ExtensionRegistry::getInstance()->isLoaded( 'Liquid Threads' ) ) {
			$this->overrideConfigValue( 'LqtTalkPages', false );
		}
		$this->overrideConfigValue( MainConfigNames::ExtraSignatureNamespaces, $signatureNamespaces );

		$title = Title::makeTitle( $ns, 'HookUtilsTest' );
		$title->resetArticleID( 1 );
		$title->setContentModel( CONTENT_MODEL_WIKITEXT );

		$pageProps = $this->createMock( PageProps::class );
		$pageProps->method( 'getProperties' )
			->willReturn( [ 1 => array_fill_keys( $props, '' ) ] );
		$this->setService( 'PageProps', $pageProps );

		$this->assertSame( $expected, HookUtils::isAvailableForTitle( $title, $feature ) );
	}
}
