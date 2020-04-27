var
	testUtils = require( './testUtils.js' ),
	parser = require( 'ext.discussionTools.init' ).parser,
	modifier = require( 'ext.discussionTools.init' ).modifier;

QUnit.module( 'mw.dt.modifier', testUtils.newEnvironment() );

QUnit.test( '#addListItem/#removeListItem', function ( assert ) {
	var i, j, cases,
		actualHtml, expectedHtml, reverseActualHtml, reverseExpectedHtml,
		comments, nodes, node, fixture;

	cases = [
		{
			name: 'plwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-oldparser/pl-big-oldparser.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-oldparser/pl-big-oldparser-modified.html' ).render(),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'plwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-parsoid/pl-big-parsoid.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-parsoid/pl-big-parsoid-modified.html' ).render(),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'enwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-big-oldparser/en-big-oldparser.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/en-big-oldparser/en-big-oldparser-modified.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'enwiki parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-big-parsoid/en-big-parsoid.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/en-big-parsoid/en-big-parsoid-modified.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'arwiki no-paragraph oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/ar-no-paragraph-oldparser/ar-no-paragraph-oldparser.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/ar-no-paragraph-oldparser/ar-no-paragraph-oldparser-modified.html' ).render(),
			config: require( './data/arwiki-config.json' ),
			data: require( './data/arwiki-data.json' )
		},
		{
			name: 'arwiki no-paragraph parsoid',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/ar-no-paragraph-parsoid/ar-no-paragraph-parsoid.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/ar-no-paragraph-parsoid/ar-no-paragraph-parsoid-modified.html' ).render(),
			config: require( './data/arwiki-config.json' ),
			data: require( './data/arwiki-data.json' )
		},
		{
			name: 'Must split a list to reply to one of the comments',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/split-list/split-list.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/split-list/split-list-modified.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'Must split a list to reply to one of the comments (version 2)',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/split-list2/split-list2.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/split-list2/split-list2-modified.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'Reply inserted inside/outside various wrapper elements',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/wrappers/wrappers.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/wrappers/wrappers-modified.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'Signatures in funny places',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/signatures-funny/signatures-funny.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/signatures-funny/signatures-funny-modified.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		}
	];

	fixture = document.getElementById( 'qunit-fixture' );

	for ( i = 0; i < cases.length; i++ ) {
		testUtils.overrideMwConfig( cases[ i ].config );
		testUtils.overrideParserData( cases[ i ].data );

		$( fixture ).empty().append( cases[ i ].expected );
		expectedHtml = fixture.innerHTML;

		$( fixture ).empty().append( cases[ i ].dom.clone() );
		reverseExpectedHtml = fixture.innerHTML;

		comments = parser.getComments( fixture );
		parser.groupThreads( comments );

		// Add a reply to every comment. Note that this inserts *all* of the replies, unlike the real
		// thing, which only deals with one at a time. This isn't ideal but resetting everything after
		// every reply would be super slow.
		nodes = [];
		for ( j = 0; j < comments.length; j++ ) {
			if ( comments[ j ].type === 'heading' ) {
				continue;
			}
			node = modifier.addListItem( comments[ j ] );
			node.textContent = 'Reply to ' + comments[ j ].id;
			nodes.push( node );
		}

		// Uncomment this to get updated content for the "modified HTML" files, for copy/paste:
		// console.log( fixture.innerHTML );

		actualHtml = fixture.innerHTML.trim();

		assert.strictEqual(
			actualHtml,
			expectedHtml,
			cases[ i ].name
		);

		// Now discard the replies and verify we get the original document back.
		for ( j = 0; j < nodes.length; j++ ) {
			modifier.removeListItem( nodes[ j ] );
		}

		reverseActualHtml = fixture.innerHTML;
		assert.strictEqual(
			reverseActualHtml,
			reverseExpectedHtml,
			cases[ i ].name + ' (discard replies)'
		);
	}
} );

