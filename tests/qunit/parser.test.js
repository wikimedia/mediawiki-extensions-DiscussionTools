/* global moment */
var
	testUtils = require( './testUtils.js' ),
	parser = require( 'ext.discussionTools.init' ).parser;

QUnit.module( 'mw.dt.parser', testUtils.newEnvironment() );

QUnit.test( '#getTimestampRegexp', function ( assert ) {
	var cases = require( './cases/timestamp-regex.json' );

	testUtils.overrideParserData( require( './data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		assert.strictEqual(
			parser.getTimestampRegexp( caseItem.format, '\\d', { UTC: 'UTC' } ),
			caseItem.expected,
			caseItem.message
		);
	} );
} );

QUnit.test( '#getTimestampParser', function ( assert ) {
	var cases = require( './cases/timestamp-parser.json' );

	testUtils.overrideParserData( require( './data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		var tsParser = parser.getTimestampParser( caseItem.format, null, 'UTC', { UTC: 'UTC' } ),
			expectedDate = moment( caseItem.expected );

		assert.ok(
			tsParser( caseItem.data ).isSame( expectedDate ),
			caseItem.message
		);
	} );
} );

QUnit.test( '#getTimestampParser (at DST change)', function ( assert ) {
	var cases = require( './cases/timestamp-parser-dst.json' );

	testUtils.overrideParserData( require( './data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		var regexp = parser.getTimestampRegexp( caseItem.format, '\\d', caseItem.timezoneAbbrs ),
			tsParser = parser.getTimestampParser( caseItem.format, null, caseItem.timezone, caseItem.timezoneAbbrs ),
			date = tsParser( caseItem.sample.match( regexp ) );

		assert.ok(
			date.isSame( caseItem.expected ),
			caseItem.message
		);
		assert.ok(
			date.isSame( caseItem.expectedUtc ),
			caseItem.message
		);
	} );
} );

QUnit.test( '#getComments/#groupThreads', function ( assert ) {
	var fixture,
		cases = require( './cases/comments.json' );

	fixture = document.getElementById( 'qunit-fixture' );

	cases.forEach( function ( caseItem ) {
		var comments, threads,
			dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = require( caseItem.expected ),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		$( fixture ).empty().append( dom );
		testUtils.overrideMwConfig( config );
		testUtils.overrideParserData( data );

		comments = parser.getComments( fixture );
		threads = parser.groupThreads( comments );

		threads.forEach( function ( thread, i ) {
			testUtils.serializeComments( thread, fixture );

			assert.deepEqual(
				JSON.parse( JSON.stringify( thread ) ),
				expected[ i ],
				caseItem.name + ' section ' + i
			);
		} );

		// Uncomment this to get updated content for the JSON files, for copy/paste:
		// console.log( JSON.stringify( threads, null, 2 ) );
	} );
} );

QUnit.test( '#getTranscludedFrom', function ( assert ) {
	var i, j, cases, comments, transcludedFrom, fixture;

	cases = [
		{
			name: 'transclusions',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/transclusions/transclusions.html' ).render(),
			expected: require( './cases/transclusions/transclusions-transcludedFrom.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'enwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-big-parsoid/en-big-parsoid.html' ).render(),
			expected: require( './cases/en-big-parsoid/en-big-parsoid-transcludedFrom.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'enwiki parsoid AFD',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-bigafd-parsoid/en-bigafd-parsoid.html' ).render(),
			expected: require( './cases/en-bigafd-parsoid/en-bigafd-parsoid-transcludedFrom.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		}
	];

	fixture = document.getElementById( 'qunit-fixture' );

	for ( i = 0; i < cases.length; i++ ) {
		$( fixture ).empty().append( cases[ i ].dom );
		mw.libs.ve.unwrapParsoidSections( fixture );

		testUtils.overrideMwConfig( cases[ i ].config );
		testUtils.overrideParserData( cases[ i ].data );

		comments = parser.getComments( fixture );
		parser.groupThreads( comments );

		transcludedFrom = {};
		for ( j = 0; j < comments.length; j++ ) {
			if ( comments[ j ].id ) {
				transcludedFrom[ comments[ j ].id ] = parser.getTranscludedFrom( comments[ j ] );
			}
		}

		assert.deepEqual(
			transcludedFrom,
			cases[ i ].expected,
			cases[ i ].name
		);

		// Uncomment this to get updated content for the JSON files, for copy/paste:
		// console.log( JSON.stringify( transcludedFrom, null, 2 ) );
	}
} );
