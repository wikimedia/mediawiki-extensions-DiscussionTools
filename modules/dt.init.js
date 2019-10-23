var comments, threads,
	widgetPromise = mw.loader.using( 'oojs-ui-core' );

/**
 * @class mw.discussionTools
 * @singleton
 */
mw.dt = {
	init: {},
	ui: {},
	parser: require( 'ext.discussionTools.parser' )
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
			var lastReply, $list, $listItem, $newItem,
				$link = $( this );

			$link.hide();

			if ( comment.replies.length ) {
				lastReply = comment.replies[ comment.replies.length - 1 ];
				$listItem = $( lastReply.range.endContainer ).closest( 'li, dd' );
				$list = $listItem.closest( 'dl, ul, ol' );
			} else {
				$listItem = $tsNode.closest( 'li, dd' );
				$list = $listItem.closest( 'dl, ul, ol' );
				if ( $list.length ) {
					$list = $( document.createElement( $list.prop( 'tagName' ) ) ).appendTo( $listItem );
				} else {
					$list = $( '<dl>' ).insertAfter( $tsNode.closest( 'p' ) );
				}
			}
			$newItem = $( document.createElement( $listItem.prop( 'tagName' ) || 'dd' ) );
			$list.append( $newItem.text( 'Loading...' ) );

			widgetPromise.then( function () {
				var replyWidget = new OO.ui.MultilineTextInputWidget( {
					value: 'Reply to ' + comment.author
				} );
				$newItem.empty().append( replyWidget.$element );
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

comments = mw.dt.parser.getComments( document.getElementById( 'mw-content-text' ) );
threads = mw.dt.parser.groupThreads( comments );
threads.forEach( traverseNode );
