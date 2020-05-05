<?php

use MediaWiki\MediaWikiServices;
use Wikimedia\TestingAccessWrapper;

/**
 * @coversDefaultClass DiscussionToolsCommentParser
 */
class DiscussionToolsCommentParserTest extends MediaWikiTestCase {

	private static function getJson( $relativePath ) {
		$json = json_decode(
			// TODO: Move cases out of /qunit
			file_get_contents( __DIR__ . '/../qunit/' . $relativePath ),
			true
		);
		return $json;
	}

	private static function getOffsetPath( $ancestor, $node, $nodeOffset ) {
		$path = [ $nodeOffset ];
		while ( $node !== $ancestor ) {
			if ( !$node->parentNode ) {
				throw new Error( 'Not a descendant' );
			}
			array_unshift( $path, DiscussionToolsCommentParser::childIndexOf( $node ) );
			$node = $node->parentNode;
		}
		return implode( '/', $path );
	}

	private static function simplify( $parent ) {
		unset( $parent['range'] );
		unset( $parent['signatureRanges'] );
		foreach ( $parent['replies'] as $i => $reply ) {
			$parent['replies'][$i] = self::simplify( $reply );
		}
		return $parent;
	}

	private static function serializeComments( &$parent, $root ) {
		unset( $parent->parent );

		// Can't serialize the DOM nodes involved in the range,
		// instead use their offsets within their parent nodes
		$parent->range = [
			self::getOffsetPath( $root, $parent->range->startContainer, $parent->range->startOffset ),
			self::getOffsetPath( $root, $parent->range->endContainer, $parent->range->endOffset )
		];
		if ( isset( $parent->signatureRanges ) ) {
			$parent->signatureRanges = array_map( function ( $range ) use ( $root ) {
				return [
					self::getOffsetPath( $root, $range->startContainer, $range->startOffset ),
					self::getOffsetPath( $root, $range->endContainer, $range->endOffset )
				];
			}, $parent->signatureRanges );
		}

		foreach ( $parent->replies as $reply ) {
			self::serializeComments( $reply, $root );
		}
	}

	/**
	 * @dataProvider provideTimestampRegexps
	 * @covers ::getTimestampRegexp
	 */
	public function testGetTimestampRegexp( $format, $expected, $message ) {
		$parser = TestingAccessWrapper::newFromObject(
			DiscussionToolsCommentParser::newFromGlobalState()
		);

		// HACK: Fix differences between JS & PHP regexes
		// TODO: We may just have to have two version in the test data
		$expected = preg_replace( '/\\\\u([0-9A-F]+)/', '\\\\x{$1}', $expected );
		$expected = str_replace( ':', '\:', $expected );
		$expected = '/' . $expected . '/u';

		$result = $parser->getTimestampRegexp( $format, '\\d', [ 'UTC' => 'UTC' ] );
		self::assertSame( $expected, $result, $message );
	}

	public function provideTimestampRegexps() {
		return self::getJson( './cases/timestamp-regex.json' );
	}

	/**
	 * @dataProvider provideTimestampParser
	 * @covers ::getTimestampParser
	 */
	public function testGetTimestampParser( $format, $data, $expected, $message ) {
		$parser = TestingAccessWrapper::newFromObject(
			DiscussionToolsCommentParser::newFromGlobalState()
		);

		$expected = new DateTimeImmutable( $expected );

		$tsParser = $parser->getTimestampParser( $format, null, 'UTC', [ 'UTC' => 'UTC' ] );
		self::assertEquals( $expected, $tsParser( $data ), $message );
	}

	public function provideTimestampParser() {
		return self::getJson( './cases/timestamp-parser.json' );
	}

