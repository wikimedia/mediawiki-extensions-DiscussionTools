var
	testUtils = require( './testUtils.js' ),
	Parser = require( 'ext.discussionTools.init' ).Parser,
	modifier = require( 'ext.discussionTools.init' ).modifier;

QUnit.module( 'mw.dt.modifier', testUtils.newEnvironment() );

QUnit.test( '#addListItem/#removeAddedListItem', function ( assert ) {
	var cases = require( '../cases/modified.json' ),
		fixture = document.getElementById( 'qunit-fixture' );

	cases.forEach( function ( caseItem ) {
		var actualHtml, expectedHtml, reverseActualHtml, reverseExpectedHtml,
			i, comments, nodes, node, parser,
			dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = mw.template.get( 'test.DiscussionTools', caseItem.expected ).render(),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		testUtils.overrideMwConfig( config );
		testUtils.overrideParserData( data );

		$( fixture ).empty().append( expected );
		expectedHtml = fixture.innerHTML;

		$( fixture ).empty().append( dom.clone() );
		reverseExpectedHtml = fixture.innerHTML;

		parser = new Parser( fixture );
		comments = parser.getCommentItems();

		// Add a reply to every comment. Note that this inserts *all* of the replies, unlike the real
		// thing, which only deals with one at a time. This isn't ideal but resetting everything after
		// every reply would be super slow.
		nodes = [];
		for ( i = 0; i < comments.length; i++ ) {
			node = modifier.addListItem( comments[ i ] );
			node.textContent = 'Reply to ' + comments[ i ].id;
			nodes.push( node );
		}

		// Uncomment this to get updated content for the "modified HTML" files, for copy/paste:
		// console.log( fixture.innerHTML );

		actualHtml = fixture.innerHTML.trim();

		assert.strictEqual(
			actualHtml,
			expectedHtml,
			caseItem.name
		);

		// Now discard the replies and verify we get the original document back.
		for ( i = 0; i < nodes.length; i++ ) {
			modifier.removeAddedListItem( nodes[ i ] );
		}

		reverseActualHtml = fixture.innerHTML;
		assert.strictEqual(
			reverseActualHtml,
			reverseExpectedHtml,
			caseItem.name + ' (discard replies)'
		);
	} );
} );

QUnit.test( '#addReplyLink', function ( assert ) {
	var cases = require( '../cases/reply.json' ),
		fixture = document.getElementById( 'qunit-fixture' );

	cases.forEach( function ( caseItem ) {
		var actualHtml, expectedHtml,
			i, comments, linkNode, parser,
			dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = mw.template.get( 'test.DiscussionTools', caseItem.expected ).render(),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		testUtils.overrideMwConfig( config );
		testUtils.overrideParserData( data );

		$( fixture ).empty().append( expected );
		expectedHtml = fixture.innerHTML;

		$( fixture ).empty().append( dom.clone() );

		parser = new Parser( fixture );
		comments = parser.getCommentItems();

		// Add a reply link to every comment.
		for ( i = 0; i < comments.length; i++ ) {
			linkNode = document.createElement( 'a' );
			linkNode.textContent = 'Reply';
			linkNode.href = '#';
			modifier.addReplyLink( comments[ i ], linkNode );
		}

		// Uncomment this to get updated content for the "reply HTML" files, for copy/paste:
		// console.log( fixture.innerHTML );

		actualHtml = fixture.innerHTML.trim();

		assert.strictEqual(
			actualHtml,
			expectedHtml,
			caseItem.name
		);
	} );
} );

QUnit.test( '#unwrapList', function ( assert ) {
	var cases = require( '../cases/unwrap.json' );

	cases.forEach( function ( caseItem ) {
		var container = document.createElement( 'div' );

		container.innerHTML = caseItem.html;
		modifier.unwrapList( container.childNodes[ caseItem.index || 0 ] );

		assert.strictEqual(
			container.innerHTML,
			caseItem.expected,
			caseItem.name
		);
	} );
} );

QUnit.test( 'autoSignWikitext', function ( assert ) {
	var cases = require( '../cases/auto-sign-wikitext.json' );

	cases.forEach( function ( caseItem ) {
		var oldPrefix = mw.msg( 'discussiontools-signature-prefix' );
		if ( caseItem.prefix ) {
			mw.messages.set( { 'discussiontools-signature-prefix': caseItem.prefix } );
		}
		assert.strictEqual(
			modifier.autoSignWikitext( caseItem.wikitext ),
			caseItem.expected,
			caseItem.msg
		);
		mw.messages.set( { 'discussiontools-signature-prefix': oldPrefix } );
	} );
} );

QUnit.test( 'sanitizeWikitextLinebreaks', function ( assert ) {
	var cases = require( '../cases/sanitize-wikitext-linebreaks.json' );

	cases.forEach( function ( caseItem ) {
		assert.strictEqual(
			modifier.sanitizeWikitextLinebreaks( caseItem.wikitext ),
			caseItem.expected,
			caseItem.msg
		);
	} );
} );
