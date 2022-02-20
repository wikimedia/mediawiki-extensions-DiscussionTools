var controller = require( './controller.js' ),
	config = require( './config.json' ),
	uri = new mw.Uri();

/**
 * @class mw.dt
 * @singleton
 */
mw.dt = {};

mw.dt.initState = {};

// New Topic A/B test for logged out users:
var tokenData = mw.storage.getObject( 'DTNewTopicABToken' );
if ( tokenData && tokenData.expires < Date.now() ) {
	mw.storage.remove( 'DTNewTopicABToken' );
	tokenData = null;
}
if ( mw.user.isAnon() && mw.config.get( 'wgDiscussionToolsABTest' ) ) {
	if ( !tokenData ) {
		tokenData = {
			token: mw.user.generateRandomSessionId(),
			// 90 days
			expires: Date.now() + 90 * 24 * 60 * 60 * 1000
		};
		mw.storage.setObject( 'DTNewTopicABToken', tokenData );
	}
	mw.config.set( 'wgDiscussionToolsAnonymousUserId', tokenData.token );
	var anonid = parseInt( tokenData.token.slice( 0, 8 ), 16 );
	var abstate = anonid % 2 === 0 ? 'test' : 'control';
	mw.config.set( 'wgDiscussionToolsABTestBucket', abstate );
	var featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {};
	if ( abstate === 'test' ) {
		$( document.body ).addClass( 'ext-discussiontools-newtopictool-enabled' );
		featuresEnabled.newtopictool = true;
	} else {
		$( document.body ).removeClass( 'ext-discussiontools-newtopictool-enabled' );
		featuresEnabled.newtopictool = false;
	}
}

if ( uri.query.dtrepliedto ) {
	// If we had to reload the page to highlight the new comment, extract that data from the URL and
	// clean it up.
	mw.dt.initState.repliedTo = uri.query.dtrepliedto;
	if ( window.history.replaceState ) {
		delete uri.query.dtrepliedto;
		window.history.replaceState( {}, '', uri.toString() );
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

if ( uri.query.dtdebug ) {
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
	logger: require( './logger.js' ),
	config: config
};
