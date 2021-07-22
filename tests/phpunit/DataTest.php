<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use HashConfig;
use MediaWiki\Extension\DiscussionTools\Data;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\Data
 */
class DataTest extends IntegrationTestCase {

	/**
	 * @dataProvider provideLocalData
	 * @covers ::getLocalData
	 */
	public function testGetLocalData( string $langCode, array $config, string $expectedPath ): void {
		$conf = new HashConfig( $config + [
			'ContentLanguage' => $langCode,
			'TranslateNumerals' => true,
			'Localtimezone' => 'UTC',
		] );
		$expectedData = self::getJson( $expectedPath );

		$data = Data::getLocalData( null, $conf, $langCode );

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteJsonFile( $expectedPath, $data );
		}

		self::assertEquals( $expectedData, $data );
	}

	public function provideLocalData(): array {
		return [
			// Boring
			[ 'en', [], '../cases/datatest-en.json' ],
			// Has language variants (T259818)
			[ 'sr', [], '../cases/datatest-sr.json' ],
			// Has localised digits (T261706)
			[ 'ckb', [], '../cases/datatest-ckb.json' ],
			// Has unusual timezone abbreviation (T265500)
			[ 'th', [ 'Localtimezone' => 'Asia/Bangkok' ], '../cases/datatest-th.json' ],
		];
	}

}
