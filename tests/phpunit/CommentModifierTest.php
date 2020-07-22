<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentModifier;
use Wikimedia\Parsoid\Utils\DOMCompat;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentModifier
 *
 * @group DiscussionTools
 */
class CommentModifierTest extends CommentTestCase {

	/**
	 * @dataProvider provideAddListItem
	 * @covers ::addListItem
	 */
	public function testAddListItem(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$dom = self::getHtml( $dom );
		$expected = self::getHtml( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );

		$doc = self::createDocument( $dom );
		$container = $doc->getElementsByTagName( 'body' )->item( 0 );

		$parser = self::createParser( $container, $data );
		$comments = $parser->getCommentItems();

		$nodes = [];
		foreach ( $comments as $comment ) {
			$node = CommentModifier::addListItem( $comment );
			$node->textContent = 'Reply to ' . $comment->getId();
			$nodes[] = $node;
		}

		$expectedDoc = self::createDocument( $expected );

		self::assertEquals( $expectedDoc->saveHtml(), $doc->saveHtml(), $name );

		// removeAddedListItem is not implemented on the server
	}

	public function provideAddListItem() : array {
		return self::getJson( '../cases/modified.json' );
	}

	/**
	 * @dataProvider provideAddReplyLink
	 * @covers ::addReplyLink
	 */
	public function testAddReplyLink(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$dom = self::getHtml( $dom );
		$expected = self::getHtml( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );

		$doc = self::createDocument( $dom );
		$container = $doc->getElementsByTagName( 'body' )->item( 0 );

		$parser = self::createParser( $container, $data );
		$comments = $parser->getCommentItems();

		foreach ( $comments as $comment ) {
			$linkNode = $doc->createElement( 'a' );
			$linkNode->nodeValue = 'Reply';
			$linkNode->setAttribute( 'href', '#' );
			CommentModifier::addReplyLink( $comment, $linkNode );
		}

		$expectedDoc = self::createDocument( $expected );

		self::assertEquals( $expectedDoc->saveHtml(), $doc->saveHtml(), $name );
	}

	public function provideAddReplyLink() : array {
		return self::getJson( '../cases/reply.json' );
	}

	/**
	 * @dataProvider provideUnwrapList
	 * @covers ::unwrapList
	 */
	public function testUnwrapList( string $name, string $html, int $index, string $expected ) : void {
		$doc = self::createDocument( '' );
		$container = $doc->createElement( 'div' );

		DOMCompat::setInnerHTML( $container, $html );
		CommentModifier::unwrapList( $container->childNodes[$index] );

		self::assertEquals( $expected, DOMCompat::getInnerHTML( $container ) );
	}

	public function provideUnwrapList() : array {
		return self::getJson( '../cases/unwrap.json' );
	}

	/**
	 * @dataProvider provideIsWikitextSigned
	 * @covers ::isWikitextSigned
	 */
	public function testIsWikitextSigned(
		string $msg, string $wikitext, bool $expected
	) : void {
		self::assertEquals(
			$expected,
			CommentModifier::isWikitextSigned( $wikitext ),
			$msg
		);
	}

	public function provideIsWikitextSigned() : array {
		return self::getJson( '../cases/isWikitextSigned.json' );
	}

	/**
	 * @dataProvider provideIsHtmlSigned
	 * @covers ::isHtmlSigned
	 */
	public function testIsHtmlSigned(
		string $msg, string $html, bool $expected
	) : void {
		$doc = self::createDocument( '' );
		$container = $doc->createElement( 'div' );
		DOMCompat::setInnerHTML( $container, $html );

		self::assertEquals(
			$expected,
			CommentModifier::isHtmlSigned( $container ),
			$msg
		);
	}

	public function provideIsHtmlSigned() : array {
		return self::getJson( '../cases/isHtmlSigned.json' );
	}

	/**
	 * @dataProvider provideSanitizeWikitextLinebreaks
	 * @covers ::sanitizeWikitextLinebreaks
	 */
	public function testSanitizeWikitextLinebreaks( string $msg, string $wikitext, string $expected ) : void {
		self::assertEquals(
			$expected,
			CommentModifier::sanitizeWikitextLinebreaks( $wikitext ),
			$msg
		);
	}

	public function provideSanitizeWikitextLinebreaks() : array {
		return self::getJson( '../cases/sanitize-wikitext-linebreaks.json' );
	}
}
