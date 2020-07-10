var
	parser = require( 'ext.discussionTools.init' ).parser,
	highlighter = require( './highlighter.js' ),
	comments = parser.getComments( document.getElementById( 'mw-content-text' ) ),
	threads = parser.groupThreads( comments ),
	timestampRegex = parser.getLocalTimestampRegexp();

highlighter.markThreads( threads );

// TODO: Use comment.signatureRanges to mark up signatures/timestamps
comments.forEach( function ( comment ) {
	var signature, emptySignature, node, match;

	if ( comment.type !== 'comment' ) {
		return;
	}

	node = comment.range.endContainer;
	match = parser.findTimestamp( node, timestampRegex );
	signature = parser.findSignature( node )[ 0 ];
	emptySignature = signature.length === 1 && signature[ 0 ] === node;
	// Note that additional content may follow the timestamp (e.g. in some voting formats), but we
	// don't care about it. The code below doesn't mark that due to now the text nodes are sliced,
	// but we might need to take care to use the matched range of node in other cases.
	highlighter.markTimestamp( node, match );
	if ( !emptySignature ) {
		highlighter.markSignature( signature );
	}
} );
