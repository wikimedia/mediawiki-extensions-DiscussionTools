var
	testUtils = require( './testUtils.js' ),
	parser = require( 'ext.discussionTools.init' ).parser,
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

QUnit.test( '#getTranscludedFrom', function ( assert ) {
	var fixture,
		cases = require( '../cases/transcluded.json' );

	fixture = document.getElementById( 'qunit-fixture' );

	cases.forEach( function ( caseItem ) {
		var comments, transcludedFrom,
			$dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = require( caseItem.expected ),
			config = require( caseItem.config ),
			data = require( caseItem.data );

		$( fixture ).empty().append( $dom );
		mw.libs.ve.unwrapParsoidSections( fixture );

		testUtils.overrideMwConfig( config );
		testUtils.overrideParserData( data );

		comments = parser.getComments( fixture );
		parser.groupThreads( comments );

		transcludedFrom = {};
		comments.forEach( function ( comment ) {
			if ( comment.id ) {
				transcludedFrom[ comment.id ] = comment.getTranscludedFrom();
			}
		} );

		assert.deepEqual(
			transcludedFrom,
			expected,
			caseItem.name
		);

		// Uncomment this to get updated content for the JSON files, for copy/paste:
		// console.log( JSON.stringify( transcludedFrom, null, 2 ) );
	} );
} );
