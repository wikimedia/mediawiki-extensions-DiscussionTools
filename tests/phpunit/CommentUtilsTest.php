<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use DOMDocument;
use MediaWiki\Extension\DiscussionTools\CommentUtils;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentUtils
 *
 * @group DiscussionTools
 */
class CommentUtilsTest extends CommentTestCase {

	/**
	 * @dataProvider provideLinearWalk
	 * @covers ::linearWalk
	 */
	public function testLinearWalk( string $name, string $htmlPath, string $expectedPath ) {
		$html = self::getHtml( $htmlPath );
		// Slightly awkward to get the same output as in the JS version
		$fragment = ( new DOMDocument() )->createDocumentFragment();
		$fragment->appendXML( trim( $html ) );
		$expected = self::getJson( $expectedPath );

		$actual = [];
		CommentUtils::linearWalk( $fragment, function ( $event, $node ) use ( &$actual ) {
			$actual[] = "$event {$node->nodeName}({$node->nodeType})";
		} );

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteJsonFile( $expectedPath, $actual );
		}

		self::assertEquals( $expected, $actual, $name );
	}

	public function provideLinearWalk() : array {
		return self::getJson( '../cases/linearWalk.json' );
	}

}
