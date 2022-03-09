/* global moment */
var
	testUtils = require( './testUtils.js' ),
	Parser = require( 'ext.discussionTools.init' ).Parser;

QUnit.module( 'mw.dt.Parser', QUnit.newMwEnvironment() );

QUnit.test( '#getTimestampRegexp', function ( assert ) {
	var cases = require( '../cases/timestamp-regex.json' ),
		parser = new Parser( require( '../data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		assert.strictEqual(
			parser.getTimestampRegexp( 'en', caseItem.format, '\\d', { UTC: 'UTC' } ),
			caseItem.expected,
			caseItem.message
		);
	} );
} );

QUnit.test( '#getTimestampParser', function ( assert ) {
	var cases = require( '../cases/timestamp-parser.json' ),
		parser = new Parser( require( '../data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		var tsParser = parser.getTimestampParser( 'en', caseItem.format, null, 'UTC', { UTC: 'UTC' } ),
			expectedDate = moment( caseItem.expected );

		assert.true(
			tsParser( caseItem.data ).date.isSame( expectedDate ),
			caseItem.message
		);
	} );
} );

QUnit.test( '#getTimestampParser (at DST change)', function ( assert ) {
	var cases = require( '../cases/timestamp-parser-dst.json' ),
		parser = new Parser( require( '../data-en.json' ) );

	cases.forEach( function ( caseItem ) {
		var regexp = parser.getTimestampRegexp( 'en', caseItem.format, '\\d', caseItem.timezoneAbbrs ),
			tsParser = parser.getTimestampParser( 'en', caseItem.format, null, caseItem.timezone, caseItem.timezoneAbbrs ),
			date = tsParser( caseItem.sample.match( regexp ) ).date;

		assert.true(
			date.isSame( caseItem.expected ),
			caseItem.message
		);
		assert.true(
			date.isSame( caseItem.expectedUtc ),
			caseItem.message
		);
	} );
} );

QUnit.test( '#getThreads', function ( assert ) {
	var cases = require( '../cases/comments.json' );

	var fixture = document.getElementById( 'qunit-fixture' );
	cases.forEach( function ( caseItem ) {
		var $dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = require( caseItem.expected ),
			config = require( caseItem.config ),
			data = require( caseItem.data ),
			title = mw.Title.newFromText( caseItem.title );

		$( fixture ).empty().append( testUtils.getThreadContainer( $dom ).children() );
		testUtils.overrideMwConfig( config );

		var threadItemSet = new Parser( data ).parse( fixture, title );
		var threads = threadItemSet.getThreads();

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

// TODO:
// * findCommentsById
// * findCommentsByName
// * getThreadItems
