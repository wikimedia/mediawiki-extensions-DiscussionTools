var
	testUtils = require( './testUtils.js' ),
	utils = require( 'ext.discussionTools.init' ).utils;

QUnit.module( 'mw.dt.utils', testUtils.newEnvironment() );

QUnit.test( '#linearWalk', function ( assert ) {
	var cases = require( '../cases/linearWalk.json' );

	cases.forEach( function ( caseItem ) {
		var
			$dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = require( caseItem.expected ),
			actual = [];

		utils.linearWalk( $dom[ 0 ].parentNode, function ( event, node ) {
			actual.push( event + ' ' + node.nodeName.toLowerCase() + '(' + node.nodeType + ')' );
		} );

		assert.deepEqual( actual, expected, caseItem.name );

		// Uncomment this to get updated content for the JSON files, for copy/paste:
		// console.log( JSON.stringify( actual, null, 2 ) );
	} );
} );
