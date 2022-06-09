<?php

namespace MediaWiki\Extension\DiscussionTools\Tests\Unit;

use MediaWiki\Extension\DiscussionTools\CommentUtils;
use MediaWiki\Extension\DiscussionTools\Tests\TestUtils;
use MediaWikiUnitTestCase;
use Wikimedia\Parsoid\Utils\DOMCompat;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentUtils
 *
 * @group DiscussionTools
 */
class CommentUtilsTest extends MediaWikiUnitTestCase {

	use TestUtils;

	/**
	 * @dataProvider provideLinearWalk
	 * @covers ::linearWalk
	 */
	public function testLinearWalk( string $name, string $htmlPath, string $expectedPath ) {
		$html = static::getHtml( $htmlPath );
		// Slightly awkward to get the same output as in the JS version
		$fragment = ( DOMCompat::newDocument( true ) )->createDocumentFragment();
		$fragment->appendXML( trim( $html ) );
		$expected = static::getJson( $expectedPath );

		$actual = [];
		CommentUtils::linearWalk( $fragment, static function ( $event, $node ) use ( &$actual ) {
			$actual[] = "$event {$node->nodeName}({$node->nodeType})";
		} );

		$actualBackwards = [];
		CommentUtils::linearWalkBackwards( $fragment, static function ( $event, $node ) use ( &$actualBackwards ) {
			$actualBackwards[] = "$event {$node->nodeName}({$node->nodeType})";
		} );

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			static::overwriteJsonFile( $expectedPath, $actual );
		}

		static::assertEquals( $expected, $actual, $name );

		$expectedBackwards = array_map( static function ( $a ) {
			return ( substr( $a, 0, 5 ) === 'enter' ? 'leave' : 'enter' ) . substr( $a, 5 );
		}, array_reverse( $expected ) );
		static::assertEquals( $expectedBackwards, $actualBackwards, $name . ' (backwards)' );
	}

	public function provideLinearWalk(): array {
		return static::getJson( '../cases/linearWalk.json' );
	}
}
