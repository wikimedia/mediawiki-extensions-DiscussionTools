'use strict';

var
	$pageContainer,
	$overlay,
	Parser = require( './Parser.js' ),
	ThreadItem = require( './ThreadItem.js' ),
	logger = require( './logger.js' ),
	pageDataCache = {};

mw.messages.set( require( './controller/contLangMessages.json' ) );

function getApi() {
	return new mw.Api( {
		parameters: {
			formatversion: 2,
			uselang: mw.config.get( 'wgUserLanguage' )
		}
	} );
}

function highlight( comment ) {
	var padding = 5,
		overlayRect, rect,
		$highlight = $( '<div>' ).addClass( 'dt-init-highlight' );

	if ( !$overlay ) {
		// $overlay must be position:relative/absolute
		$overlay = $( '<div>' ).addClass( 'oo-ui-defaultOverlay' ).appendTo( 'body' );
	}

	overlayRect = $overlay[ 0 ].getBoundingClientRect();
	rect = RangeFix.getBoundingClientRect( comment.getNativeRange() );
	$highlight.css( {
		top: rect.top - overlayRect.top - padding,
		left: rect.left - overlayRect.left - padding,
		width: rect.width + ( padding * 2 ),
		height: rect.height + ( padding * 2 )
	} );
	$overlay.prepend( $highlight );

	// Pause for 500ms
	// Fade in for 100ms
	// Show for 1000ms
	// Fade out for 500ms
	// (animation durations are defined in CSS)
	OO.ui.Element.static.scrollIntoView( $highlight[ 0 ], { padding: { top: 10, bottom: 10 } } ).then( function () {
		setTimeout( function () {
			// Toggle the 'dt-init-highlight-overlay' class only when needed, because using mix-blend-mode
			// affects the text rendering of the whole page, disabling subpixel antialiasing on Windows
			$overlay.addClass( 'dt-init-highlight-overlay' );
			$highlight.addClass( 'dt-init-highlight-fadein' );
			setTimeout( function () {
				$highlight.addClass( 'dt-init-highlight-fadeout' );
				setTimeout( function () {
					$highlight.remove();
					$overlay.removeClass( 'dt-init-highlight-overlay' );
				}, 500 );
			}, 1000 + 100 );
		}, 500 );
	} );
}

/**
 * Get various pieces of page metadata.
 *
 * This method caches responses. If you call it again with the same parameters, you'll get the exact
 * same Promise object, and no API request will be made.
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @return {jQuery.Promise}
 */
function getPageData( pageName, oldId ) {
	var lintPromise, transcludedFromPromise, veMetadataPromise,
		api = getApi();

	pageDataCache[ pageName ] = pageDataCache[ pageName ] || {};
	if ( pageDataCache[ pageName ][ oldId ] ) {
		return pageDataCache[ pageName ][ oldId ];
	}

	if ( oldId ) {
		lintPromise = api.get( {
			action: 'query',
			list: 'linterrors',
			lntcategories: 'fostered',
			lntlimit: 1,
			lnttitle: pageName
		} ).then( function ( response ) {
			return OO.getProp( response, 'query', 'linterrors' ) || [];
		} );

		transcludedFromPromise = api.get( {
			action: 'discussiontools',
			paction: 'transcludedfrom',
			page: pageName,
			oldid: oldId
		} ).then( function ( response ) {
			return OO.getProp( response, 'discussiontools' ) || {};
		} );
	} else {
		lintPromise = $.Deferred().resolve( [] ).promise();
		transcludedFromPromise = $.Deferred().resolve( {} ).promise();
	}

	veMetadataPromise = api.get( {
		action: 'visualeditor',
		paction: 'metadata',
		page: pageName
	} ).then( function ( response ) {
		return OO.getProp( response, 'visualeditor' ) || [];
	} );

	pageDataCache[ pageName ][ oldId ] = $.when( lintPromise, transcludedFromPromise, veMetadataPromise )
		.then( function ( linterrors, transcludedfrom, metadata ) {
			return {
				linterrors: linterrors,
				transcludedfrom: transcludedfrom,
				metadata: metadata
			};
		}, function () {
			// Clear on failure
			pageDataCache[ pageName ][ oldId ] = null;
			// Let caller handle the error
			return $.Deferred().rejectWith( this, arguments );
		} );
	return pageDataCache[ pageName ][ oldId ];
}

/**
 * Check if a given comment on a page can be replied to
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @param {string} commentId Comment ID
 * @return {jQuery.Promise} Resolves with the pageName+oldId if the comment appears on the page.
 *  Rejects with error data if the comment is transcluded, or there are lint errors on the page.
 */
