/**
 * @class mw.discussionTools
 * @singleton
 */
mw.dt = {
	init: {},
	ui: {},
	parser: require( 'ext.discussionTools.parser' ),
	modifier: require( 'ext.discussionTools.modifier' ),
	controller: require( 'ext.discussionTools.controller' )
};

if ( new mw.Uri().query.dtdebug ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else {
	// eslint-disable-next-line no-jquery/no-global-selector
	mw.dt.controller.init( $( '#mw-content-text' ) );
}
