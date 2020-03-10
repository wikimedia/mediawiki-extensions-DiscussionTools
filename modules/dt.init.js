var controller = require( 'ext.discussionTools.controller' );

/**
 * @class mw.dt
 * @singleton
 */
mw.dt = {};

if ( new mw.Uri().query.dtdebug ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else if ( mw.config.get( 'wgIsProbablyEditable' ) ) {
	mw.hook( 'wikipage.content' ).add( function ( $container ) {
		$container.find( '.mw-parser-output' ).each( function () {
			var $node = $( this );
			// Don't re-run if we already handled this element
			// eslint-disable-next-line no-jquery/no-class-state
			if ( !$node.hasClass( 'dt-init-done' ) ) {
				controller.init( $node );
			}
		} );
	} );
}
