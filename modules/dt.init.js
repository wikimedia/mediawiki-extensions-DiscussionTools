var controller = require( 'ext.discussionTools.controller' );

/**
 * @class mw.dt
 * @singleton
 */
mw.dt = {};

if ( new mw.Uri().query.dtdebug ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else {
	mw.hook( 'wikipage.content' ).add( function ( $container ) {
		// Don't re-run if we already handled this element
		if ( $container.closest( '.dt-init-done' ).length === 0 ) {
			controller.init( $container.find( '#mw-content-text' ).addBack( '#mw-content-text' ) );
		}
	} );
}
