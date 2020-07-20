var
	Parser = require( 'ext.discussionTools.init' ).Parser,
	highlighter = require( './highlighter.js' ),
	parser = new Parser( document.getElementById( 'mw-content-text' ) ),
	comments = parser.getCommentItems(),
	threads = parser.getThreads(),
	timestampRegex = parser.getLocalTimestampRegexp();

highlighter.markThreads( threads );

// TODO: Use comment.signatureRanges to mark up signatures/timestamps
comments.forEach( function ( comment ) {
	var signature, emptySignature, node, match;

	node = comment.range.endContainer;
	match = parser.findTimestamp( node, timestampRegex );
	signature = parser.findSignature( node )[ 0 ];
	emptySignature = signature.length === 1 && signature[ 0 ] === node;
	// Note that additional content may follow the timestamp (e.g. in some voting formats), but we
	// don't care about it. The code below doesn't mark that due to now the text nodes are sliced,
	// but we might need to take care to use the matched range of node in other cases.
	highlighter.markTimestamp( parser, node, match );
	if ( !emptySignature ) {
		highlighter.markSignature( signature );
	}
} );
