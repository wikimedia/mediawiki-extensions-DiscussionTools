var
	testUtils = require( './testUtils.js' ),
	Parser = require( 'ext.discussionTools.init' ).Parser,
	modifier = require( 'ext.discussionTools.init' ).modifier;

QUnit.module( 'mw.dt.modifier', testUtils.newEnvironment() );

QUnit.test( '#addListItem/#removeAddedListItem', function ( assert ) {
	var cases = require( '../cases/modified.json' ),
		fixture = document.getElementById( 'qunit-fixture' );

	cases.forEach( function ( caseItem ) {
		var dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = mw.template.get( 'test.DiscussionTools', caseItem.expected ).render(),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		testUtils.overrideMwConfig( config );
		testUtils.overrideParserData( data );

		$( fixture ).empty().append( expected );
		var expectedHtml = fixture.innerHTML;

		$( fixture ).empty().append( dom );
		var reverseExpectedHtml = fixture.innerHTML;

		var parser = new Parser( fixture );
		var comments = parser.getCommentItems();

		// Add a reply to every comment. Note that this inserts *all* of the replies, unlike the real
		// thing, which only deals with one at a time. This isn't ideal but resetting everything after
		// every reply would be super slow.
		var nodes = [];
		comments.forEach( function ( comment ) {
			var node = modifier.addListItem( comment, 'invisible' );
			node.textContent = 'Reply to ' + comment.id;
			nodes.push( node );
		} );

		// Uncomment this to get updated content for the "modified HTML" files, for copy/paste:
		// console.log( fixture.innerHTML );

		var actualHtml = fixture.innerHTML;

		assert.strictEqual(
			actualHtml,
			expectedHtml,
			caseItem.name
		);

		// Now discard the replies and verify we get the original document back.
		nodes.forEach( function ( node ) {
			modifier.removeAddedListItem( node );
		} );

		var reverseActualHtml = fixture.innerHTML;
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
		var dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = mw.template.get( 'test.DiscussionTools', caseItem.expected ).render(),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		testUtils.overrideMwConfig( config );
		testUtils.overrideParserData( data );

		$( fixture ).empty().append( expected );
		var expectedHtml = fixture.innerHTML;

		$( fixture ).empty().append( dom );

		var parser = new Parser( fixture );
		var comments = parser.getCommentItems();

		// Add a reply link to every comment.
		comments.forEach( function ( comment ) {
			var linkNode = document.createElement( 'a' );
			linkNode.textContent = 'Reply';
			linkNode.href = '#';
			modifier.addReplyLink( comment, linkNode );
		} );

		// Uncomment this to get updated content for the "reply HTML" files, for copy/paste:
		// console.log( fixture.innerHTML );

		var actualHtml = fixture.innerHTML;

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

QUnit.test( 'isWikitextSigned', function ( assert ) {
	var cases = require( '../cases/isWikitextSigned.json' );

	cases.forEach( function ( caseItem ) {
		assert.strictEqual(
			modifier.isWikitextSigned( caseItem.wikitext ),
			caseItem.expected,
			caseItem.msg
		);
	} );
} );

QUnit.test( 'isHtmlSigned', function ( assert ) {
	var cases = require( '../cases/isHtmlSigned.json' );

	cases.forEach( function ( caseItem ) {
		var container = document.createElement( 'div' );
		container.innerHTML = caseItem.html;

		assert.strictEqual(
			modifier.isHtmlSigned( container ),
			caseItem.expected,
			caseItem.msg
		);
	} );
} );

QUnit.test( 'appendSignature', function ( assert ) {
	var cases = require( '../cases/appendSignature.json' );

	cases.forEach( function ( caseItem ) {
		var container = document.createElement( 'div' );
		container.innerHTML = caseItem.html;

		modifier.appendSignature( container );

		assert.strictEqual(
			container.innerHTML,
			caseItem.expected,
			caseItem.msg
		);
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

// TODO:
// * addHtmlReply
// * addReply
// * addSiblingListItem
// * addWikitextReply
