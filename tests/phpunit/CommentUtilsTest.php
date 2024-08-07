<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Config\HashConfig;
use MediaWiki\Extension\DiscussionTools\CommentUtils;
use MediaWiki\MainConfigNames;

/**
 * @group DiscussionTools
 * @covers \MediaWiki\Extension\DiscussionTools\CommentUtils
 */
class CommentUtilsTest extends IntegrationTestCase {
	/**
	 * @dataProvider provideIsSingleCommentSignedBy
	 */
	public function testIsSingleCommentSignedBy(
		string $msg, string $title, string $username, string $html, bool $expected
	) {
		$doc = static::createDocument( $html );
		$container = static::getThreadContainer( $doc );

		$config = static::getJson( "../data/enwiki-config.json" );
		$data = static::getJson( "../data/enwiki-data.json" );
		$title = $this->createTitleParser( $config )->parseTitle( $title );
		$parser = $this->createParser( $config, $data );

		$threadItemSet = $parser->parse( $container, $title );
		$isSigned = CommentUtils::isSingleCommentSignedBy( $threadItemSet, $username, $container );
		static::assertEquals( $expected, $isSigned, $msg );
	}

	public static function provideIsSingleCommentSignedBy(): array {
		return static::getJson( '../cases/isSingleCommentSignedBy.json' );
	}

	/**
	 * @covers \MediaWiki\Extension\DiscussionTools\CommentUtils::getTitleFromUrl
	 * @dataProvider provideGetTitleFromUrl_ShortUrl
	 * @dataProvider provideGetTitleFromUrl_Decoding
	 * @dataProvider provideGetTitleFromUrl_ConfusingShortUrl
	 * @dataProvider provideGetTitleFromUrl_NoShortUrl
	 */
	public function testGetTitleFromUrl( $expected, $input, $config ) {
		static::assertEquals(
			$expected,
			CommentUtils::getTitleFromUrl( $input, $config )
		);
	}

	public static function provideGetTitleFromUrl_Decoding() {
		// Standard short URL configuration like on Wikimedia wikis
		$config = new HashConfig( [ MainConfigNames::ArticlePath => '/wiki/$1' ] );

		// In URL paths, non-percent-encoded `+` represents itself
		yield [ 'A+B', '/wiki/A+B', $config ];
		yield [ 'A B', '/wiki/A B', $config ];
		yield [ 'A+B', '/wiki/A%2BB', $config ];
		yield [ 'A B', '/wiki/A%20B', $config ];

		// In URL query parameters, non-percent-encoded `+` represents ` `
		yield [ 'A B', '/w/index.php?title=A+B', $config ];
		yield [ 'A B', '/w/index.php?title=A B', $config ];
		yield [ 'A+B', '/w/index.php?title=A%2BB', $config ];
		yield [ 'A B', '/w/index.php?title=A%20B', $config ];
	}

	public static function provideGetTitleFromUrl_ShortUrl() {
		// Standard short URL configuration like on Wikimedia wikis
		$config = new HashConfig( [ MainConfigNames::ArticlePath => '/wiki/$1' ] );

		// These should never occur in documents generated by either wikitext parser
		yield 'ShortUrl-null-string' => [ null, 'Foo', $config ];
		yield 'ShortUrl-null-path' => [ null, 'path/Foo', $config ];
		yield 'ShortUrl-null-wiki-path' => [ null, 'wiki/Foo', $config ];

		// Legacy wikitext parser
		yield 'ShortUrl-simple-path' => [ 'Foo', '/wiki/Foo', $config ];
		yield 'ShortUrl-simple-cgi' => [ 'Foo', '/w/index.php?title=Foo', $config ];
		yield 'ShortUrl-viewing-path' => [ 'Foo', '/wiki/Foo?action=view', $config ];
		yield 'ShortUrl-viewing-cgi' => [ 'Foo', '/w/index.php?title=Foo&action=view', $config ];
		yield 'ShortUrl-editing-path' => [ 'Foo', '/wiki/Foo?action=edit', $config ];
		yield 'ShortUrl-editing-cgi' => [ 'Foo', '/w/index.php?title=Foo&action=edit', $config ];
		yield 'ShortUrl-repeated question-mark' => [ 'Foo', '/wiki/Foo?Gosh?This?Path?Is?Bad', $config ];

		// Parsoid parser
		yield 'ShortUrl-parsoid-simple-path' => [ 'Foo', './Foo', $config ];
		yield 'ShortUrl-parsoid-viewing-path' => [ 'Foo', './Foo?action=view', $config ];
		yield 'ShortUrl-parsoid-editing-path' => [ 'Foo', './Foo?action=edit', $config ];

		// External link (matches regardless of domain - this may be unexpected)
		yield 'ShortUrl-external-path1' => [ 'Foo', 'http://example.com/wiki/Foo', $config ];
		yield 'ShortUrl-external-path2' => [ 'Foo', 'http://example.org/wiki/Foo', $config ];
		yield 'ShortUrl-external-cgi1' => [ 'Foo', 'http://example.com/w/index.php?title=Foo', $config ];
		yield 'ShortUrl-external-cgi2' => [ 'Foo', 'http://example.org/w/index.php?title=Foo', $config ];
		yield 'ShortUrl-external-null' => [ null, 'http://example.net/Foo', $config ];
	}

