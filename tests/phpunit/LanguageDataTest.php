<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\LanguageData;
use MediaWiki\MediaWikiServices;

/**
 * @covers \MediaWiki\Extension\DiscussionTools\LanguageData
 */
class LanguageDataTest extends IntegrationTestCase {

	/**
	 * @dataProvider provideLocalData
	 */
	public function testGetLocalData( string $langCode, array $config, string $expectedPath ): void {
		$config += [
			'ContentLanguage' => $langCode,
			'UsePigLatinVariant' => false,
			'TranslateNumerals' => true,
			'Localtimezone' => 'UTC',
		];
		$this->overrideConfigValues( $config );

		$expectedData = static::getJson( $expectedPath );

		$services = MediaWikiServices::getInstance();
		$languageData = new LanguageData(
			$services->getMainConfig(),
			$services->getLanguageFactory()->getLanguage( $langCode ),
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
