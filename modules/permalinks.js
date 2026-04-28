const clientUtils = require( './clientUtils.js' );

function init( $pageContainer ) {
	$pageContainer.find( '.ext-discussiontools-init-timestamplink' ).on( 'click', ( e ) => {
		if ( !clientUtils.isUnmodifiedLeftClick( e ) ) {
			// Only handle unmodified left clicks
			return;
		}
		// Use currentTarget rather than target to avoid conflicts with userscripts that do their
		// own timestamp-wrapping. (T368701)
		const link = safeDecode( e.currentTarget.href );
		copyLink( link );
		location.hash = new URL( link ).hash;
		return false;
	} ).attr( 'data-event-name', 'discussiontools.permalink-copied' );
}

function copyLink( link ) {
	const $win = $( window );
	const scrollTop = $win.scrollTop();

	const $tmpInput = $( '<input>' )
		.val( link )
		.addClass( 'noime' )
		.css( {
			position: 'fixed',
			top: 0
		} )
		.appendTo( 'body' )
		.trigger( 'focus' );
	$tmpInput[ 0 ].setSelectionRange( 0, link.length );
	let copied;
	try {
		copied = document.execCommand( 'copy' );
	} catch ( err ) {
		copied = false;
	}
	if ( copied ) {
		mw.notify( mw.msg( 'discussiontools-permalink-comment-copied' ) );
	}
	$tmpInput.remove();

	// Restore scroll position, can be changed by setSelectionRange, or hash navigation
	function afterNextScroll() {
		// On desktop we can restore scroll immediately after the scroll
		// event, preventing a scroll flicker.
		$win.scrollTop( scrollTop );
		// On mobile, we need to wait another execution cycle (setTimeout)
		// before the scroll is rendered (and not requestAnimationFrame).
		setTimeout( () => {
			$win.scrollTop( scrollTop );
		} );
	}
	// Restore scroll position when the scroll event fires.
	// setTimeout does't reliably wait long enough for the native
	// scroll to happen.
	$win.one( 'scroll', afterNextScroll );
	// If we happened to be in the exact correct position, 'scroll' won't fire,
	// so clear the listener after a short delay
	setTimeout( () => {
		$win.off( 'scroll', afterNextScroll );
	}, 1000 );
}

function safeDecode( link ) {
	// Try to percent-decode the URL, so that non-Latin characters don't look so ugly (T357021)
	try {
		// decodeURI() may throw
		const decodedLink = decodeURI( link );
		// Check that the decoded URL is parsed to the same canonical URL
		// new URL() may throw
		if ( new URL( decodedLink ).toString() === link ) {
			link = decodedLink;
		}
	} catch ( err ) {}
	return link;
}

mw.hook( 'discussionToolsOverflowMenuOnChoose' ).add( ( id, menuItem, threadItem ) => {
	if ( id === 'permalink' ) {
		// This is running inside a click event for the menu, and click events
		// clear the comment highlight that setting the hash will show. So,
		// setTimeout to get out of the click context.
		setTimeout( () => {
			// Work out a canonical URL for the current page:
			let link;
			const canonical = document.querySelector( 'link[rel="canonical"]' );
			if ( canonical ) {
				// This is only available if wgEnableCanonicalServerLink is set
				link = new URL( canonical.href );
			} else {
				link = new URL( mw.util.getUrl( mw.config.get( 'wgRelevantPageName' ) ), location.href );
			}
			// Set the hash to make it the permalink for this comment:
			link.hash = threadItem.id;
			// Copy the link (and decode percent-encoded items in the ID because the URL does that)
			copyLink( safeDecode( link.toString() ) );
			location.hash = link.hash;
		} );
	}
} );

module.exports = {
	init: init
};