	public static function provideGetTitleFromUrl_ConfusingShortUrl() {
		// Super short URL that is confusing for the software but people use it anyway
		$config = new HashConfig( [ MainConfigNames::ArticlePath => '/$1' ] );

		// These should never occur in documents generated by either wikitext parser
		yield 'ConfusingShortUrl-null-string' => [ null, 'Foo', $config ];
		yield 'ConfusingShortUrl-null-path' => [ null, 'path/Foo', $config ];
		yield 'ConfusingShortUrl-null-wiki-path' => [ null, 'wiki/Foo', $config ];

		// Legacy wikitext parser
		yield 'ConfusingShortUrl-simple-path' => [ 'Foo', '/Foo', $config ];
		yield 'ConfusingShortUrl-simple-cgi' => [ 'Foo', '/index.php?title=Foo', $config ];
		yield 'ConfusingShortUrl-viewing-path' => [ 'Foo', '/Foo?action=view', $config ];
		yield 'ConfusingShortUrl-viewing-cgi' => [ 'Foo', '/index.php?title=Foo&action=view', $config ];
		yield 'ConfusingShortUrl-editing-path' => [ 'Foo', '/Foo?action=edit', $config ];
		yield 'ConfusingShortUrl-editing-cgi' => [ 'Foo', '/index.php?title=Foo&action=edit', $config ];
		yield 'ConfusingShortUrl-repeated question-mark' => [ 'Foo', '/Foo?Gosh?This?Path?Is?Bad', $config ];

		// Parsoid parser
		yield 'ConfusingShortUrl-parsoid-simple-path' => [ 'Foo', './Foo', $config ];
		yield 'ConfusingShortUrl-parsoid-viewing-path' => [ 'Foo', './Foo?action=view', $config ];
		yield 'ConfusingShortUrl-parsoid-editing-path' => [ 'Foo', './Foo?action=edit', $config ];

		// External link (matches regardless of domain - this may be unexpected)
		yield 'ShortUrl-external-path1' => [ 'Foo', 'http://example.com/Foo', $config ];
		yield 'ShortUrl-external-path2' => [ 'Foo', 'http://example.org/Foo', $config ];
		yield 'ShortUrl-external-cgi1' => [ 'Foo', 'http://example.com/index.php?title=Foo', $config ];
		yield 'ShortUrl-external-cgi2' => [ 'Foo', 'http://example.org/index.php?title=Foo', $config ];
	}

	public static function provideGetTitleFromUrl_NoShortUrl() {
		// No short URL configuration
		$config = new HashConfig( [ MainConfigNames::ArticlePath => '/wiki/index.php?title=$1' ] );

		// These should never occur in documents generated by either wikitext parser
		yield 'NoShortUrl-null-string' => [ null, 'Foo', $config ];
		yield 'NoShortUrl-null-path' => [ null, 'path/Foo', $config ];
		yield 'NoShortUrl-null-wiki-path' => [ null, 'wiki/Foo', $config ];

		// Legacy wikitext parser
		yield 'NoShortUrl-simple-path' => [ 'Foo', '/wiki/index.php?title=Foo', $config ];
		yield 'NoShortUrl-viewing-path' => [ 'Foo', '/wiki/index.php?title=Foo&action=view', $config ];
		yield 'NoShortUrl-editing-path' => [ 'Foo', '/wiki/index.php?title=Foo&action=edit', $config ];

		// Parsoid parser
		yield 'NoShortUrl-parsoid-simple-path' => [ 'Foo', './index.php?title=Foo', $config ];
		yield 'NoShortUrl-parsoid-viewing-path' => [ 'Foo', './index.php?title=Foo&action=view', $config ];
		yield 'NoShortUrl-parsoid-editing-path' => [ 'Foo', './index.php?title=Foo&action=edit', $config ];

		// External link (matches regardless of domain - this may be unexpected)
		yield 'ShortUrl-external-cgi1' => [ 'Foo', 'http://example.com/wiki/index.php?title=Foo', $config ];
		yield 'ShortUrl-external-cgi2' => [ 'Foo', 'http://example.org/wiki/index.php?title=Foo', $config ];
		yield 'ShortUrl-external-null' => [ null, 'http://example.net/Foo', $config ];
	}
}
