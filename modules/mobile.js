let newTopicButton, ledeSectionDialog;
let viewportScrollContainer = null;
let wasKeyboardOpen = null;
let initialClientHeight = null;
// Copied from ve.init.Platform.static.isIos
const isIos = /ipad|iphone|ipod/i.test( navigator.userAgent );

$( document.body ).toggleClass( 'ext-discussiontools-init-ios', isIos );

function onViewportChange() {
	let isKeyboardOpen;

	if ( isIos ) {
		isKeyboardOpen = visualViewport.height < viewportScrollContainer.clientHeight;
	} else {
		// TODO: Support orientation changes?
		isKeyboardOpen = viewportScrollContainer.clientHeight < initialClientHeight;
	}

	if ( isKeyboardOpen !== wasKeyboardOpen ) {
		$( document.body ).toggleClass( 'ext-discussiontools-init-virtual-keyboard-open', isKeyboardOpen );
	}

	wasKeyboardOpen = isKeyboardOpen;
}

function init( $container ) {
	// For compatibility with MobileWebUIActionsTracking logging (T295490)
	$container.find( '.section-heading' ).attr( 'data-event-name', 'talkpage.section' );

	// Keyboard body classes
	if ( !viewportScrollContainer && window.visualViewport ) {
		viewportScrollContainer = OO.ui.Element.static.getClosestScrollableContainer( document.body );
		initialClientHeight = viewportScrollContainer.clientHeight;
		const onViewportChangeThrottled = OO.ui.throttle( onViewportChange, 100 );
		$( visualViewport ).on( 'resize', onViewportChangeThrottled );
	}

	// Lede section button
	// mf-section-0: Legacy parser
	// data-mw-section-id: Parsoid
	const $ledeContent = $container.find( '.mf-section-0, [data-mw-section-id="0"]' ).children( ':not( .ext-discussiontools-emptystate )' )
		// On non-existent pages MobileFrontend wrapping isn't there
		.add( $container.find( '.mw-talkpageheader' ) );
	const $ledeButton = $container.find( '.ext-discussiontools-init-lede-button' );
	if ( $ledeButton.length ) {
		const windowManager = OO.ui.getWindowManager();
		if ( !ledeSectionDialog ) {
			const LedeSectionDialog = require( './LedeSectionDialog.js' );
			ledeSectionDialog = new LedeSectionDialog();
			windowManager.addWindows( [ ledeSectionDialog ] );
		}

		OO.ui.infuse( $ledeButton ).on( 'click', () => {
			mw.loader.using( 'oojs-ui-windows' ).then( () => {
				windowManager.openWindow( 'ledeSection', { $content: $ledeContent } );
				mw.track( 'webuiactions_log.click', 'lede-button' );
			} );
		} );
		mw.track( 'webuiactions_log.show', 'lede-button' );
	}

	// New topic button
	// eslint-disable-next-line no-jquery/no-global-selector
	const $newTopicWrapper = $( '.ext-discussiontools-init-new-topic' );

	if (
		!newTopicButton &&
		// eslint-disable-next-line no-jquery/no-global-selector
		$( '.ext-discussiontools-init-new-topic-button' ).length
	) {
		// eslint-disable-next-line no-jquery/no-global-selector
		newTopicButton = OO.ui.infuse( $( '.ext-discussiontools-init-new-topic-button' ) );
		// For compatibility with MobileWebUIActionsTracking logging (T295490)
		newTopicButton.$element.attr( 'data-event-name', 'talkpage.add-topic' );
		const $scrollContainer = $( OO.ui.Element.static.getClosestScrollableContainer( document.body ) );
		const $scrollListener = $scrollContainer.is( 'html, body' ) ? $( OO.ui.Element.static.getWindow( $scrollContainer[ 0 ] ) ) : $scrollContainer;
		let lastScrollTop = $scrollContainer.scrollTop();
		let wasScrollDown = null;
		const $body = $( document.body );
		// This block of code is only run once, so we don't need to remove this listener ever
		$scrollListener[ 0 ].addEventListener( 'scroll', OO.ui.throttle( () => {
			// Round negative values up to 0 to ignore iOS scroll bouncing (T323400)
			const scrollTop = Math.max( $scrollContainer.scrollTop(), 0 );
			const isScrollDown = scrollTop > lastScrollTop;
			if ( isScrollDown !== wasScrollDown ) {
				if ( !isScrollDown ) {
					$newTopicWrapper.css( 'transition', 'none' );
				}
				$body.removeClass( [ 'ext-discussiontools-init-new-topic-closed', 'ext-discussiontools-init-new-topic-opened' ] );
				requestAnimationFrame( () => {
					$newTopicWrapper.css( 'transition', '' );
					$body.addClass( isScrollDown ? 'ext-discussiontools-init-new-topic-close' : 'ext-discussiontools-init-new-topic-open' );
					setTimeout( () => {
						$body.removeClass( [ 'ext-discussiontools-init-new-topic-close', 'ext-discussiontools-init-new-topic-open' ] );
						$body.addClass( isScrollDown ? 'ext-discussiontools-init-new-topic-closed' : 'ext-discussiontools-init-new-topic-opened' );
					}, 250 );
				} );
			}

			const observer = new IntersectionObserver(
				( ( entries ) => {
					$newTopicWrapper.toggleClass( 'ext-discussiontools-init-new-topic-pinned', entries[ 0 ].intersectionRatio === 1 );
				} ),
				{ threshold: [ 1 ] }
			);

			observer.observe( $newTopicWrapper[ 0 ] );

			lastScrollTop = scrollTop;
			wasScrollDown = isScrollDown;
		}, 200 ), { passive: true } );
	}

	// Tweak to prevent our footer buttons from overlapping Minerva skin elements (T328452).
	// TODO: It would be more elegant to do this in just CSS somehow.
	// BEWARE: I have wasted 4 hours here trying to make that happen. The elements are not nested in a
	// helpful way, and moving them around tends to break the stickiness of the "Add topic" button.
	/* eslint-disable no-jquery/no-global-selector */
	if (
		$( '.catlinks' ).filter( '[data-mw="interface"]' ).length ||
		$( '#page-secondary-actions' ).children().length ||
		$( '.return-link' ).length
	) {
		$newTopicWrapper.addClass( 'ext-discussiontools-init-button-notFlush' );
	}
	/* eslint-enable no-jquery/no-global-selector */
}

// Handler for "edit" link in overflow menu, only setup once as the hook is global
mw.hook( 'discussionToolsOverflowMenuOnChoose' ).add( ( id, menuItem, threadItem ) => {
	if ( id === 'edit' ) {
		// Click the hidden section-edit link
		$( threadItem.getRange().commonAncestorContainer )
			.closest( '.ext-discussiontools-init-section' ).find( '.mw-editsection > a' ).trigger( 'click' );
	}
} );

/**
 * Close the lede section dialog if it is open.
 *
 * @return {jQuery.Promise} Promise resolved when the dialog is closed (or if it wasn't open)
 */
function closeLedeSectionDialog() {
	if ( ledeSectionDialog && ledeSectionDialog.isOpened() ) {
		return ledeSectionDialog.close().closed;
	}
	return $.Deferred().resolve();
}

module.exports = {
	init: init,
	closeLedeSectionDialog: closeLedeSectionDialog
};
