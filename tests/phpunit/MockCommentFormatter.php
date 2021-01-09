<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use DOMElement;
use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Extension\DiscussionTools\CommentParser;

class MockCommentFormatter extends CommentFormatter {

	public static $data;

	/**
	 * @param DOMElement $container
	 * @return CommentParser
	 */
	protected static function getParser( DOMElement $container ) : CommentParser {
		return CommentTestCase::createParser( $container, static::$data );
	}

}
