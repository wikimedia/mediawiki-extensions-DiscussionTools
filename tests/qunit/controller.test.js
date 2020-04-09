var
	utils = require( './testUtils.js' ),
	controller = require( 'ext.discussionTools.init' ).controller;

QUnit.module( 'mw.dt.controller', utils.newEnvironment() );

QUnit.test( 'autoSignWikitext', function ( assert ) {
	var cases;

	cases = [
		{
			msg: 'Simple message',
			wikitext: 'Foo bar',
			expected: 'Foo bar ~~~~'
		},
		{
			msg: 'Whitespace',
			wikitext: ' \t Foo bar \t ',
			expected: 'Foo bar ~~~~'
		},
		{
			msg: 'Already signed',
			wikitext: 'Foo bar ~~~~',
			expected: 'Foo bar ~~~~'
		},
		{
			msg: 'Already signed multi-line',
			wikitext: 'Foo\n\nbar\n\n~~~~',
			expected: 'Foo\n\nbar\n\n~~~~'
		},
		{
			msg: 'Already signed with hyphens',
			wikitext: 'Foo bar --~~~~',
			expected: 'Foo bar --~~~~'
		},
		{
			msg: 'Already signed without space',
			wikitext: 'Foo bar~~~~',
			// Unless we special case certain characters, such as "-" this
			// has to behave the same as "Already signed with hyphens"
			expected: 'Foo bar~~~~'
		},
		{
			msg: 'Signed with 5 tildes',
			wikitext: 'Foo bar ~~~~~',
			expected: 'Foo bar ~~~~'
		},
		{
			msg: 'Signed with 3 tildes',
			wikitext: 'Foo bar ~~~',
			expected: 'Foo bar ~~~~'
		},
		{
			msg: 'Signed with 3 tildes and prefix',
			wikitext: 'Foo bar --~~~',
			expected: 'Foo bar --~~~~'
		}
	];

	cases.forEach( function ( caseItem ) {
		assert.strictEqual(
			controller.autoSignWikitext( caseItem.wikitext ),
			caseItem.expected,
			caseItem.msg
		);
	} );
} );
