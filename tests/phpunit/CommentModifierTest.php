<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentItem;
use MediaWiki\Extension\DiscussionTools\CommentModifier;

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
		$container = $doc->getElementsByTagName( 'body' )->item( 0 )->firstChild;

		$parser = self::createParser( $data );
		$comments = $parser->getComments( $container );
		$parser->groupThreads( $comments );

		$nodes = [];
		foreach ( $comments as $comment ) {
			if ( $comment instanceof CommentItem ) {
				$node = CommentModifier::addListItem( $comment );
				$node->textContent = 'Reply to ' . $comment->getId();
				$nodes[] = $node;
			}
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
		$container = $doc->getElementsByTagName( 'body' )->item( 0 )->firstChild;

		$parser = self::createParser( $data );
		$comments = $parser->getComments( $container );
		$parser->groupThreads( $comments );

		foreach ( $comments as $comment ) {
			if ( $comment instanceof CommentItem ) {
				$linkNode = $doc->createElement( 'a' );
				$linkNode->nodeValue = 'Reply';
				$linkNode->setAttribute( 'href', '#' );
				CommentModifier::addReplyLink( $comment, $linkNode );
			}
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
		$doc = self::createDocument( '<div>' . $html . '</div>' );
		$expectedDoc = self::createDocument( '<div>' . $expected . '</div>' );
		$container = $doc->getElementsByTagName( 'body' )->item( 0 )->firstChild;

		CommentModifier::unwrapList( $container->childNodes[$index] );

		self::assertEquals( $expectedDoc->documentElement, $doc->documentElement );
	}

	public function provideUnwrapList() : array {
		return self::getJson( '../cases/unwrap.json' );
	}
}
