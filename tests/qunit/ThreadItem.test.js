var
	testUtils = require( './testUtils.js' ),
	CommentItem = require( 'ext.discussionTools.init' ).CommentItem,
	HeadingItem = require( 'ext.discussionTools.init' ).HeadingItem;

QUnit.module( 'mw.dt.ThreadItem', testUtils.newEnvironment() );

QUnit.test( '#getAuthorsBelow', function ( assert ) {
	var cases = require( '../cases/authors.json' );

	function newFromJSON( json ) {
		var item;
		if ( json.type === 'heading' ) {
			item = new HeadingItem();
		} else {
			item = new CommentItem();
			item.author = json.author;
		}
		item.replies = json.replies.map( newFromJSON );
		return item;
	}

	cases.forEach( function ( caseItem ) {
		var threadItem = newFromJSON( caseItem.thread ),
			authors = threadItem.getAuthorsBelow();

		assert.deepEqual(
			authors,
			caseItem.expected
		);
	} );
} );

// TODO:
// * getHeading (CommentItem+HeadingItem)
// * getLinkableTitle (HeadingItem)
// * newFromJSON (ThreadItem)