function checkCommentOnPage( pageName, oldId, commentId ) {
	return getPageData( pageName, oldId )
		.then( function ( response ) {
			var isTranscludedFrom, transcludedErrMsg, mwTitle, follow,
				lintType,
				lintErrors = response.linterrors,
				transcludedFrom = response.transcludedfrom;

			isTranscludedFrom = transcludedFrom[ commentId ];
			if ( isTranscludedFrom === undefined ) {
				// The comment wasn't found when generating the "transcludedfrom" data,
				// so we don't know where the reply should be posted. Just give up.
				return $.Deferred().reject( 'discussiontools-commentid-notfound-transcludedfrom', { errors: [ {
					code: 'discussiontools-commentid-notfound-transcludedfrom',
					html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
				} ] } ).promise();
			} else if ( isTranscludedFrom ) {
				mwTitle = isTranscludedFrom === true ? null : mw.Title.newFromText( isTranscludedFrom );
				// If this refers to a template rather than a subpage, we never want to edit it
				follow = mwTitle && mwTitle.getNamespaceId() !== mw.config.get( 'wgNamespaceIds' ).template;

				if ( follow ) {
					transcludedErrMsg = mw.message(
						'discussiontools-error-comment-is-transcluded-title',
						mwTitle.getPrefixedText()
					).parse();
				} else {
					transcludedErrMsg = mw.message(
						'discussiontools-error-comment-is-transcluded',
						// eslint-disable-next-line no-jquery/no-global-selector
						$( '#ca-edit' ).text()
					).parse();
				}

				return $.Deferred().reject( 'comment-is-transcluded', { errors: [ {
					data: {
						transcludedFrom: isTranscludedFrom,
						follow: follow
					},
					code: 'comment-is-transcluded',
					html: transcludedErrMsg
				} ] } ).promise();
			}

			if ( lintErrors.length ) {
				// We currently only request the first error
				lintType = lintErrors[ 0 ].category;

				return $.Deferred().reject( 'lint', { errors: [ {
					code: 'lint',
					html: mw.message( 'discussiontools-error-lint',
						'https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Lint_errors/' + lintType,
						'https://www.mediawiki.org/wiki/Special:MyLanguage/Help_talk:Lint_errors/' + lintType,
						mw.util.getUrl( pageName, { action: 'edit', lintid: lintErrors[ 0 ].lintId } ) ).parse()
				} ] } ).promise();
			}

			return {
				pageName: pageName,
				oldId: oldId
			};
		} );
}

function getCheckboxesPromise( pageName, oldId ) {
	return getPageData(
		pageName,
		oldId
	).then( function ( pageData ) {
		var data = pageData.metadata,
			checkboxesDef = {};

		mw.messages.set( data.checkboxesMessages );

		// Only show the watch checkbox for now
		if ( 'wpWatchthis' in data.checkboxesDef ) {
			checkboxesDef.wpWatchthis = data.checkboxesDef.wpWatchthis;
		}
		// targetLoader was loaded by getPageData
		return mw.libs.ve.targetLoader.createCheckboxFields( checkboxesDef );
		// TODO: createCheckboxField doesn't make links in the label open in a new
		// window as that method currently lives in ve.utils
	} );
}

function init( $container, state ) {
	var parser, pageThreads,
		repliedToComment,
		i, hash, comment, commentNodes, newId,
		// Loads later to avoid circular dependency
		CommentController = require( './CommentController.js' ),
		threadItemsById = {},
		threadItems = [];

	$pageContainer = $container;
	parser = new Parser( $pageContainer[ 0 ] );

	pageThreads = [];
	commentNodes = $pageContainer[ 0 ].querySelectorAll( '[data-mw-comment]' );
	threadItems.length = commentNodes.length;

	// The page can be served from the HTTP cache (Varnish), containing data-mw-comment generated
	// by an older version of our PHP code. Code below must be able to handle that.
	// See CommentFormatter::addReplyLinks() in PHP.

	// Iterate over commentNodes backwards so replies are always deserialized before their parents.
	for ( i = commentNodes.length - 1; i >= 0; i-- ) {
		hash = JSON.parse( commentNodes[ i ].getAttribute( 'data-mw-comment' ) );
		comment = ThreadItem.static.newFromJSON( hash, threadItemsById );
		threadItemsById[ comment.id ] = comment;

		if ( comment.type === 'comment' ) {
			// eslint-disable-next-line no-new
			new CommentController( $pageContainer, $( commentNodes[ i ] ), comment );
		} else {
			// Use unshift as we are in a backwards loop
			pageThreads.unshift( comment );
		}
		threadItems[ i ] = comment;
	}

	// Recalculate legacy IDs
	parser.threadItemsById = {};
	// In the forward order this time, as the IDs for indistinguishable comments depend on it
	for ( i = 0; i < threadItems.length; i++ ) {
		comment = threadItems[ i ];
		newId = parser.computeId( comment );
		parser.threadItemsById[ newId ] = comment;
		if ( newId !== comment.id ) {
			comment.id = newId;
			threadItemsById[ newId ] = comment;
		}
	}

	// For debugging (now unused in the code)
	mw.dt.pageThreads = pageThreads;

	if ( state.repliedTo ) {
		// Find the comment we replied to, then highlight the last reply
		repliedToComment = threadItemsById[ state.repliedTo ];
		highlight( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );
	}

	if ( state.repliedTo ) {
		mw.hook( 'postEdit' ).fire( {
			message: mw.msg( 'discussiontools-postedit-confirmation-published', mw.user )
		} );
	}

	// Preload page metadata.
	// TODO: Isn't this too early to load it? We will only need it if the user tries replying...
	getPageData(
		mw.config.get( 'wgRelevantPageName' ),
		mw.config.get( 'wgCurRevisionId' )
	);
}

