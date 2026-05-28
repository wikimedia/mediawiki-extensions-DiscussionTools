/**
 * Build an overflow menu button and items for display adjacent to heading and comment thread items.
 *
 * The OOUI buttons are not infused at init: on a long talk page that's hundreds
 * of OO.ui.infuse() calls' worth of main-thread work for menus most users
 * never open. Instead we kick off the loader for oojs-ui-widgets in the
 * background, bind a single delegated click handler on the container, and
 * infuse each button lazily on its first click.
 *
 * @param {jQuery} $container
 * @param {ThreadItemSet} pageThreads
 */
function init( $container, pageThreads ) {
	if ( !$container.find( '.ext-discussiontools-init-section-overflowMenuButton' ).length ) {
		return;
	}

	// Warm the loader, but don't block init on it.
	const oouiPromise = mw.loader.using( [ 'oojs-ui-widgets', 'oojs-ui.styles.icons-editing-core' ] );

	$container.off( '.dt-overflowMenu' );
	$container.on( 'click.dt-overflowMenu keypress.dt-overflowMenu', '.ext-discussiontools-init-section-overflowMenuButton', ( e ) => {
		// Until the button is infused there's no OOUI keyboard handler, so the
		// server-rendered <a>/<span role=button> doesn't react to Enter/Space.
		// Filter the keypress to those activation keys and preventDefault to
		// stop Space scrolling the page (and Enter from firing a synthetic
		// click on top of the keypress).
		if ( e.type === 'keypress' && e.which !== OO.ui.Keys.ENTER && e.which !== OO.ui.Keys.SPACE ) {
			return;
		}
		const button = e.currentTarget;
		if ( $.data( button, 'dt-infused' ) ) {
			// Already infused; OOUI's own click/keyboard handler will open the menu.
			return;
		}
		$.data( button, 'dt-infused', true );
		e.preventDefault();

		let $threadMarker = $( button ).closest( '[data-mw-thread-id]' );
		if ( !$threadMarker.length ) {
			// Heading ellipsis
			$threadMarker = $( button ).closest( '.ext-discussiontools-init-section' ).find( '[data-mw-thread-id]' );
		}
		const threadItem = pageThreads.findCommentById( $threadMarker.data( 'mw-thread-id' ) );

		oouiPromise.then( () => {
			const buttonMenu = OO.ui.infuse( button, {
				$overlay: true,
				menu: {
					classes: [ 'ext-discussiontools-init-section-overflowMenu' ],
					horizontalPosition: threadItem.type === 'heading' ? 'end' : 'start'
				}
			} );

			buttonMenu.getMenu().on( 'choose', ( menuItem ) => {
				mw.hook( 'discussionToolsOverflowMenuOnChoose' ).fire( menuItem.getData().id, menuItem, threadItem );
			} );

			mw.loader.using( buttonMenu.getData().resourceLoaderModules || [] ).then( () => {
				const itemConfigs = buttonMenu.getData().itemConfigs;
				if ( !itemConfigs ) {
					// We should never have missing itemConfigs, but if this happens, hide the empty menu
					buttonMenu.toggle( false );
					return;
				}
				const overflowMenuItemWidgets = itemConfigs.map( ( itemConfig ) => new OO.ui.MenuOptionWidget( itemConfig ) );
				buttonMenu.getMenu().addItems( overflowMenuItemWidgets );
				buttonMenu.getMenu().items.forEach( ( menuItem ) => {
					mw.hook( 'discussionToolsOverflowMenuOnAddItem' ).fire( menuItem.getData().id, menuItem, threadItem );
				} );
				// Infusion can restructure the button's DOM and lose the
				// user's focus. Restore it explicitly before opening the menu,
				// so the visual state matches what they'd see on a button that
				// was already infused at click time.
				buttonMenu.focus();
				// The user already clicked the button; open the menu now that
				// it's populated.
				buttonMenu.getMenu().toggle( true );
			} );
		} );
	} );
}

module.exports = {
	init: init
};
