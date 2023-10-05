function init( $pageContainer ) {
	$pageContainer.find( '.ext-discussiontools-init-timestamplink' ).on( 'click', function () {
		var $win = $( window );
		var scrollTop = $win.scrollTop();
		var $tmpInput = $( '<input>' )
			.val( this.href )
			.addClass( 'noime' )
			.css( {
				position: 'fixed',
				top: 0
			} )
			.appendTo( 'body' )
			.trigger( 'focus' );
		$tmpInput[ 0 ].setSelectionRange( 0, this.href.length );
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
		// Restore scroll position
		requestAnimationFrame( function () {
			$win.scrollTop( scrollTop );
		} );
	} );
}

module.exports = {
	init: init
};
