<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentFormatter;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentFormatter
 */
class CommentFormatterTest extends CommentTestCase {

	/**
	 * @dataProvider provideAddReplyLinks
	 * @covers ::addReplyLinks
	 */
	public function testAddReplyLinks(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$origPath = $dom;
		$dom = self::getHtml( $dom );
		$expectedPath = $expected;
		$expected = self::getHtml( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );

		$formatter = new CommentFormatter( $dom );
		$formatter->addReplyLinks();

		$doc = self::createDocument( $formatter->getText() );
		$expectedDoc = self::createDocument( $expected );

		// Optionally write updated content to the "reply HTML" files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteHtmlFile( $expectedPath, $doc, $origPath );
		}

		// saveHtml is not dirty-diff safe, but for testing it is probably faster than DOMCompat::getOuterHTML
		self::assertEquals( $expectedDoc->saveHtml(), $doc->saveHtml(), $name );
	}

	public function provideAddReplyLinks() : array {
		return self::getJson( '../cases/formattedreply.json' );
	}

}
