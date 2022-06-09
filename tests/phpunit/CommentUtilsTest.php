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
		$doc = static::createDocument( $html );
		$container = static::getThreadContainer( $doc );

		$config = static::getJson( "../data/enwiki-config.json" );
		$data = static::getJson( "../data/enwiki-data.json" );
		$this->setupEnv( $config, $data );
		$title = MediaWikiServices::getInstance()->getTitleParser()->parseTitle( $title );
		$parser = static::createParser( $data );

		$threadItemSet = $parser->parse( $container, $title );
		$isSigned = CommentUtils::isSingleCommentSignedBy( $threadItemSet, $username, $container );
		static::assertEquals( $expected, $isSigned, $msg );
	}

	public function provideIsSingleCommentSignedBy(): array {
		return static::getJson( '../cases/isSingleCommentSignedBy.json' );
	}
}
