<?php

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
}
