<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Context\IContextSource;
use MediaWiki\Context\RequestContext;
use MediaWiki\Extension\DiscussionTools\BatchModifyElements;

/**
 * @covers \MediaWiki\Extension\DiscussionTools\CommentFormatter
 */
class SignatureMarkupTest extends IntegrationTestCase {

	private function makeMarker( string $id ): string {
		return '<span data-mw-comment-sig="' . htmlspecialchars( $id, ENT_QUOTES ) . '"></span>';
	}

	/**
	 * Add a handler which wraps the author name of every comment it is given.
	 */
	private function setUnderlineHandler( ?array &$receivedData = null ) {
		$this->setTemporaryHook(
			'DiscussionToolsAddSignatureUserInfoMarkup',
			static function (
				array &$markupByItemId,
				array $threadItemsData,
				IContextSource $contextSource
			) use ( &$receivedData ) {
				$receivedData = $threadItemsData;
				foreach ( $threadItemsData as $id => $data ) {
					$markupByItemId[$id] .= '<u>' . htmlspecialchars( $data['author'] ) . '</u>';
				}
			}
		);
	}

	public function testNoMarkupWithoutHandlers() {
		$html = '<p>Before ' . $this->makeMarker( 'c-Alice-20250101120000' ) . ' After</p>';
		$batchModifyElements = new BatchModifyElements();

		// Clear any registered handlers (e.g. from CheckUser) so none fire
		$this->clearHook( 'DiscussionToolsAddSignatureUserInfoMarkup' );

		$added = MockCommentFormatter::postprocessSignatureMarkup(
			$html, $batchModifyElements, RequestContext::getMain(), [ 'c-Alice-20250101120000' => 'Alice' ]
		);

		$this->assertFalse( $added );
		// Nothing was registered, so the caller can skip the HTML pass
		$this->assertSame( $html, $batchModifyElements->apply( $html ) );
	}

	public function testNoMarkupWithoutComments() {
		$html = '<p>Some text with no markers</p>';
		$batchModifyElements = new BatchModifyElements();
		$this->setUnderlineHandler();

		$added = MockCommentFormatter::postprocessSignatureMarkup(
			$html, $batchModifyElements, RequestContext::getMain(), []
		);

		$this->assertFalse( $added );
		$this->assertSame( $html, $batchModifyElements->apply( $html ) );
	}

	public function testMarkupAddedToEveryComment() {
		$html = '<p>' .
			$this->makeMarker( 'c-Alice-20250101120000' ) . ' text ' .
			$this->makeMarker( 'c-Bob-20250101130000' ) . ' text ' .
			$this->makeMarker( 'c-Carol-20250101140000' ) .
			'</p>';
		$batchModifyElements = new BatchModifyElements();
		$receivedData = null;
		$this->setUnderlineHandler( $receivedData );

		$added = MockCommentFormatter::postprocessSignatureMarkup(
			$html, $batchModifyElements, RequestContext::getMain(), [
				'c-Alice-20250101120000' => 'Alice',
				'c-Bob-20250101130000' => 'Bob',
				'c-Carol-20250101140000' => 'Carol',
			]
		);

		$this->assertTrue( $added );

		$result = $batchModifyElements->apply( $html );
		// The marker is kept, and the markup goes inside it
		$this->assertStringContainsString(
			'<span data-mw-comment-sig="c-Alice-20250101120000"><u>Alice</u></span>', $result
		);
		$this->assertStringContainsString( '<u>Bob</u>', $result );
		$this->assertStringContainsString( '<u>Carol</u>', $result );

		$this->assertSame( [
			'c-Alice-20250101120000' => [
				'id' => 'c-Alice-20250101120000',
				'author' => 'Alice',
			],
			'c-Bob-20250101130000' => [
				'id' => 'c-Bob-20250101130000',
				'author' => 'Bob',
			],
			'c-Carol-20250101140000' => [
				'id' => 'c-Carol-20250101140000',
				'author' => 'Carol',
			],
		], $receivedData );
	}

	public function testMarkupAppliedPerComment() {
		$html = '<p>' .
			$this->makeMarker( 'c-Alice-20250101120000' ) . ' text ' .
			$this->makeMarker( 'c-Bob-20250101130000' ) .
			'</p>';
		$batchModifyElements = new BatchModifyElements();

		$this->setTemporaryHook(
			'DiscussionToolsAddSignatureUserInfoMarkup',
			static function (
				array &$markupByItemId,
				array $threadItemsData,
				IContextSource $contextSource
			) {
				// Only handle one of the comments, to check that the other is left alone
				$markupByItemId['c-Alice-20250101120000'] = '<u>Alice</u>';

				// This should be ignored
				$markupByItemId['c-Nonexistent-20250101120000'] = '<span class="stray"></span>';
			}
		);

		$added = MockCommentFormatter::postprocessSignatureMarkup(
			$html, $batchModifyElements, RequestContext::getMain(), [
				'c-Alice-20250101120000' => 'Alice',
				'c-Bob-20250101130000' => 'Bob',
			]
		);

		$this->assertTrue( $added );

		$result = $batchModifyElements->apply( $html );
		$this->assertStringContainsString(
			'<span data-mw-comment-sig="c-Alice-20250101120000"><u>Alice</u></span>', $result
		);
		$this->assertStringContainsString(
			'<span data-mw-comment-sig="c-Bob-20250101130000"></span>', $result
		);
		$this->assertStringNotContainsString( 'stray', $result );
	}
}
