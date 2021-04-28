'use strict';

/**
 * @external CommentItem
 */

var
	$pageContainer,
	newTopicController,
	$overlay,
	featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {},
	Parser = require( './Parser.js' ),
	ThreadItem = require( './ThreadItem.js' ),
	logger = require( './logger.js' ),
	utils = require( './utils.js' ),
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
		$highlight = $( '<div>' ).addClass( 'ext-discussiontools-init-highlight' );

	if ( !$overlay ) {
		// $overlay must be position:relative/absolute
		$overlay = $( '<div>' ).addClass( 'oo-ui-defaultOverlay' ).appendTo( 'body' );
	}

	var overlayRect = $overlay[ 0 ].getBoundingClientRect();
	var rect = RangeFix.getBoundingClientRect( comment.getNativeRange() );
	$highlight.css( {
		top: rect.top - overlayRect.top - padding,
		left: rect.left - overlayRect.left - padding,
		width: rect.width + ( padding * 2 ),
		height: rect.height + ( padding * 2 )
	} );
	$overlay.prepend( $highlight );

	// Show a highlight with the same timing as the post-edit message (mediawiki.action.view.postEdit):
	// show for 3000ms, fade out for 250ms (animation duration is defined in CSS).
	OO.ui.Element.static.scrollIntoView( $highlight[ 0 ], { padding: { top: 10, bottom: 10 } } ).then( function () {
		// Toggle the 'ext-discussiontools-init-highlight-overlay' class only when needed, because using mix-blend-mode
		// affects the text rendering of the whole page, disabling subpixel antialiasing on Windows
		$overlay.addClass( 'ext-discussiontools-init-highlight-overlay' );
		$highlight.addClass( 'ext-discussiontools-init-highlight-fadein' );
		setTimeout( function () {
			$highlight.addClass( 'ext-discussiontools-init-highlight-fadeout' );
			setTimeout( function () {
				$highlight.remove();
				$overlay.removeClass( 'ext-discussiontools-init-highlight-overlay' );
			}, 250 );
		}, 3000 );
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
 * @param {boolean} [isNewTopic=false]
 * @return {jQuery.Promise}
 */
function getPageData( pageName, oldId, isNewTopic ) {
	var api = getApi();

	pageDataCache[ pageName ] = pageDataCache[ pageName ] || {};
	if ( pageDataCache[ pageName ][ oldId ] ) {
		return pageDataCache[ pageName ][ oldId ];
	}

	var lintPromise, transcludedFromPromise;
	if ( oldId && !isNewTopic ) {
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

	var veMetadataPromise = api.get( {
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
 * @param {CommentItem} comment Comment
 * @return {jQuery.Promise} Resolves with the pageName+oldId if the comment appears on the page.
 *  Rejects with error data if the comment is transcluded, or there are lint errors on the page.
 */
function checkCommentOnPage( pageName, oldId, comment ) {
	var isNewTopic = comment.id.slice( 0, 4 ) === 'new|';

	return getPageData( pageName, oldId, isNewTopic )
		.then( function ( response ) {
			var metadata = response.metadata,
				lintErrors = response.linterrors,
				transcludedFrom = response.transcludedfrom;

			if ( !isNewTopic ) {
				// First look for data by the comment's ID. If not found, also look by name.
				// Data by ID may not be found due to differences in headings (e.g. T273413, T275821),
				// or if a comment's parent changes.
				// Data by name might be combined from two or more comments, which would only allow us to
				// treat them both as transcluded from unknown source, unless we check ID first.
				var isTranscludedFrom = transcludedFrom[ comment.id ] || transcludedFrom[ comment.name ];
				if ( isTranscludedFrom === undefined ) {
					// The comment wasn't found when generating the "transcludedfrom" data,
					// so we don't know where the reply should be posted. Just give up.
					return $.Deferred().reject( 'discussiontools-commentid-notfound-transcludedfrom', { errors: [ {
						code: 'discussiontools-commentid-notfound-transcludedfrom',
						html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
					} ] } ).promise();
				} else if ( isTranscludedFrom ) {
					var mwTitle = isTranscludedFrom === true ? null : mw.Title.newFromText( isTranscludedFrom );
					// If this refers to a template rather than a subpage, we never want to edit it
					var follow = mwTitle && mwTitle.getNamespaceId() !== mw.config.get( 'wgNamespaceIds' ).template;

					var transcludedErrMsg;
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
					var lintType = lintErrors[ 0 ].category;

					return $.Deferred().reject( 'lint', { errors: [ {
						code: 'lint',
						html: mw.message( 'discussiontools-error-lint',
							'https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Lint_errors/' + lintType,
							'https://www.mediawiki.org/wiki/Special:MyLanguage/Help_talk:Lint_errors/' + lintType,
							mw.util.getUrl( pageName, { action: 'edit', lintid: lintErrors[ 0 ].lintId } ) ).parse()
					} ] } ).promise();
				}
			}

			if ( !metadata.canEdit ) {
				return $.Deferred().reject( 'permissions-error', { errors: [ {
					code: 'permissions-error',
					html: metadata.notices[ 'permissions-error' ]
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
		return mw.loader.using( 'ext.visualEditor.targetLoader' ).then( function () {
			return mw.libs.ve.targetLoader.createCheckboxFields( checkboxesDef );
		} );
		// TODO: createCheckboxField doesn't make links in the label open in a new
		// window as that method currently lives in ve.utils
	} );
}

function initTopicSubscriptions( $container ) {
	$container.find( '.ext-discussiontools-section-subscribe' ).on( 'click', function () {
		var element = this,
			api = getApi(),
			subscribe = element.classList.contains( 'oo-ui-icon-star' ),
			commentName = this.getAttribute( 'data-mw-comment-name' ),
			heading = $( this ).closest( '.ext-discussiontools-section' )[ 0 ],
			section = utils.getHeadlineNodeAndOffset( heading ).node.id,
			title = mw.config.get( 'wgRelevantPageName' ) + '#' + section;

		if ( !commentName ) {
			// This should never happen
			return;
		}

		// TODO: Disable button while pending
		api.postWithToken( 'csrf', {
			action: 'discussiontoolssubscribe',
			page: title,
			commentname: commentName,
			subscribe: subscribe
		}, { contentType: 'multipart/form-data' } ).then( function ( response2 ) {
			return OO.getProp( response2, 'discussiontoolssubscribe' ) || {};
		} ).then( function ( result ) {
			element.classList.remove( 'oo-ui-icon-star', 'oo-ui-icon-unStar', 'oo-ui-image-progressive' );
			if ( result.subscribe ) {
				element.classList.add( 'oo-ui-icon-unStar', 'oo-ui-image-progressive' );
			} else {
				element.classList.add( 'oo-ui-icon-star' );
			}
			mw.notify(
				mw.msg(
					result.subscribe ?
						'discussiontools-topicsubscription-notify-subscribed-body' :
						'discussiontools-topicsubscription-notify-unsubscribed-body'
				),
				{
					title: mw.msg(
						result.subscribe ?
							'discussiontools-topicsubscription-notify-subscribed-title' :
							'discussiontools-topicsubscription-notify-unsubscribed-title'
					)
				}
			);
		} );
	} );
}

function init( $container, state ) {
	var pageExists = !!mw.config.get( 'wgRelevantArticleId' ),
		controllers = [],
		activeController = null,
		// Loads later to avoid circular dependency
		CommentController = require( './CommentController.js' ),
		NewTopicController = require( './NewTopicController.js' ),
		threadItemsById = {},
		threadItems = [];

	$pageContainer = $container;
	var parser = new Parser( $pageContainer[ 0 ] );

	var pageThreads = [];
	var commentNodes = $pageContainer[ 0 ].querySelectorAll( '[data-mw-comment]' );
	threadItems.length = commentNodes.length;

	// The page can be served from the HTTP cache (Varnish), containing data-mw-comment generated
	// by an older version of our PHP code. Code below must be able to handle that.
	// See CommentFormatter::addDiscussionTools() in PHP.

	// Iterate over commentNodes backwards so replies are always deserialized before their parents.
	var i, comment;
	for ( i = commentNodes.length - 1; i >= 0; i-- ) {
		var hash = JSON.parse( commentNodes[ i ].getAttribute( 'data-mw-comment' ) );
		comment = ThreadItem.static.newFromJSON( hash, threadItemsById );
		if ( !comment.name ) {
			comment.name = parser.computeName( comment );
		}

		threadItemsById[ comment.id ] = comment;

		if ( comment.type === 'comment' ) {
			controllers.push(
				new CommentController( $pageContainer, $( commentNodes[ i ] ), comment, parser )
			);
		} else {
			// Use unshift as we are in a backwards loop
			pageThreads.unshift( comment );
		}
		threadItems[ i ] = comment;
	}

	// Recalculate legacy IDs
	parser.threadItemsByName = {};
	parser.threadItemsById = {};
	// In the forward order this time, as the IDs for indistinguishable comments depend on it
	for ( i = 0; i < threadItems.length; i++ ) {
		comment = threadItems[ i ];

		if ( !parser.threadItemsByName[ comment.name ] ) {
			parser.threadItemsByName[ comment.name ] = [];
		}
		parser.threadItemsByName[ comment.name ].push( comment );

		var newId = parser.computeId( comment );
		parser.threadItemsById[ newId ] = comment;
		if ( newId !== comment.id ) {
			comment.id = newId;
			threadItemsById[ newId ] = comment;
		}
	}

	if ( featuresEnabled.newtopictool && mw.user.options.get( 'discussiontools-newtopictool' ) ) {
		if ( newTopicController ) {
			// Stop the torn down controller from re-appearing
			newTopicController.$replyLink.off( 'click keypress', newTopicController.onReplyLinkClickHandler );
		}
		// eslint-disable-next-line no-jquery/no-global-selector
		var $addSectionTab = $( '#ca-addsection' );
		// TODO If the page doesn't exist yet, we'll need to handle the interface differently,
		// for now just don't enable the tool there
		if ( $addSectionTab.length && pageExists ) {
			// Disable VisualEditor's new section editor (in wikitext mode / NWE), to allow our own
			$addSectionTab.off( '.ve-target' );
			newTopicController = new NewTopicController( $pageContainer, $addSectionTab.find( 'a' ), parser );
			controllers.push( newTopicController );
		}
	}

	if ( featuresEnabled.topicsubscription && mw.user.options.get( 'discussiontools-topicsubscription' ) ) {
		initTopicSubscriptions( $container );
	}

	// Hook up each link to open a reply widget
	//
	// TODO: Allow users to use multiple reply widgets simultaneously.
	// Currently submitting a reply from one widget would also destroy the other ones.
	controllers.forEach( function ( c ) {
		c.on( 'link-click', function () {
			// If the reply widget is already open, activate it.
			// Reply links are also made unclickable using 'pointer-events' in CSS, but that doesn't happen
			// for new section links, because we don't have a good way of visually disabling them.
			// (And it also doesn't work on IE 11.)
			if ( activeController === c ) {
				c.showAndFocus();
				return;
			}

			// If this is a new topic link, and a reply widget is open, attempt to close it first.
			if ( activeController && c instanceof NewTopicController ) {
				activeController.replyWidget.tryTeardown().then( function () {
					activeController = c;
					c.setup();
				} );
				return;
			}

			// If another reply widget is open (or opening), do nothing.
			if ( activeController ) {
				return;
			}

			activeController = c;
			c.setup();
		} ).on( 'teardown', function () {
			activeController = null;
		} );
	} );

	// For debugging (now unused in the code)
	mw.dt.pageThreads = pageThreads;

	if ( state.repliedTo === 'new|' + mw.config.get( 'wgRelevantPageName' ) ) {
		// Highlight the last comment on the page
		var lastComment = threadItems[ threadItems.length - 1 ];
		highlight( lastComment );

		// If it's the only comment under its heading, highlight the heading too.
		// (It might not be if the new discussion topic was posted without a title: T272666.)
		if (
			lastComment.parent &&
			lastComment.parent.type === 'heading' &&
			lastComment.parent.replies.length === 1
		) {
			highlight( lastComment.parent );
		}

		mw.hook( 'postEdit' ).fire( {
			message: mw.msg( 'discussiontools-postedit-confirmation-topicadded', mw.user )
		} );

	} else if ( state.repliedTo ) {
		// Find the comment we replied to, then highlight the last reply
		var repliedToComment = threadItemsById[ state.repliedTo ];
		highlight( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );

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
	var api = getApi(),
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
		var watch = require( 'mediawiki.page.watch.ajax' );

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
