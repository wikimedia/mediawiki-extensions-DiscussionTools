<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentItem;
use MediaWiki\Extension\DiscussionTools\CommentUtils;
use MediaWiki\Extension\DiscussionTools\HeadingItem;
use MediaWiki\Extension\DiscussionTools\ImmutableRange;
use MediaWiki\Extension\DiscussionTools\ThreadItem;
use Wikimedia\Parsoid\Utils\DOMCompat;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\ThreadItem
 *
 * @group DiscussionTools
 */
class ThreadItemTest extends IntegrationTestCase {
	/**
	 * @dataProvider provideAuthors
	 * @covers ::getAuthorsBelow
	 */
	public function testGetAuthorsBelow( array $thread, array $expected ): void {
		$doc = $this->createDocument( '' );
		$node = $doc->createElement( 'div' );
		$range = new ImmutableRange( $node, 0, $node, 0 );

		$makeThreadItem = static function ( array $arr ) use ( &$makeThreadItem, $range ): ThreadItem {
			if ( $arr['type'] === 'comment' ) {
				$item = new CommentItem( 1, $range, [], 'TIMESTAMP', $arr['author'] );
			} else {
				$item = new HeadingItem( $range, 2 );
			}
			foreach ( $arr['replies'] as $reply ) {
				$item->addReply( $makeThreadItem( $reply ) );
			}
			return $item;
		};

		$threadItem = $makeThreadItem( $thread );

		self::assertEquals( $expected, $threadItem->getAuthorsBelow() );
	}

	public function provideAuthors(): array {
		return self::getJson( '../cases/authors.json' );
	}

	/**
	 * @dataProvider provideTranscludedFrom
	 * @covers ::getTranscludedFrom
	 * @covers \MediaWiki\Extension\DiscussionTools\CommentUtils::unwrapParsoidSections
	 */
	public function testGetTranscludedFrom(
		string $name, string $dom, string $expected, string $config, string $data
	): void {
		$dom = self::getHtml( $dom );
		$expectedPath = $expected;
		$expected = self::getJson( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );

		$doc = self::createDocument( $dom );
		$container = DOMCompat::getBody( $doc );

		CommentUtils::unwrapParsoidSections( $container );

		$parser = self::createParser( $container, $data );
		$comments = $parser->getCommentItems();

		$transcludedFrom = [];
		foreach ( $comments as $comment ) {
			$transcludedFrom[ $comment->getId() ] = $comment->getTranscludedFrom();
		}

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteJsonFile( $expectedPath, $transcludedFrom );
		}

		self::assertEquals(
			$expected,
			$transcludedFrom,
			$name
		);
	}

	public function provideTranscludedFrom(): array {
		return self::getJson( '../cases/transcluded.json' );
	}

}
