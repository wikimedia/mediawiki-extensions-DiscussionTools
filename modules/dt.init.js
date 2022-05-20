var controller = require( './controller.js' ),
	url = new URL( location.href );

/**
 * @class mw.dt
 * @singleton
 */
mw.dt = {};

mw.dt.initState = {
	firstLoad: true
};

// Cleaning up anonymous A/B test token; remove later.
mw.storage.remove( 'DTNewTopicABToken' );

if ( url.searchParams.get( 'dtrepliedto' ) ) {
	// If we had to reload the page to highlight the new comment, extract that data from the URL and
	// clean it up.
	mw.dt.initState.repliedTo = url.searchParams.get( 'dtrepliedto' );
	if ( window.history.replaceState ) {
		url.searchParams.delete( 'dtrepliedto' );
		window.history.replaceState( {}, '', url );
	}
}

mw.dt.init = function ( $container ) {
	if ( $container.is( '#mw-content-text' ) || $container.find( '#mw-content-text' ).length ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		controller.init( $( '#mw-content-text' ), mw.dt.initState );
		// Reset for next init
		mw.dt.initState = {};
	}
};

if ( url.searchParams.get( 'dtdebug' ) ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else {
	// Don't use an anonymous function, because ReplyWidget needs to be able to remove this handler
	mw.hook( 'wikipage.content' ).add( mw.dt.init );
}

module.exports = {
	controller: controller,
	Parser: require( './Parser.js' ),
	parserData: require( './parser/data.json' ),
	modifier: require( './modifier.js' ),
	ThreadItem: require( './ThreadItem.js' ),
	HeadingItem: require( './HeadingItem.js' ),
	CommentItem: require( './CommentItem.js' ),
	utils: require( './utils.js' ),
	logger: require( './logger.js' )
};
