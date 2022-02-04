<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentUtils;
use Title;
use Wikimedia\Parsoid\Utils\DOMCompat;

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
		$title = Title::newFromText( $title );
		$doc = self::createDocument( $html );
		$body = DOMCompat::getBody( $doc );

		$config = self::getJson( "../data/enwiki-config.json" );
		$data = self::getJson( "../data/enwiki-data.json" );
		$this->setupEnv( $config, $data );
		$parser = self::createParser( $data );

		$threadItemSet = $parser->parse( $body, $title );
		$isSigned = CommentUtils::isSingleCommentSignedBy( $threadItemSet, $username, $body );
		self::assertEquals( $expected, $isSigned, $msg );
	}

	public function provideIsSingleCommentSignedBy(): array {
		return self::getJson( '../cases/isSingleCommentSignedBy.json' );
	}
}
