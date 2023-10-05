function init( $pageContainer ) {
	$pageContainer.find( '.ext-discussiontools-init-timestamplink' ).on( 'click', function () {
		copyLink( this.href );
	} );
}

function copyLink( link ) {
	var $win = $( window );
	var scrollTop = $win.scrollTop();

	var $tmpInput = $( '<input>' )
		.val( link )
		.addClass( 'noime' )
		.css( {
			position: 'fixed',
			top: 0
		} )
		.appendTo( 'body' )
		.trigger( 'focus' );
	$tmpInput[ 0 ].setSelectionRange( 0, link.length );
	var copied;
	try {
		copied = document.execCommand( 'copy' );
	} catch ( err ) {
		copied = false;
	}
	if ( copied ) {
		mw.notify( mw.msg( 'discussiontools-permalink-comment-copied' ) );
	}
	$tmpInput.remove();

	// Restore scroll position, can be changed by setSelectionRange
	requestAnimationFrame( function () {
		$win.scrollTop( scrollTop );
	} );
}

module.exports = {
	init: init
};
