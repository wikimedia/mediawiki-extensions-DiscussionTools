<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\MediaWikiServices;
use Title;
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
		string $name, string $title, string $dom, string $expected, string $config, string $data
	): void {
		$title = Title::newFromText( $title );
		$dom = self::getHtml( $dom );
		$expectedPath = $expected;
		$expected = self::getText( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );
		MockCommentFormatter::$data = $data;

		$commentFormatter = TestingAccessWrapper::newFromClass( MockCommentFormatter::class );

		$actual = $commentFormatter->addDiscussionToolsInternal( $dom, $title );

		$mockSubStore = new MockSubscriptionStore();
		$qqxLang = MediaWikiServices::getInstance()->getLanguageFactory()->getLanguage( 'qqx' );

		$actual = MockCommentFormatter::postprocessTopicSubscription(
			$actual, $qqxLang, $mockSubStore, self::getTestUser()->getUser()
		);

		$actual = MockCommentFormatter::postprocessReplyTool(
			$actual, $qqxLang
		);

		// Optionally write updated content to the "reply HTML" files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteTextFile( $expectedPath, $actual );
		}

		self::assertEquals( $expected, $actual, $name );
	}

	public function provideAddDiscussionToolsInternal(): array {
		return self::getJson( '../cases/formattedreply.json' );
	}

}