QUnit.test( '#addReplyLink', function ( assert ) {
	var i, j, cases, actualHtml, expectedHtml, comments, linkNode, fixture;

	cases = [
		{
			name: 'plwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-oldparser/pl-big-oldparser.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/pl-big-oldparser/pl-big-oldparser-reply.html' ).render(),
			config: require( './data/plwiki-config.json' ),
			data: require( './data/plwiki-data.json' )
		},
		{
			name: 'enwiki oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/en-big-oldparser/en-big-oldparser.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/en-big-oldparser/en-big-oldparser-reply.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		},
		{
			name: 'arwiki no-paragraph oldparser',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/ar-no-paragraph-oldparser/ar-no-paragraph-oldparser.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/ar-no-paragraph-oldparser/ar-no-paragraph-oldparser-reply.html' ).render(),
			config: require( './data/arwiki-config.json' ),
			data: require( './data/arwiki-data.json' )
		},
		{
			name: 'Signatures in funny places',
			dom: mw.template.get( 'test.DiscussionTools', 'cases/signatures-funny/signatures-funny.html' ).render(),
			expected: mw.template.get( 'test.DiscussionTools', 'cases/signatures-funny/signatures-funny-reply.html' ).render(),
			config: require( './data/enwiki-config.json' ),
			data: require( './data/enwiki-data.json' )
		}
	];

	fixture = document.getElementById( 'qunit-fixture' );

	for ( i = 0; i < cases.length; i++ ) {
		testUtils.overrideMwConfig( cases[ i ].config );
		testUtils.overrideParserData( cases[ i ].data );

		$( fixture ).empty().append( cases[ i ].expected );
		expectedHtml = fixture.innerHTML;

		$( fixture ).empty().append( cases[ i ].dom.clone() );

		comments = parser.getComments( fixture );
		parser.groupThreads( comments );

		// Add a reply link to every comment.
		for ( j = 0; j < comments.length; j++ ) {
			if ( comments[ j ].type === 'heading' ) {
				continue;
			}
			linkNode = document.createElement( 'a' );
			linkNode.textContent = 'Reply';
			linkNode.href = '#';
			modifier.addReplyLink( comments[ j ], linkNode );
		}

		// Uncomment this to get updated content for the "reply HTML" files, for copy/paste:
		// console.log( fixture.innerHTML );

		actualHtml = fixture.innerHTML.trim();

		assert.strictEqual(
			actualHtml,
			expectedHtml,
			cases[ i ].name
		);
	}
} );

QUnit.test( '#unwrapList', function ( assert ) {
	var cases;

	cases = [
		{
			name: 'empty',
			html: '<dl><dd></dd></dl>',
			expected: ''
		},
		{
			name: 'single item',
			html: '<dl><dd>Foo</dd></dl>',
			expected: '<p>Foo</p>'
		},
		{
			name: 'single block item',
			html: '<dl><dd><pre>Foo</pre></dd></dl>',
			expected: '<pre>Foo</pre>'
		},
		{
			name: 'mixed inline and block',
			html: '<dl><dd>Foo <pre>Bar</pre> Baz</dd></dl>',
			expected: '<p>Foo </p><pre>Bar</pre><p> Baz</p>'
		},
		{
			name: 'multiple items',
			html: '<dl><dd>Foo</dd><dd>Bar</dd></dl>',
			expected: '<p>Foo</p><p>Bar</p>'
		},
		{
			name: 'nested list',
			html: '<dl><dd>Foo<dl><dd>Bar</dd></dl></dd></dl>',
			expected: '<p>Foo</p><dl><dd>Bar</dd></dl>'
		}
	];

	cases.forEach( function ( caseItem ) {
		var container = document.createElement( 'div' );

		container.innerHTML = caseItem.html;
		modifier.unwrapList( container.firstChild );

		assert.strictEqual(
			container.innerHTML.trim(),
			caseItem.expected,
			caseItem.name
		);
	} );
} );
