<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentModifier;

/**
 * @coversDefaultClass MediaWiki\Extension\DiscussionTools\CommentModifier
 *
 * @group DiscussionTools
 */
class CommentModifierTest extends CommentTestCase {

	/**
	 * @dataProvider provideAddListItem
	 * @covers ::addListItem
	 * @covers ::removeListItem
	 */
	public function testAddListItem( $name, $dom, $expected, $config, $data ) {
		$dom = self::getHtml( $dom );
		$expected = self::getHtml( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );

		$doc = self::createDocument( $dom );
		$container = $doc->documentElement->childNodes[0];

		$parser = self::createParser( $data );
		$comments = $parser->getComments( $container );
		$parser->groupThreads( $comments );

		$nodes = [];
		foreach ( $comments as $comment ) {
			if ( $comment->type === 'heading' ) {
				continue;
			}
			$node = CommentModifier::addListItem( $comment );
			$node->textContent = 'Reply to ' . $comment->id;
			$nodes[] = $node;
		}

		$expectedDoc = self::createDocument( $expected );

		self::assertEquals( $expectedDoc->saveHtml(), $doc->saveHtml(), $name );
	}

	public function provideAddListItem() {
		$modified = self::getJson( './cases/modified.json' );
		return [
			$modified[0],
			$modified[1],
			$modified[2],
			$modified[3],
			$modified[4],
			// TODO: Fix strange escaping discrepancy inside data-mw
			// $modified[5],
			$modified[6],
			$modified[7],
			$modified[8],
			$modified[9],
		];
	}

	/**
	 * @dataProvider provideAddReplyLink
	 * @covers ::addReplyLink
	 */
	public function testAddReplyLink( $name, $dom, $expected, $config, $data ) {
		$dom = self::getHtml( $dom );
		$expected = self::getHtml( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );

		$doc = self::createDocument( $dom );
		$container = $doc->documentElement->childNodes[0];

		$parser = self::createParser( $data );
		$comments = $parser->getComments( $container );
		$parser->groupThreads( $comments );

		foreach ( $comments as $comment ) {
			if ( $comment->type === 'heading' ) {
				continue;
			}
			$linkNode = $doc->createElement( 'a' );
			$linkNode->nodeValue = 'Reply';
			$linkNode->setAttribute( 'href', '#' );
			CommentModifier::addReplyLink( $comment, $linkNode );
		}

		$expectedDoc = self::createDocument( $expected );

		self::assertEquals( $expectedDoc->saveHtml(), $doc->saveHtml(), $name );
	}

	public function provideAddReplyLink() {
		return self::getJson( './cases/reply.json' );
	}

	/**
	 * @dataProvider provideUnwrapList
	 * @covers ::unwrapList
	 */
	public function testUnwrapList( $name, $html, $expected ) {
		$doc = self::createDocument( '<div>' . $html . '</div>' );
		$expectedDoc = self::createDocument( '<div>' . $expected . '</div>' );

		CommentModifier::unwrapList( $doc->getElementsByTagName( 'dl' )[0] );

		self::assertEquals( $expectedDoc->documentElement, $doc->documentElement );
	}

	public function provideUnwrapList() {
		return self::getJson( './cases/unwrap.json' );
	}
}
