var
	parser = require( 'ext.discussionTools.parser' ),
	highlighter = require( './highlighter.js' ),
	timestamps, comments, threads, i, node, match, signature, emptySignature;

timestamps = parser.findTimestamps( document.getElementById( 'mw-content-text' ) );
comments = parser.getComments( document.getElementById( 'mw-content-text' ) );
threads = parser.groupThreads( comments );

highlighter.markThreads( threads );

for ( i = 0; i < timestamps.length; i++ ) {
	node = timestamps[ i ][ 0 ];
	match = timestamps[ i ][ 1 ];
	signature = parser.findSignature( node )[ 0 ];
	emptySignature = signature.length === 1 && signature[ 0 ] === node;
	// Note that additional content may follow the timestamp (e.g. in some voting formats), but we
	// don't care about it. The code below doesn't mark that due to now the text nodes are sliced,
	// but we might need to take care to use the matched range of node in other cases.
	highlighter.markTimestamp( node, match );
	if ( !emptySignature ) {
		highlighter.markSignature( signature );
	}
}
