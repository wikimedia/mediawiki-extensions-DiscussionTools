/* eslint-disable one-var, vars-on-top, no-redeclare */
/* eslint-disable no-console */
var parser = require( './parser.js' );
var highlighter = require( './highlighter.js' );

var start = Date.now();

var timestamps = parser.findTimestamps( document.getElementById( 'mw-content-text' ) );
var comments = parser.getComments( document.getElementById( 'mw-content-text' ) );
var threads = parser.groupThreads( comments );

window.timestamps = timestamps;
window.comments = comments;
window.threads = threads;

// List authors per-thread for autocompletion or something
for ( var i = 0; i < threads.length; i++ ) {
	threads[ i ].authors = Object.keys( parser.getAuthors( threads[ i ] ) ).sort();
}

highlighter.markThreads( threads );

for ( var i = 0; i < timestamps.length; i++ ) {
	var node = timestamps[ i ][ 0 ];
	var match = timestamps[ i ][ 1 ];
	var signature = parser.findSignature( node )[ 0 ];
	var emptySignature = signature.length === 1 && signature[ 0 ] === node;
	// Note that additional content may follow the timestamp (e.g. in some voting formats), but we
	// don't care about it. The code below doesn't mark that due to now the text nodes are sliced,
	// but we might need to take care to use the matched range of node in other cases.
	highlighter.markTimestamp( node, match );
	if ( emptySignature ) {
		console.log( 'Timestamp without signature: ' + match[ 0 ] );
	} else {
		highlighter.markSignature( signature );
	}
}

var end = Date.now();
console.log( 'Signature detection took ' + ( end - start ) + 'ms and found ' + timestamps.length + ' signatures.' );
