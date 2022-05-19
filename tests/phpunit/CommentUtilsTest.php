<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentUtils;
use MediaWiki\MediaWikiServices;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentUtils
 *
 * @group DiscussionTools
 */
class CommentUtilsTest extends IntegrationTestCase {
	/**
	 * @dataProvider provideIsSingleCommentSignedBy
	 * @covers ::isSingleCommentSignedBy
	 */
	public function testIsSingleCommentSignedBy(
		string $msg, string $title, string $username, string $html, bool $expected
	) {
		$doc = self::createDocument( $html );
		$container = self::getThreadContainer( $doc );

		$config = self::getJson( "../data/enwiki-config.json" );
		$data = self::getJson( "../data/enwiki-data.json" );
		$this->setupEnv( $config, $data );
		$title = MediaWikiServices::getInstance()->getTitleParser()->parseTitle( $title );
		$parser = self::createParser( $data );

		$threadItemSet = $parser->parse( $container, $title );
		$isSigned = CommentUtils::isSingleCommentSignedBy( $threadItemSet, $username, $container );
		self::assertEquals( $expected, $isSigned, $msg );
	}

	public function provideIsSingleCommentSignedBy(): array {
		return self::getJson( '../cases/isSingleCommentSignedBy.json' );
	}
}