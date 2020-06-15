<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use DateTimeImmutable;
use DOMElement;
use DOMNode;
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
			$startNode = $node;
			$nodeText = '';

			while ( $node ) {
				$nodeText .= $node->nodeValue;

				// In Parsoid HTML, entities are represented as a 'mw:Entity' node, rather than normal HTML
				// entities. On Arabic Wikipedia, the "UTC" timezone name contains some non-breaking spaces,
				// which apparently are often turned into &nbsp; entities by buggy editing tools. To handle
				// this, we must piece together the text, so that our regexp can match those timestamps.
				if (
					$node->nextSibling &&
					$node->nextSibling->nodeType === XML_ELEMENT_NODE &&
					$node->nextSibling->getAttribute( 'typeof' ) === 'mw:Entity'
				) {
					$nodeText .= $node->nextSibling->firstChild->nodeValue;

					// If the entity is followed by more text, do this again
					if (
						$node->nextSibling->nextSibling &&
						$node->nextSibling->nextSibling->nodeType === XML_TEXT_NODE
					) {
						$node = $node->nextSibling->nextSibling;
					} else {
						$node = null;
					}
				} else {
					$node = null;
				}
			}

			$str = substr( $nodeText, 0, $nodeOffset );
			// Count characters that require two code units to encode in UTF-16
			$count = preg_match_all( '/[\x{010000}-\x{10FFFF}]/u', $str );
			$nodeOffset = mb_strlen( $str ) + $count;

			$node = $startNode;
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

		$serialized->type = $threadItem->getType();
		$serialized->level = $threadItem->getLevel();

		// Can't serialize the DOM nodes involved in the range,
		// instead use their offsets within their parent nodes
		$range = $threadItem->getRange();
		$serialized->id = $threadItem->getId();
		$serialized->range = [
			self::getOffsetPath( $root, $range->startContainer, $range->startOffset ),
			self::getOffsetPath( $root, $range->endContainer, $range->endOffset )
		];
		$serialized->replies = [];
		foreach ( $threadItem->getReplies() as $reply ) {
			$serialized->replies[] = self::serializeComments( $reply, $root );
		}

		if ( $threadItem instanceof CommentItem ) {
			$serialized->signatureRanges = array_map( function ( ImmutableRange $range ) use ( $root ) {
				return [
					self::getOffsetPath( $root, $range->startContainer, $range->startOffset ),
					self::getOffsetPath( $root, $range->endContainer, $range->endOffset )
				];
			}, $threadItem->getSignatureRanges() );
			$serialized->timestamp = $threadItem->getTimestamp();
			$serialized->author = $threadItem->getAuthor();
			$warnings = $threadItem->getWarnings();
			if ( count( $warnings ) ) {
				$serialized->warnings = $threadItem->getWarnings();
			}
		}

		if ( $threadItem instanceof HeadingItem && $threadItem->isPlaceholderHeading() ) {
			$serialized->placeholderHeading = $threadItem->isPlaceholderHeading();
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
			CommentParser::newFromGlobalState()
		);

		// HACK: Fix differences between JS & PHP regexes
		// TODO: We may just have to have two version in the test data
		$expected = preg_replace( '/\\\\u([0-9A-F]+)/', '\\\\x{$1}', $expected );
		$expected = str_replace( ':', '\:', $expected );
		$expected = '/' . $expected . '/u';

		$result = $parser->getTimestampRegexp( $format, '\\d', [ 'UTC' => 'UTC' ] );
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
			CommentParser::newFromGlobalState()
		);

		$expected = new DateTimeImmutable( $expected );

		$tsParser = $parser->getTimestampParser( $format, null, 'UTC', [ 'UTC' => 'UTC' ] );
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
			CommentParser::newFromGlobalState()
		);

		$regexp = $parser->getTimestampRegexp( $format, '\\d', $timezoneAbbrs );
		$tsParser = $parser->getTimestampParser( $format, null, $timezone, $timezoneAbbrs );

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
	 * @dataProvider provideAuthors
	 * @covers ::getAuthors
	 */
	public function testGetAuthors( array $thread, array $expected ) : void {
		$parser = CommentParser::newFromGlobalState();
		$doc = $this->createDocument( '' );
		$node = $doc->createElement( 'div' );
		$range = new ImmutableRange( $node, 0, $node, 0 );

		$makeThreadItem = function ( array $arr ) use ( &$makeThreadItem, $range ) : ThreadItem {
			if ( $arr['type'] === 'comment' ) {
				$item = new CommentItem( 1, $range );
				$item->setAuthor( $arr['author'] );
			} else {
				$item = new HeadingItem( $range );
			}
			foreach ( $arr['replies'] as $reply ) {
				$item->addReply( $makeThreadItem( $reply ) );
			}
			return $item;
		};

		$threadItem = $makeThreadItem( $thread );

		self::assertEquals( $expected, $parser->getAuthors( $threadItem ) );
	}

	public function provideAuthors() : array {
		return self::getJson( '../cases/authors.json' );
	}

	/**
	 * @dataProvider provideComments
	 * @covers ::getComments
	 * @covers ::groupThreads
	 */
	public function testGetComments(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$dom = self::getHtml( $dom );
		$expected = self::getJson( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );
		$parser = self::createParser( $data );

		$doc = self::createDocument( $dom );
		$container = $doc->documentElement->childNodes[0];

		$comments = $parser->getComments( $container );
		$threads = $parser->groupThreads( $comments );

		$processedThreads = [];

		foreach ( $threads as $i => $thread ) {
			$thread = self::serializeComments( $thread, $container );
			$thread = json_decode( json_encode( $thread ), true );
			$processedThreads[] = $thread;
			self::assertEquals( $expected[$i], $processedThreads[$i], $name . ' section ' . $i );
		}
	}

	public function provideComments() : array {
		return self::getJson( '../cases/comments.json' );
	}

	/**
	 * @dataProvider provideTranscludedFrom
	 * @covers ::getComments
	 * @covers ::groupThreads
	 * @covers \MediaWiki\Extension\DiscussionTools\CommentUtils::unwrapParsoidSections
	 */
	public function testGetTranscludedFrom(
		string $name, string $dom, string $expected, string $config, string $data
	) : void {
		$dom = self::getHtml( $dom );
		$expected = self::getJson( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		$this->setupEnv( $config, $data );
		$parser = self::createParser( $data );

		$doc = self::createDocument( $dom );
		$container = $doc->documentElement->childNodes[0];

		CommentUtils::unwrapParsoidSections( $doc->documentElement );

		$comments = $parser->getComments( $container );
		$threads = $parser->groupThreads( $comments );

		$transcludedFrom = [];
		foreach ( $comments as $comment ) {
			if ( $comment instanceof CommentItem ) {
				$transcludedFrom[ $comment->getId() ] =
					$parser->getTranscludedFrom( $comment );
			}
		}

		self::assertEquals(
			$expected,
			$transcludedFrom,
			$name
		);
	}

	public function provideTranscludedFrom() : array {
		return self::getJson( '../cases/transcluded.json' );
	}

}
