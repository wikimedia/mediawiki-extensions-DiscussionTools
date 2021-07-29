<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use Wikimedia\Parsoid\DOM\Element;

class MockCommentFormatter extends CommentFormatter {

	public static $data;

	/**
	 * @param Element $container
	 * @return CommentParser
	 */
	protected static function getParser( Element $container ): CommentParser {
		return TestUtils::createParser( $container, static::$data );
	}

}
