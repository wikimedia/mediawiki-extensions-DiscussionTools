var $readAsWikiPage;

function init( $container ) {
	// For compatibility with Minerva click tracking (T295490)
	$container.find( '.section-heading' ).attr( 'data-event-name', 'talkpage.section' );

	// Mobile overflow menu
	mw.loader.using( [ 'oojs-ui-widgets', 'oojs-ui.styles.icons-editing-core' ] ).then( function () {
		$container.find( '.ext-discussiontools-init-section-ellipsisButton' ).each( function () {
			var buttonMenu = OO.ui.infuse( this, { menu: {
				horizontalPosition: 'end',
				items: [
					new OO.ui.MenuOptionWidget( {
						data: 'edit',
						icon: 'edit',
						label: mw.msg( 'skin-view-edit' )
					} )
				]
			} } );
			buttonMenu.getMenu().on( 'choose', function ( menuOption ) {
				switch ( menuOption.getData() ) {
					case 'edit':
						// Click the hidden section-edit link
						buttonMenu.$element.closest( '.ext-discussiontools-init-section' ).find( '.mw-editsection > a' ).trigger( 'click' );
						break;
				}
			} );
		} );
		$container.find( '.ext-discussiontools-init-section-bar' ).on( 'click', function ( e ) {
			// Don't toggle section when clicking on bar
			e.stopPropagation();
		} );
	} );
	if ( !$readAsWikiPage ) {
		// Read as wiki page button, copied from renderReadAsWikiPageButton in Minerva
		$readAsWikiPage = $( '<button>' )
			.addClass( 'ext-discussiontools-init-readAsWikiPage' )
			.attr( 'data-event-name', 'talkpage.readAsWiki' )
			.text( mw.message( 'minerva-talk-full-page' ).text() )
			.on( 'click', function () {
				$( document.body ).removeClass( 'ext-discussiontools-visualenhancements-enabled ext-discussiontools-replytool-enabled' );
			} );
	}
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '#content' ).append( $readAsWikiPage );
}

module.exports = {
	init: init
};
