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

/**
 * Hook handler for `mw.hook( 'wikipage.content' )`.
 *
 * @param {jQuery} $container
 */
mw.dt.init = function ( $container ) {
	function reallyInit( $node ) {
		controller.init( $node, mw.dt.initState );
		mw.dt.initState = {};
	}

	// Only (re)initialize if the hook is being fired on the page content – not on e.g. a single image
	// in a gallery slideshow, or a preview in our own reply tool
	if ( $container.is( '#mw-content-text' ) || $container.find( '#mw-content-text' ).length ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		reallyInit( $( '#mw-content-text' ) );
		return;
	}

	// Otherwise, if node is detached, wait to see what it actually is
	if ( !$container.closest( 'html' ).length ) {
		setTimeout( function () {
			if ( $container.closest( 'html' ).length ) {
				mw.dt.init( $container );
			}
		} );
		return;
	}

	// If it's a full page live preview, (re)initialize to support highlighting comments (T309423)
	// FIXME This really should not depend on implementation details of 2 different live previews
	// FIXME VisualEditor (2017WTE) preview can't be supported, because it messes with `id` attributes
	var livePreviewSelectors = '#wikiPreview, .ext-WikiEditor-realtimepreview-preview';
	if ( $container.closest( livePreviewSelectors ).length ) {
		reallyInit( $container );
		return;
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
