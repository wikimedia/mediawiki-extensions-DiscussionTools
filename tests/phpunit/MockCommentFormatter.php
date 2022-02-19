<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Extension\DiscussionTools\CommentParser;

class MockCommentFormatter extends CommentFormatter {

	/**
	 * @var CommentParser
	 */
	public static $parser;

	/**
	 * @return CommentParser
	 */
	protected static function getParser(): CommentParser {
		return self::$parser;
	}

}
