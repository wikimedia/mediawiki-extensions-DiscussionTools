<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentFormatter;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use Title;
use Wikimedia\Parsoid\DOM\Element;

class MockCommentFormatter extends CommentFormatter {

	public static $data;

	/**
	 * @param Element $container
	 * @param Title $title
	 * @return CommentParser
	 */
	protected static function getParser( Element $container, Title $title ): CommentParser {
		return TestUtils::createParser( $container, $title, static::$data );
	}

}
