<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use HashConfig;
use MediaWiki\Extension\DiscussionTools\LanguageData;
use MediaWiki\MediaWikiServices;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\LanguageData
 */
class LanguageDataTest extends IntegrationTestCase {

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
		$expectedData = static::getJson( $expectedPath );

		$services = MediaWikiServices::getInstance();
		$languageData = new LanguageData(
			$conf,
			MediaWikiServices::getInstance()->getLanguageFactory()->getLanguage( $langCode ),
			$services->getLanguageConverterFactory(),
			$services->getSpecialPageFactory()
		);

		$data = $languageData->getLocalData();

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			static::overwriteJsonFile( $expectedPath, $data );
		}

		static::assertEquals( $expectedData, $data );
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
