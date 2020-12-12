var
	Parser = require( 'ext.discussionTools.init' ).Parser,
	highlighter = require( './highlighter.js' ),
	parser = new Parser( document.getElementById( 'mw-content-text' ) ),
	comments = parser.getCommentItems(),
	threads = parser.getThreads(),
	timestampRegexps = parser.getLocalTimestampRegexps();

highlighter.markThreads( threads );

comments.forEach( function ( comment ) {
	comment.signatureRanges.forEach( function ( signatureRange ) {
		var signature, emptySignature, node, match;

		node = signatureRange.endContainer;
		match = parser.findTimestamp( node, timestampRegexps );
		if ( !match ) {
			return;
		}
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
} );
