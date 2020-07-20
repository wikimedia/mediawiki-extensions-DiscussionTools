/* global moment */
var
	testUtils = require( './testUtils.js' ),
	parser = require( 'ext.discussionTools.init' ).parser;

QUnit.module( 'mw.dt.parser', testUtils.newEnvironment() );

QUnit.test( '#getTimestampRegexp', function ( assert ) {
	var cases = require( '../cases/timestamp-regex.json' );

	testUtils.overrideParserData( require( '../data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		assert.strictEqual(
			parser.getTimestampRegexp( caseItem.format, '\\d', { UTC: 'UTC' } ),
			caseItem.expected,
			caseItem.message
		);
	} );
} );

QUnit.test( '#getTimestampParser', function ( assert ) {
	var cases = require( '../cases/timestamp-parser.json' );

	testUtils.overrideParserData( require( '../data-en.json' ) );

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
	var cases = require( '../cases/timestamp-parser-dst.json' );

	testUtils.overrideParserData( require( '../data-en.json' ) );

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
		cases = require( '../cases/comments.json' );

	fixture = document.getElementById( 'qunit-fixture' );

	cases.forEach( function ( caseItem ) {
		var comments, threads,
			$dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = require( caseItem.expected ),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		// Remove all but the body tags from full Parsoid docs
		if ( $dom.filter( 'section' ).length ) {
			$dom = $( '<div>' )
				.append( $dom.filter( 'section' ) )
				.append( $dom.filter( 'base' ) );
		}

		$( fixture ).empty().append( $dom );
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
