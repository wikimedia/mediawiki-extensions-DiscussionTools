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
		string $name, string $title, string $dom, array $expectedByMode, string $config, string $data
	): void {
		$dom = static::getHtml( $dom );
		$config = static::getJson( $config );
		$data = static::getJson( $data );

		$this->setupEnv( $config, $data );
		$title = Title::newFromText( $title );
		MockCommentFormatter::$parser = TestUtils::createParser( $data );

		$commentFormatter = TestingAccessWrapper::newFromClass( MockCommentFormatter::class );

		[ 'html' => $preprocessed ] = $commentFormatter->addDiscussionToolsInternal( $dom, $title );

		$mockSubStore = new MockSubscriptionStore();
		$qqxLang = MediaWikiServices::getInstance()->getLanguageFactory()->getLanguage( 'qqx' );

		\OutputPage::setupOOUI();

		$modes = [ 'mobile' => true, 'desktop' => false ];
		foreach ( $modes as $mode => $isMobile ) {
			$actual = $preprocessed;
			$expectedPath = $expectedByMode[ $mode ];
			$expected = static::getText( $expectedPath );

			$actual = MockCommentFormatter::postprocessTopicSubscription(
				$actual, $qqxLang, $mockSubStore, static::getTestUser()->getUser(), $isMobile
			);

			$actual = MockCommentFormatter::postprocessVisualEnhancements(
				$actual, $qqxLang, static::getTestUser()->getUser(), $isMobile
			);

			$actual = MockCommentFormatter::postprocessReplyTool(
				$actual, $qqxLang, $isMobile
			);

			// OOUI ID's are non-deterministic, so strip them from test output
			$actual = preg_replace( '/ id=[\'"]ooui-php-[0-9]+[\'"]/', '', $actual );

			// Optionally write updated content to the "reply HTML" files
			if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
				static::overwriteTextFile( $expectedPath, $actual );
			}

			static::assertEquals( $expected, $actual, $name );
		}
	}

	public function provideAddDiscussionToolsInternal(): array {
		return static::getJson( '../cases/formatted.json' );
	}

}
