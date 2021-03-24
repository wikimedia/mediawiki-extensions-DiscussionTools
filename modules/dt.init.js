var controller = require( './controller.js' ),
	config = require( './config.json' ),
	uri = new mw.Uri();

/**
 * @class mw.dt
 * @singleton
 */
mw.dt = {};

mw.dt.initState = {};
mw.dt.init = function ( $container ) {
	if ( $container.is( '#mw-content-text' ) || $container.find( '#mw-content-text' ).length ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		controller.init( $( '#mw-content-text' ), mw.dt.initState );
		// Reset for next init
		mw.dt.initState = {};
	}
};

if ( uri.query.dtdebug ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else {
	// Don't use an anonymous function, because ReplyWidget needs to be able to remove this handler
	mw.hook( 'wikipage.content' ).add( mw.dt.init );
}

// If the tool is not enabled on this wiki, then the user
// is using a local hack to load this code. Set a cookie
// so reply links are added on the server.
if ( !config.enable && !uri.query.dtenable ) {
	mw.cookie.set( 'discussiontools-tempenable', 1 );
}

module.exports = {
	controller: controller,
	Parser: require( './Parser.js' ),
	modifier: require( './modifier.js' ),
	ThreadItem: require( './ThreadItem.js' ),
	HeadingItem: require( './HeadingItem.js' ),
	CommentItem: require( './CommentItem.js' ),
	utils: require( './utils.js' ),
	logger: require( './logger.js' ),
	config: config
};
