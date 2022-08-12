<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use ImportStringSource;
use MediaWiki\MediaWikiServices;
use TestUser;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\ThreadItemStore
 *
 * @group DiscussionTools
 * @group Database
 */
class ThreadItemStoreTest extends IntegrationTestCase {

	/**
	 * @inheritDoc
	 */
	public function getCliArg( $offset ) {
		// Work around MySQL bug (T256006)
		if ( $offset === 'use-normal-tables' ) {
			return true;
		}
		return parent::getCliArg( $offset );
	}

	/** @var @inheritDoc */
	protected $tablesUsed = [
		'user',
		'page',
		'revision',
		'discussiontools_items',
		'discussiontools_item_pages',
		'discussiontools_item_revisions',
		'discussiontools_item_ids',
	];

	/**
	 * @dataProvider provideInsertCases
	 * @covers ::insertThreadItems
	 */
	public function testInsertThreadItems( string $dir ): void {
		// Create users for the imported revisions
		new TestUser( 'X' );
		new TestUser( 'Y' );
		new TestUser( 'Z' );

		// Import revisions
		$source = new ImportStringSource( static::getText( "$dir/dump.xml" ) );
		$importer = MediaWikiServices::getInstance()
			->getWikiImporterFactory()
			->getWikiImporter( $source );
		// `true` means to assign edits to the users we created above
		$importer->setUsernamePrefix( 'import', true );
		$importer->doImport();

		// Check that expected data has been stored in the database
		$expected = [];
		$actual = [];
		$tables = [
			'discussiontools_items',
			'discussiontools_item_pages',
			'discussiontools_item_revisions',
			'discussiontools_item_ids',
		];
		foreach ( $tables as $table ) {
			$expected[$table] = static::getJson( "../$dir/$table.json", true );

			$res = wfGetDb( DB_REPLICA )->newSelectQueryBuilder()
				->from( $table )
				->field( '*' )
				->caller( __METHOD__ )
				->orderBy( 1 )
				->fetchResultSet();
			foreach ( $res as $i => $row ) {
				foreach ( $row as $key => $val ) {
					$actual[$table][$i][$key] = $val;
				}
			}
		}

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			foreach ( $tables as $table ) {
				static::overwriteJsonFile( "../$dir/$table.json", $actual[$table] );
			}
		}

		static::assertEquals( $expected, $actual );
	}

	public function provideInsertCases(): array {
		return [
			[ 'cases/ThreadItemStore/1simple-example' ],
			[ 'cases/ThreadItemStore/2archived-section' ],
			[ 'cases/ThreadItemStore/3indistinguishable-comments' ],
			[ 'cases/ThreadItemStore/4transcluded-section' ],
			[ 'cases/ThreadItemStore/5changed-comment-indentation' ],
			[ 'cases/ThreadItemStore/6changed-heading-level' ],
		];
	}
}
