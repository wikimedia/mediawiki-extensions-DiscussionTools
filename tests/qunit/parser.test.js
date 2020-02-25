/* global moment */
var
	utils = require( './utils.js' ),
	parser = require( 'ext.discussionTools.init' ).parser;

QUnit.module( 'mw.dt.parser', utils.newEnvironment() );

QUnit.test( '#getTimestampRegexp', function ( assert ) {
	var i, cases;

	utils.overrideParserData( require( './data-en.json' ) );

	cases = [
		{
			format: 'H:i, j F Y',
			expected: '(\\d{2}):(\\d{2}), (\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(en) Boring'
		},
		{
			format: 'H:i، j xg Y',
			expected: '(\\d{2}):(\\d{2})، (\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(ar) "xg" specifier'
		},
		{
			format: 'H:i, j F xkY',
			expected: '(\\d{2}):(\\d{2}), (\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(th) "xkY" specifier'
		},
		{
			format: 'H"h"i"min" "de" j "de" F "de" Y',
			expected: '(\\d{2})h(\\d{2})min de (\\d{1,2}) de (January|February|March|April|May|June|July|August|September|October|November|December) de (\\d{4})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(pt) Escaped text (quotes)'
		},
		{
			format: 'H\\hi\\m\\i\\n \\d\\e j \\d\\e F \\d\\e Y',
			expected: '(\\d{2})h(\\d{2})min de (\\d{1,2}) de (January|February|March|April|May|June|July|August|September|October|November|December) de (\\d{4})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(pt) Escaped text (backslashes)'
		},
		{
			format: 'j F Y à H:i',
			expected: '(\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4}) à (\\d{2}):(\\d{2})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(fr) Unescaped text (non-ASCII)'
		},
		{
			format: 'Y年n月j日 (D) H:i',
			expected: '(\\d{4})年(\\d{1,2})月(\\d{1,2})日 \\((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\\) (\\d{2}):(\\d{2})[\\u200E\\u200F]? [\\u200E\\u200F]?\\((UTC)\\)',
			message: '(ja) Unescaped regexp special characters'
		}
	];

	for ( i = 0; i < cases.length; i++ ) {
		assert.strictEqual(
			parser.getTimestampRegexp( cases[ i ].format, '\\d', { UTC: 'UTC' } ),
			cases[ i ].expected,
			cases[ i ].message
		);
	}
} );

QUnit.test( '#getTimestampParser', function ( assert ) {
	var i, cases, expectedDate, tsParser;

	utils.overrideParserData( require( './data-en.json' ) );

	expectedDate = moment( '2011-02-03T04:05:00+00:00' );

	cases = [
		{
			format: 'Y n j D H i',
			data: [ null, '2011', '2', '3', 'unused', '04', '05', 'UTC' ],
			message: 'Date is parsed'
		},
		{
			format: 'xkY xg d "asdf" G i',
			data: [ null, '2554', 'February', '03', '4', '05', 'UTC' ],
			message: 'Date is parsed'
		},
		{
			format: 'H i n j Y',
			data: [ null, '04', '05', '2', '3', '2011', 'UTC' ],
			message: 'Date is parsed'
		}
	];

	for ( i = 0; i < cases.length; i++ ) {
		tsParser = parser.getTimestampParser( cases[ i ].format, null, 'UTC', { UTC: 'UTC' } );

		assert.ok(
			tsParser( cases[ i ].data ).isSame( expectedDate ),
			cases[ i ].message
		);
	}
} );

