<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use RequestContext;
use Wikimedia\TestingAccessWrapper;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentFormatter
 */
class CommentFormatterTest extends IntegrationTestCase {

	/**
	 * @dataProvider provideAddDiscussionToolsInternal
	 * @covers ::addDiscussionToolsInternal
	 */
	public function testAddDiscussionToolsInternal(
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

		$actual = $commentFormatter->addDiscussionToolsInternal( $dom, RequestContext::getMain()->getLanguage() );

		$mockSubStore = new MockSubscriptionStore();
		$actual = MockCommentFormatter::postprocessTopicSubscription(
			$actual, RequestContext::getMain()->getLanguage(), $mockSubStore, self::getTestUser()->getUser()
		);

		// Optionally write updated content to the "reply HTML" files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteTextFile( $expectedPath, $actual );
		}

		self::assertEquals( $expected, $actual, $name );
	}

	public function provideAddDiscussionToolsInternal() : array {
		return self::getJson( '../cases/formattedreply.json' );
	}

}
