<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\ApiDiscussionToolsPageInfo;
use MediaWiki\MediaWikiServices;
use Wikimedia\TestingAccessWrapper;

/**
 * @group medium
 *
 * @covers \MediaWiki\Extension\DiscussionTools\ApiDiscussionToolsPageInfo
 */
class ApiDiscussionToolsPageInfoTest extends IntegrationTestCase {

	/**
	 * @dataProvider provideGetThreadItemsHtml
	 * @covers \MediaWiki\Extension\DiscussionTools\ApiDiscussionToolsPageInfo::getThreadItemsHtml
	 */
	public function testGetThreadItemsHtml(
		string $name, string $title, string $dom, string $expected, string $config, string $data
	): void {
		$dom = static::getHtml( $dom );
		$expectedPath = $expected;
		$expected = static::getJson( $expected );
		$config = static::getJson( $config );
		$data = static::getJson( $data );

		$doc = static::createDocument( $dom );
		$container = static::getThreadContainer( $doc );

		$this->setupEnv( $config, $data );
		$title = MediaWikiServices::getInstance()->getTitleParser()->parseTitle( $title );
		$threadItemSet = static::createParser( $data )->parse( $container, $title );

		$pageInfo = TestingAccessWrapper::newFromClass( ApiDiscussionToolsPageInfo::class );

		$threadItemsHtml = $pageInfo->getThreadItemsHtml( $threadItemSet );

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			static::overwriteJsonFile( $expectedPath, $threadItemsHtml );
		}

		static::assertEquals( $expected, $threadItemsHtml, $name );

		$processedThreads = [];
	}

	public function provideGetThreadItemsHtml(): array {
		return static::getJson( '../cases/threaditemshtml.json' );
	}

}
