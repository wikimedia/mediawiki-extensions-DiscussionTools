<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use RequestContext;
use Wikimedia\TestingAccessWrapper;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentFormatter
 */
class CommentFormatterTest extends IntegrationTestCase {

	/**
	 * @dataProvider provideAddReplyLinksInternal
	 * @covers ::addReplyLinksInternal
	 */
	public function testAddReplyLinksInternal(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$dom = self::getHtml( $dom );
		$expectedPath = $expected;
		$expected = self::getText( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );
		MockCommentFormatter::$data = $data;

		$commentFormatter = TestingAccessWrapper::newFromClass( MockCommentFormatter::class );

		$actual = $commentFormatter->addReplyLinksInternal( $dom, RequestContext::getMain()->getLanguage() );

		// Optionally write updated content to the "reply HTML" files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteTextFile( $expectedPath, $actual );
		}

		self::assertEquals( $expected, $actual, $name );
	}

	public function provideAddReplyLinksInternal() : array {
		return self::getJson( '../cases/formattedreply.json' );
	}

}