function update( data, comment, pageName, replyWidget ) {
	var watch,
		api = getApi(),
		pageUpdated = $.Deferred();

	// We posted a new comment, clear the cache, because wgCurRevisionId will not change if we posted
	// to a transcluded page (T266275)
	pageDataCache[ mw.config.get( 'wgRelevantPageName' ) ][ mw.config.get( 'wgCurRevisionId' ) ] = null;

	replyWidget.teardown();
	// TODO: Tell controller to teardown all other open widgets

	// Update page state
	if ( pageName === mw.config.get( 'wgRelevantPageName' ) ) {
		// We can use the result from the VisualEditor API
		$pageContainer.html( data.content );
		mw.config.set( {
			wgCurRevisionId: data.newrevid,
			wgRevisionId: data.newrevid
		} );
		mw.config.set( data.jsconfigvars );
		// Note: VE API merges 'modules' and 'modulestyles'
		mw.loader.load( data.modules );
		// TODO update categories, displaytitle, lastmodified
		// (see ve.init.mw.DesktopArticleTarget.prototype.replacePageContent)

		pageUpdated.resolve();

	} else {
		// We saved to another page, we must purge and then fetch the current page
		api.post( {
			action: 'purge',
			titles: mw.config.get( 'wgRelevantPageName' )
		} ).then( function () {
			return api.get( {
				action: 'parse',
				// HACK: 'useskin' triggers a different code path that runs our OutputPageBeforeHTML hook,
				// adding our reply links in the HTML (T266195)
				useskin: mw.config.get( 'skin' ),
				uselang: mw.config.get( 'wgUserLanguage' ),
				// HACK: Always display reply links afterwards, ignoring preferences etc., in case this was
				// a page view with reply links forced with ?dtenable=1 or otherwise
				dtenable: '1',
				prop: [ 'text', 'modules', 'jsconfigvars' ],
				page: mw.config.get( 'wgRelevantPageName' )
			} );
		} ).then( function ( parseResp ) {
			$pageContainer.html( parseResp.parse.text );
			mw.config.set( parseResp.parse.jsconfigvars );
			mw.loader.load( parseResp.parse.modulestyles );
			mw.loader.load( parseResp.parse.modules );
			// TODO update categories, displaytitle, lastmodified
			// We may not be able to use prop=displaytitle without making changes in the action=parse API,
			// VE API has some confusing code that changes the HTML escaping on it before returning???

			pageUpdated.resolve();

		} ).catch( function () {
			// We saved the reply, but couldn't purge or fetch the updated page. Seems difficult to
			// explain this problem. Redirect to the page where the user can at least see their reply…
			window.location = mw.util.getUrl( pageName );
		} );
	}

	// User logged in if module loaded.
	if ( mw.loader.getState( 'mediawiki.page.watch.ajax' ) === 'ready' ) {
		watch = require( 'mediawiki.page.watch.ajax' );

		watch.updateWatchLink(
			// eslint-disable-next-line no-jquery/no-global-selector
			$( '#ca-watch a, #ca-unwatch a' ),
			data.watched ? 'unwatch' : 'watch',
			'idle',
			data.watchlistexpiry
		);
	}

	pageUpdated.then( function () {
		// Re-initialize and highlight the new reply.
		mw.dt.initState.repliedTo = comment.id;

		// We need our init code to run after everyone else's handlers for this hook,
		// so that all changes to the page layout have been completed (e.g. collapsible elements),
		// and we can measure things and display the highlight in the right place.
		mw.hook( 'wikipage.content' ).remove( mw.dt.init );
		mw.hook( 'wikipage.content' ).fire( $pageContainer );
		// The hooks have "memory" so calling add() after fire() actually fires the handler,
		// and calling add() before fire() would actually fire it twice.
		mw.hook( 'wikipage.content' ).add( mw.dt.init );

		logger( {
			action: 'saveSuccess',
			// eslint-disable-next-line camelcase
			revision_id: data.newrevid
		} );
	} );

}

module.exports = {
	init: init,
	update: update,
	checkCommentOnPage: checkCommentOnPage,
	getCheckboxesPromise: getCheckboxesPromise,
	getApi: getApi
};
