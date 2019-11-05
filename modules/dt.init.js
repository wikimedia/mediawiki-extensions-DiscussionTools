var comments, threads,
	widgetPromise = mw.loader.using( 'oojs-ui-core' );

/**
 * @class mw.discussionTools
 * @singleton
 */
mw.dt = {
	init: {},
	ui: {},
	parser: require( 'ext.discussionTools.parser' ),
	modifier: require( 'ext.discussionTools.modifier' )
};

function setupComment( comment ) {
	var $tsNode = $( comment.range.endContainer );

	// Is it possible to have a heading nested in a thread?
	if ( comment.type !== 'comment' ) {
		return;
	}

	$tsNode.after(
		' ',
		$( '<a>' ).text( 'Reply' ).on( 'click', function () {
			var newList, newListItem,
				$link = $( this );

			$link.hide();

			newList = mw.dt.modifier.addListAtComment( comment );
			newListItem = mw.dt.modifier.addListItem( newList );
			$( newListItem ).text( 'Loading...' );

			widgetPromise.then( function () {
				var replyWidget = new OO.ui.MultilineTextInputWidget( {
					value: 'Reply to ' + comment.author
				} );
				$( newListItem ).empty().append( replyWidget.$element );
				replyWidget.focus();
			} );
		} )
	);
}

function traverseNode( parent ) {
	parent.replies.forEach( function ( comment ) {
		setupComment( comment );
		traverseNode( comment );
	} );
}

if ( new mw.Uri().query.dtdebug ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else {
	comments = mw.dt.parser.getComments( document.getElementById( 'mw-content-text' ) );
	threads = mw.dt.parser.groupThreads( comments );
	threads.forEach( traverseNode );
}
