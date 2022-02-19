var utils = require( 'ext.discussionTools.init' ).utils;

QUnit.module( 'mw.dt.utils', QUnit.newMwEnvironment() );

QUnit.test( '#linearWalk', function ( assert ) {
	var cases = require( '../cases/linearWalk.json' );

	cases.forEach( function ( caseItem ) {
		var
			$dom = mw.template.get( 'test.DiscussionTools', caseItem.dom ).render(),
			expected = require( caseItem.expected );

		var actual = [];
		utils.linearWalk( $dom[ 0 ].parentNode, function ( event, node ) {
			actual.push( event + ' ' + node.nodeName.toLowerCase() + '(' + node.nodeType + ')' );
		} );

		var actualBackwards = [];
		utils.linearWalkBackwards( $dom[ 0 ].parentNode, function ( event, node ) {
			actualBackwards.push( event + ' ' + node.nodeName.toLowerCase() + '(' + node.nodeType + ')' );
		} );

		assert.deepEqual( actual, expected, caseItem.name );

		var expectedBackwards = expected.slice().reverse().map( function ( a ) {
			return ( a.slice( 0, 5 ) === 'enter' ? 'leave' : 'enter' ) + a.slice( 5 );
		} );
		assert.deepEqual( actualBackwards, expectedBackwards, caseItem.name + ' (backwards)' );

		// Uncomment this to get updated content for the JSON files, for copy/paste:
		// console.log( JSON.stringify( actual, null, 2 ) );
	} );
} );
