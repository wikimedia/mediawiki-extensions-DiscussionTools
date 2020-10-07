<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use DateTimeImmutable;
use DOMElement;
use DOMNode;
use Error;
use MediaWiki\Extension\DiscussionTools\CommentItem;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\Extension\DiscussionTools\CommentUtils;
use MediaWiki\Extension\DiscussionTools\HeadingItem;
use MediaWiki\Extension\DiscussionTools\ImmutableRange;
use MediaWiki\Extension\DiscussionTools\ThreadItem;
use stdClass;
use Wikimedia\TestingAccessWrapper;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\CommentParser
 *
 * @group DiscussionTools
 */
class CommentParserTest extends CommentTestCase {

	/**
	 * Convert UTF-8 byte offsets to UTF-16 code unit offsets.
	 *
	 * @param DOMElement $ancestor
	 * @param DOMNode $node
	 * @param int $nodeOffset
	 * @return string
	 */
	private static function getOffsetPath(
		DOMElement $ancestor, DOMNode $node, int $nodeOffset
	) : string {
		if ( $node->nodeType === XML_TEXT_NODE ) {
			$str = substr( $node->nodeValue, 0, $nodeOffset );
			// Count characters that require two code units to encode in UTF-16
			$count = preg_match_all( '/[\x{010000}-\x{10FFFF}]/u', $str );
			$nodeOffset = mb_strlen( $str ) + $count;
		}

		$path = [ $nodeOffset ];
		while ( $node !== $ancestor ) {
			if ( !$node->parentNode ) {
				throw new Error( 'Not a descendant' );
			}
			array_unshift( $path, CommentUtils::childIndexOf( $node ) );
			$node = $node->parentNode;
		}
		return implode( '/', $path );
	}

	private static function serializeComments( ThreadItem &$threadItem, DOMElement $root ) : stdClass {
		$serialized = new stdClass();

		if ( $threadItem instanceof HeadingItem ) {
			$serialized->placeholderHeading = $threadItem->isPlaceholderHeading();
		}

		$serialized->type = $threadItem->getType();

		if ( $threadItem instanceof CommentItem ) {
			$serialized->timestamp = $threadItem->getTimestamp();
			$serialized->author = $threadItem->getAuthor();
		}

		// Can't serialize the DOM nodes involved in the range,
		// instead use their offsets within their parent nodes
		$range = $threadItem->getRange();
		$serialized->range = [
			self::getOffsetPath( $root, $range->startContainer, $range->startOffset ),
			self::getOffsetPath( $root, $range->endContainer, $range->endOffset )
		];

		if ( $threadItem instanceof CommentItem ) {
			$serialized->signatureRanges = array_map( function ( ImmutableRange $range ) use ( $root ) {
				return [
					self::getOffsetPath( $root, $range->startContainer, $range->startOffset ),
					self::getOffsetPath( $root, $range->endContainer, $range->endOffset )
				];
			}, $threadItem->getSignatureRanges() );
		}

		if ( $threadItem instanceof HeadingItem ) {
			$serialized->headingLevel = $threadItem->getHeadingLevel();
		}
		$serialized->level = $threadItem->getLevel();
		$serialized->id = $threadItem->getId();

		if ( $threadItem instanceof CommentItem ) {
			$serialized->warnings = $threadItem->getWarnings();
		}

		$serialized->replies = [];
		foreach ( $threadItem->getReplies() as $reply ) {
			$serialized->replies[] = self::serializeComments( $reply, $root );
		}

		return $serialized;
	}

	/**
	 * @dataProvider provideTimestampRegexps
	 * @covers ::getTimestampRegexp
	 */
	public function testGetTimestampRegexp(
		string $format, string $expected, string $message
	) : void {
		$parser = TestingAccessWrapper::newFromObject(
			CommentParser::newFromGlobalState( new DOMElement( 'div' ) )
		);

		// HACK: Fix differences between JS & PHP regexes
		// TODO: We may just have to have two version in the test data
		$expected = preg_replace( '/\\\\u([0-9A-F]+)/', '\\\\x{$1}', $expected );
		$expected = str_replace( ':', '\:', $expected );
		$expected = '/' . $expected . '/u';

		$result = $parser->getTimestampRegexp( 'en', $format, '\\d', [ 'UTC' => 'UTC' ] );
		self::assertSame( $expected, $result, $message );
	}

	public function provideTimestampRegexps() : array {
		return self::getJson( '../cases/timestamp-regex.json' );
	}

	/**
	 * @dataProvider provideTimestampParser
	 * @covers ::getTimestampParser
	 */
	public function testGetTimestampParser(
		string $format, array $data, string $expected, string $message
	) : void {
		$parser = TestingAccessWrapper::newFromObject(
			CommentParser::newFromGlobalState( new DOMElement( 'div' ) )
		);

		$expected = new DateTimeImmutable( $expected );

		$tsParser = $parser->getTimestampParser( 'en', $format, null, 'UTC', [ 'UTC' => 'UTC' ] );
		self::assertEquals( $expected, $tsParser( $data ), $message );
	}

	public function provideTimestampParser() : array {
		return self::getJson( '../cases/timestamp-parser.json' );
	}

	/**
	 * @dataProvider provideTimestampParserDST
	 * @covers ::getTimestampParser
	 */
	public function testGetTimestampParserDST(
		string $sample, string $expected, string $expectedUtc, string $format,
		string $timezone, array $timezoneAbbrs, string $message
	) : void {
		$parser = TestingAccessWrapper::newFromObject(
			CommentParser::newFromGlobalState( new DOMElement( 'div' ) )
		);

		$regexp = $parser->getTimestampRegexp( 'en', $format, '\\d', $timezoneAbbrs );
		$tsParser = $parser->getTimestampParser( 'en', $format, null, $timezone, $timezoneAbbrs );

		$expected = new DateTimeImmutable( $expected );
		$expectedUtc = new DateTimeImmutable( $expectedUtc );

		preg_match( $regexp, $sample, $match, PREG_OFFSET_CAPTURE );
		$date = $tsParser( $match );

		self::assertEquals( $expected, $date, $message );
		self::assertEquals( $expectedUtc, $date, $message );
	}

	public function provideTimestampParserDST() : array {
		return self::getJson( '../cases/timestamp-parser-dst.json' );
	}

	/**
	 * @dataProvider provideComments
	 * @covers ::getThreads
	 */
	public function testGetThreads(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$dom = self::getHtml( $dom );
		$expectedPath = $expected;
		$expected = self::getJson( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$doc = self::createDocument( $dom );
		$body = $doc->getElementsByTagName( 'body' )->item( 0 );

		$this->setupEnv( $config, $data );
		$parser = self::createParser( $body, $data );
		$threads = $parser->getThreads();

		$processedThreads = [];

		foreach ( $threads as $i => $thread ) {
			$thread = self::serializeComments( $thread, $body );
			$thread = json_decode( json_encode( $thread ), true );
			$processedThreads[] = $thread;
		}

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteJsonFile( $expectedPath, $processedThreads );
		}

		foreach ( $threads as $i => $thread ) {
			self::assertEquals( $expected[$i], $processedThreads[$i], $name . ' section ' . $i );
		}
	}

	public function provideComments() : array {
		return self::getJson( '../cases/comments.json' );
	}

}
