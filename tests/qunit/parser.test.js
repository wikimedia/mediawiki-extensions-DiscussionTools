var
	utils = require( './utils.js' ),
	parser = require( 'ext.discussionTools.parser' );

QUnit.module( 'mw.dt.parser', utils.newEnvironment() );

QUnit.test( '#getTimestampRegexp', function ( assert ) {
	var i, cases;

	utils.overrideParserData( require( './data-en.json' ) );

	cases = [
		{
			format: 'H:i, j F Y',
			expected: '(\\d{2}):(\\d{2}), (\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4}) \\((UTC)\\)',
			message: '(en) Boring'
		},
		{
			format: 'H:i، j xg Y',
			expected: '(\\d{2}):(\\d{2})، (\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4}) \\((UTC)\\)',
			message: '(ar) "xg" specifier'
		},
		{
			format: 'H:i, j F xkY',
			expected: '(\\d{2}):(\\d{2}), (\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4}) \\((UTC)\\)',
			message: '(th) "xkY" specifier'
		},
		{
			format: 'H"h"i"min" "de" j "de" F "de" Y',
			expected: '(\\d{2})h(\\d{2})min de (\\d{1,2}) de (January|February|March|April|May|June|July|August|September|October|November|December) de (\\d{4}) \\((UTC)\\)',
			message: '(pt) Escaped text (quotes)'
		},
		{
			format: 'H\\hi\\m\\i\\n \\d\\e j \\d\\e F \\d\\e Y',
			expected: '(\\d{2})h(\\d{2})min de (\\d{1,2}) de (January|February|March|April|May|June|July|August|September|October|November|December) de (\\d{4}) \\((UTC)\\)',
			message: '(pt) Escaped text (backslashes)'
		},
		{
			format: 'j F Y à H:i',
			expected: '(\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4}) à (\\d{2}):(\\d{2}) \\((UTC)\\)',
			message: '(fr) Unescaped text (non-ASCII)'
		},
		{
			format: 'Y年n月j日 (D) H:i',
			expected: '(\\d{4})年(\\d{1,2})月(\\d{1,2})日 \\((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\\) (\\d{2}):(\\d{2}) \\((UTC)\\)',
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

QUnit.test( 'Integration tests', function ( assert ) {
	var i, j, cases, comments, threads, fixture;

	cases = [
		{
			name: 'plwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'oldparser/pl-55171451.html' ).render(),
			expected: require( './pages/oldparser/pl-55171451.json' ),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'plwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'parsoid/pl-55171451.html' ).render(),
			expected: require( './pages/parsoid/pl-55171451.json' ),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'enwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'oldparser/en-913983958.html' ).render(),
			expected: require( './pages/oldparser/en-913983958.json' ),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'enwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'parsoid/en-913983958.html' ).render(),
			expected: require( './pages/parsoid/en-913983958.json' ),
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
		threads = parser.groupThreads( comments );

		for ( j = 0; j < threads.length; j++ ) {
			utils.serializeComments( threads[ j ], fixture );

			assert.deepEqual(
				JSON.parse( JSON.stringify( threads[ j ] ) ),
				cases[ i ].expected[ j ],
				cases[ i ].name + ' section ' + j
			);
		}
	}
} );