QUnit.test( '#getTimestampParser (at DST change)', function ( assert ) {
	var i, cases, format, timezone, timezoneAbbrs, regexp, tsParser, date;

	utils.overrideParserData( require( './data-en.json' ) );

	format = 'H:i, j M Y';
	timezone = 'Europe/Warsaw';
	timezoneAbbrs = {
		CET: 'CET',
		CEST: 'CEST'
	};
	regexp = parser.getTimestampRegexp( format, '\\d', timezoneAbbrs );
	tsParser = parser.getTimestampParser( format, null, timezone, timezoneAbbrs );

	cases = [
		{
			sample: '01:30, 28 Oct 2018 (CEST)',
			expected: moment( '2018-10-28T01:30:00+02:00' ),
			expectedUtc: moment( '2018-10-27T23:30:00Z' ),
			message: 'Before DST change (not ambiguous)'
		},
		{
			sample: '02:30, 28 Oct 2018 (CEST)',
			expected: moment( '2018-10-28T02:30:00+02:00' ),
			expectedUtc: moment( '2018-10-28T00:30:00Z' ),
			message: 'Before DST change (ambiguous)'
		},
		// At 03:00, time goes back by 1 hour
		{
			sample: '02:30, 28 Oct 2018 (CET)',
			expected: moment( '2018-10-28T02:30:00+01:00' ),
			expectedUtc: moment( '2018-10-28T01:30:00Z' ),
			message: 'After DST change (ambiguous)'
		},
		{
			sample: '03:30, 28 Oct 2018 (CET)',
			expected: moment( '2018-10-28T03:30:00+01:00' ),
			expectedUtc: moment( '2018-10-28T02:30:00Z' ),
			message: 'After DST change (not ambiguous)'
		}
	];

	for ( i = 0; i < cases.length; i++ ) {
		date = tsParser( cases[ i ].sample.match( regexp ) );
		assert.ok(
			date.isSame( cases[ i ].expected ),
			cases[ i ].message
		);
		assert.ok(
			date.isSame( cases[ i ].expectedUtc ),
			cases[ i ].message
		);
	}
} );

QUnit.test( '#getComments/#groupThreads', function ( assert ) {
	var i, j, cases, comments, threads, fixture;

	cases = [
		{
			name: 'plwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-oldparser/pl-big-oldparser.html' ).render(),
			expected: require( './cases/pl-big-oldparser/pl-big-oldparser.json' ),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'plwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-parsoid/pl-big-parsoid.html' ).render(),
			expected: require( './cases/pl-big-parsoid/pl-big-parsoid.json' ),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'enwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-big-oldparser/en-big-oldparser.html' ).render(),
			expected: require( './cases/en-big-oldparser/en-big-oldparser.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'enwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-big-parsoid/en-big-parsoid.html' ).render(),
			expected: require( './cases/en-big-parsoid/en-big-parsoid.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'No heading',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/no-heading/no-heading.html' ).render(),
			expected: require( './cases/no-heading/no-heading.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'Manually added signature with LRM',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/lrm-signature/lrm-signature.html' ).render(),
			expected: require( './cases/lrm-signature/lrm-signature.json' ),
			config: require( './data/nlwiki-config.json' ),
			data: require( './data/nlwiki-data.json' )
		},
		{
			name: 'Link using fallback 8-bit encoding (invalid UTF-8)',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/fallback-encoding-link/fallback-encoding-link.html' ).render(),
			expected: require( './cases/fallback-encoding-link/fallback-encoding-link.json' ),
			config: require( './data/huwiki-config.json' ),
			data: require( './data/huwiki-data.json' )
		}
	];

	fixture = document.getElementById( 'qunit-fixture' );

	for ( i = 0; i < cases.length; i++ ) {
		$( fixture ).empty().append( cases[ i ].dom );
		utils.overrideMwConfig( cases[ i ].config );
		utils.overrideParserData( cases[ i ].data );

		comments = parser.getComments( fixture );
		threads = parser.groupThreads( comments );

		for ( j = 0; j < threads.length; j++ ) {
			utils.serializeComments( threads[ j ], fixture );

			assert.deepEqual(
				JSON.parse( JSON.stringify( threads[ j ] ) ),
				cases[ i ].expected[ j ],
				cases[ i ].name + ' section ' + j
			);
		}

		// Uncomment this to get updated content for the JSON files, for copy/paste:
		// console.log( JSON.stringify( threads, null, 2 ) );
	}
} );

QUnit.test( '#getTranscludedFrom', function ( assert ) {
	var i, j, cases, comments, transcludedFrom, fixture;

	cases = [
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
		utils.overrideMwConfig( cases[ i ].config );
		utils.overrideParserData( cases[ i ].data );

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