	/**
	 * @dataProvider provideTimestampParserDST
	 * @covers ::getTimestampParser
	 */
	public function testGetTimestampParserDST(
		$sample, $expected, $expectedUtc, $format, $timezone, $timezoneAbbrs, $message
	) {
		$parser = TestingAccessWrapper::newFromObject(
			DiscussionToolsCommentParser::newFromGlobalState()
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

	public function provideTimestampParserDST() {
		return self::getJson( './cases/timestamp-parser-dst.json' );
	}

	/**
	 * @dataProvider provideAuthors
	 * @covers ::getAuthors
	 */
	public function testGetAuthors( $thread, $expected ) {
		$parser = DiscussionToolsCommentParser::newFromGlobalState();

		self::assertEquals( $expected, $parser->getAuthors( $thread ) );
	}

	public function provideAuthors() {
		return [
			[
				'thread' => (object)[
					'replies' => [
						(object)[
							'author' => 'Eve',
							'replies' => []
						],
						(object)[
							'author' => 'Bob',
							'replies' => [
								(object)[
									'author' => 'Alice',
									'replies' => []
								]
							]
						]

					]
				],
				'expected' => [ 'Alice', 'Bob', 'Eve' ]
			]
		];
	}

	/**
	 * @dataProvider provideComments
	 * @covers ::getComments
	 * @covers ::groupThreads
	 */
	public function testGetComments( $name, $dom, $expected, $config, $data ) {
		$dom = file_get_contents( __DIR__ . '/../qunit/' . $dom );
		$expected = self::getJson( $expected );
		$config = self::getJson( $config );
		$data = self::getJson( $data );

		// Remove all but the body tags from full Parsoid docs
		if ( strpos( $dom, '<body' ) !== false ) {
			preg_match( '`<body[^>]*>(.*)</body>`s', $dom, $match );
			$dom = $match[1];
		}

		$this->setMwGlobals( $config );
		$this->setMwGlobals( [
			'wgArticlePath' => $config['wgArticlePath'],
			'wgNamespaceAliases' => $config['wgNamespaceIds'],
			'wgLocaltimezone' => $data['localTimezone']
		] );
		$this->setUserLang( $config['wgContentLang'] );
		$this->setContentLang( $config['wgContentLang'] );

		$services = MediaWikiServices::getInstance();
		$parserOrig = new DiscussionToolsCommentParser(
			$services->getContentLanguage(),
			$services->getMainConfig(),
			$data
		);
		$parser = TestingAccessWrapper::newFromObject( $parserOrig );

		$doc = new DOMDocument();
		$doc->loadHTML( '<?xml encoding="utf-8" ?>' . $dom, LIBXML_NOERROR );
		$container = $doc->documentElement->childNodes[0];

		$comments = $parserOrig->getComments( $container );
		$threads = $parserOrig->groupThreads( $comments );

		$processedThreads = [];

		foreach ( $threads as $i => $thread ) {
			self::serializeComments( $thread, $container );
			$thread = json_decode( json_encode( $thread ), true );
			// Ignore ranges for now
			$thread = self::simplify( $thread );
			$expected[$i] = self::simplify( $expected[$i] );
			$processedThreads[] = $thread;
			self::assertEquals( $expected[$i], $processedThreads[$i], $name . ' section ' . $i );
		}
	}

	public function provideComments() {
		return [
			// passes with ranges
			self::getJson( './cases/comments.json' )[0],
			// passes without ranges
			self::getJson( './cases/comments.json' )[1],
			// passes without ranges but very slow
			// self::getJson( './cases/comments.json' )[2],
			// passes without ranges but very slow
			// self::getJson( './cases/comments.json' )[3],
			// passes with ranges
			self::getJson( './cases/comments.json' )[4],
			// passes without ranges
			self::getJson( './cases/comments.json' )[5],
			// passes without ranges
			self::getJson( './cases/comments.json' )[6],
			// passes without ranges
			self::getJson( './cases/comments.json' )[7],
			// passes with ranges
			self::getJson( './cases/comments.json' )[8],
			// passes with ranges
			self::getJson( './cases/comments.json' )[9],
			// passes with ranges
			self::getJson( './cases/comments.json' )[10]
		];
	}
}
