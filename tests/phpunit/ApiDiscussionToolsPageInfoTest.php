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
		$dom = self::getHtml( $dom );
		$expectedPath = $expected;
		$expected = self::getJson( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$doc = self::createDocument( $dom );
		$container = self::getThreadContainer( $doc );

		$this->setupEnv( $config, $data );
		$title = MediaWikiServices::getInstance()->getTitleParser()->parseTitle( $title );
		$threadItemSet = self::createParser( $data )->parse( $container, $title );

		$pageInfo = TestingAccessWrapper::newFromClass( ApiDiscussionToolsPageInfo::class );

		$threadItemsHtml = $pageInfo->getThreadItemsHtml( $threadItemSet );

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteJsonFile( $expectedPath, $threadItemsHtml );
		}

		self::assertEquals( $expected, $threadItemsHtml, $name );

		$processedThreads = [];
	}

	public function provideGetThreadItemsHtml(): array {
		return self::getJson( '../cases/threaditemshtml.json' );
	}

}
