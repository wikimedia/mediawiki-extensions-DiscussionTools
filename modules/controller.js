'use strict';

var
	$pageContainer, linksController,
	featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {},
	storage = mw.storage.session,
	Parser = require( './Parser.js' ),
	ThreadItem = require( './ThreadItem.js' ),
	CommentDetails = require( './CommentDetails.js' ),
	ReplyLinksController = require( './ReplyLinksController.js' ),
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

/**
 * Draw a semi-transparent rectangle on the page to highlight the given comment.
 *
 * @param {CommentItem} comment
 * @return {jQuery} Highlight node
 */
function highlight( comment ) {
	var padding = 5,
		$highlight = $( '<div>' ).addClass( 'ext-discussiontools-init-highlight' );

	// We insert the highlight in the DOM near the comment, so that it remains positioned correctly
	// when it shifts (e.g. collapsing the table of contents), and disappears when it is hidden (e.g.
	// opening visual editor).
	var range = comment.getNativeRange();
	// Support: Firefox, IE 11
	// The highlight node must be inserted after the start marker node (data-mw-comment-start), not
	// before, otherwise Node#getBoundingClientRect() returns wrong results.
	range.insertNode( $highlight[ 0 ] );

	var baseRect = $highlight[ 0 ].getBoundingClientRect();
	var rect = RangeFix.getBoundingClientRect( range );
	// rect may be null if the range is in a detached or hidden node
	if ( rect ) {
		$highlight.css( {
			'margin-top': rect.top - baseRect.top - padding,
			'margin-left': rect.left - baseRect.left - padding,
			width: rect.width + ( padding * 2 ),
			height: rect.height + ( padding * 2 )
		} );
	}

	return $highlight;
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
 * @return {jQuery.Promise} Resolved with a CommentDetails object if the comment appears on the page.
 *  Rejects with error data if the comment is transcluded, or there are lint errors on the page.
 */
function checkCommentOnPage( pageName, oldId, comment ) {
	var isNewTopic = comment.id === utils.NEW_TOPIC_COMMENT_ID;

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

			return new CommentDetails( pageName, oldId, metadata.notices );
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
			// Override the label with a more verbose one to distinguish this from topic subscriptions (T290712)
			checkboxesDef.wpWatchthis[ 'label-message' ] = 'discussiontools-replywidget-watchthis';
		}
		return mw.loader.using( 'ext.visualEditor.targetLoader' ).then( function () {
			return mw.libs.ve.targetLoader.createCheckboxFields( checkboxesDef );
		} );
		// TODO: createCheckboxField doesn't make links in the label open in a new
		// window as that method currently lives in ve.utils
	} );
}

function initTopicSubscriptions( $container ) {
	$container.find( '.ext-discussiontools-init-section-subscribe-link' ).on( 'click keypress', function ( e ) {
		if ( e.type === 'keypress' && e.which !== OO.ui.Keys.ENTER && e.which !== OO.ui.Keys.SPACE ) {
			// Only handle keypresses on the "Enter" or "Space" keys
			return;
		}
		if ( e.type === 'click' && ( e.which !== OO.ui.MouseButtons.LEFT || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey ) ) {
			// Only handle unmodified left clicks
			return;
		}

		e.preventDefault();

		var commentName = this.getAttribute( 'data-mw-comment-name' );

		if ( !commentName ) {
			// This should never happen
			return;
		}

		var element = this,
			api = getApi(),
			isSubscribed = element.hasAttribute( 'data-mw-subscribed' ),
			heading = $( this ).closest( '.ext-discussiontools-init-section' )[ 0 ],
			section = utils.getHeadlineNodeAndOffset( heading ).node.id,
			title = mw.config.get( 'wgRelevantPageName' ) + '#' + section;

		// TODO: Disable button while pending
		api.postWithToken( 'csrf', {
			action: 'discussiontoolssubscribe',
			page: title,
			commentname: commentName,
			subscribe: !isSubscribed
		} ).then( function ( response ) {
			return OO.getProp( response, 'discussiontoolssubscribe' ) || {};
		} ).then( function ( result ) {
			if ( result.subscribe ) {
				element.setAttribute( 'data-mw-subscribed', '' );
				element.textContent = mw.msg( 'discussiontools-topicsubscription-button-unsubscribe' );
				element.setAttribute( 'title', mw.msg( 'discussiontools-topicsubscription-button-unsubscribe-tooltip' ) );
			} else {
				element.removeAttribute( 'data-mw-subscribed' );
				element.textContent = mw.msg( 'discussiontools-topicsubscription-button-subscribe' );
				element.setAttribute( 'title', mw.msg( 'discussiontools-topicsubscription-button-subscribe-tooltip' ) );
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
		}, function ( code, data ) {
			mw.notify( api.getErrorMessage( data ), { type: 'error' } );
		} );
	} );
}

var $highlightedTarget = null;
function highlightTargetComment( parser, event ) {
	// Delay with setTimeout() because "the Document's target element" (corresponding to the :target
	// selector in CSS) is not yet updated to match the URL when handling a 'popstate' event.
	setTimeout( function () {
		if ( $highlightedTarget ) {
			$highlightedTarget.remove();
			$highlightedTarget = null;
		}
		// eslint-disable-next-line no-jquery/no-global-selector
		var targetElement = $( ':target' )[ 0 ];

		var uri;
		try {
			uri = new mw.Uri( location.href );
		} catch ( err ) {
			// T106244: URL encoded values using fallback 8-bit encoding (invalid UTF-8) cause mediawiki.Uri to crash
			uri = null;
		}
		var targetIds = uri && uri.query.dtnewcomments && uri.query.dtnewcomments.split( '|' );
		if ( targetElement && targetElement.hasAttribute( 'data-mw-comment-start' ) ) {
			var comment = parser.findCommentById( targetElement.getAttribute( 'id' ) );
			$highlightedTarget = highlight( comment );
			$highlightedTarget.addClass( 'ext-discussiontools-init-targetcomment' );
			$highlightedTarget.addClass( 'ext-discussiontools-init-highlight-fadein' );
		} else if ( targetIds ) {
			var comments = targetIds.map( function ( id ) {
				return parser.findCommentById( id );
			} ).filter( function ( cmt ) {
				return !!cmt;
			} );
			if ( comments.length === 0 ) {
				return;
			}

			var highlights = comments.map( function ( cmt ) {
				return highlight( cmt )[ 0 ];
			} );
			$highlightedTarget = $( highlights );
			$highlightedTarget.addClass( 'ext-discussiontools-init-targetcomment' );
			$highlightedTarget.addClass( 'ext-discussiontools-init-highlight-fadein' );

			if ( !event ) {
				// Scroll to the topmost comment on initial page load, but not on popstate events
				var topmostComment = 0;
				for ( var i = 1; i < comments.length; i++ ) {
					if ( highlights[ i ].getBoundingClientRect().top < highlights[ topmostComment ].getBoundingClientRect().top ) {
						topmostComment = i;
					}
				}
				document.getElementById( comments[ topmostComment ].id ).scrollIntoView();
			}
		}
	} );
}

function clearHighlightTargetComment( parser ) {
	// eslint-disable-next-line no-jquery/no-global-selector
	var targetElement = $( ':target' )[ 0 ];
	if ( targetElement && targetElement.hasAttribute( 'data-mw-comment-start' ) ) {
		// Clear the hash from the URL, triggering the 'hashchange' event and updating the :target
		// selector (so that our code to clear our highlight works), but without scrolling anywhere.
		// This is tricky because:
		// * Using history.pushState() does not trigger 'hashchange' or update the :target selector.
		//   https://developer.mozilla.org/en-US/docs/Web/API/History/pushState#description
		//   https://github.com/whatwg/html/issues/639
		// * Using window.location.hash does, but it also scrolls to the target, which is the top of the
		//   page for the empty hash.
		// Instead, we first use window.location.hash to navigate to a *different* hash (whose target
		// doesn't exist on the page, hopefully), and then use history.pushState() to clear it.
		window.location.hash += '-DoesNotExist-DiscussionToolsHack';
		history.replaceState( null, document.title, window.location.href.replace( /#.*$/, '' ) );
	} else if ( window.location.search.match( /(^\?|&)dtnewcomments=/ ) ) {
		history.pushState( null, document.title,
			window.location.search.replace( /(^\?|&)dtnewcomments=[^&]+/, '' ) + window.location.hash );
		highlightTargetComment( parser );
	}
}

function init( $container, state ) {
	var
		activeCommentId = null,
		activeController = null,
		// Loads later to avoid circular dependency
		CommentController = require( './CommentController.js' ),
		NewTopicController = require( './NewTopicController.js' ),
		threadItemsById = {},
		threadItems = [];

	// Lazy-load postEdit module, may be required later (on desktop)
	mw.loader.using( 'mediawiki.action.view.postEdit' );

	$pageContainer = $container;
	linksController = new ReplyLinksController( $pageContainer );
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

		if ( comment.type === 'heading' ) {
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

	if ( featuresEnabled.topicsubscription ) {
		initTopicSubscriptions( $container );
	}

	function setupController( commentId, $link, mode, hideErrors ) {
		var commentController, $addSectionLink;
		if ( commentId === utils.NEW_TOPIC_COMMENT_ID ) {
			// eslint-disable-next-line no-jquery/no-global-selector
			$addSectionLink = $( '#ca-addsection a' );
			// When opening new topic tool using any link, always activate the link in page tabs too
			$link = $link.add( $addSectionLink );
			commentController = new NewTopicController( $pageContainer, parser );
		} else {
			commentController = new CommentController( $pageContainer, parser.findCommentById( commentId ), parser );
		}

		activeCommentId = commentId;
		activeController = commentController;
		linksController.setActiveLink( $link );

		commentController.on( 'teardown', function ( abandoned ) {
			activeCommentId = null;
			activeController = null;
			linksController.clearActiveLink();

			if ( abandoned ) {
				linksController.focusLink( $link );
			}
		} );

		commentController.setup( mode, hideErrors );
	}

	// Hook up each link to open a reply widget
	//
	// TODO: Allow users to use multiple reply widgets simultaneously.
	// Currently submitting a reply from one widget would also destroy the other ones.
	linksController.on( 'link-click', function ( commentId, $link ) {
		// If the reply widget is already open, activate it.
		// Reply links are also made unclickable using 'pointer-events' in CSS, but that doesn't happen
		// for new section links, because we don't have a good way of visually disabling them.
		// (And it also doesn't work on IE 11.)
		if ( activeCommentId === commentId ) {
			activeController.showAndFocus();
			return;
		}

		// If this is a new topic link, and a reply widget is open, attempt to close it first.
		var promise;
		if ( activeController && commentId === utils.NEW_TOPIC_COMMENT_ID ) {
			promise = activeController.replyWidget.tryTeardown();
		} else {
			promise = $.Deferred().resolve();
		}

		promise.then( function () {
			// If another reply widget is open (or opening), do nothing.
			if ( activeController ) {
				return;
			}
			setupController( commentId, $link );
		} );
	} );

	// Restore autosave
	var mode, $link;
	for ( i = 0; i < threadItems.length; i++ ) {
		comment = threadItems[ i ];
		if ( storage.get( 'reply/' + comment.id + '/saveable' ) ) {
			mode = storage.get( 'reply/' + comment.id + '/mode' );
			$link = $( commentNodes[ i ] );
			setupController( comment.id, $link, mode, true );
			break;
		}
	}
	if ( storage.get( 'reply/' + utils.NEW_TOPIC_COMMENT_ID + '/saveable' ) ) {
		mode = storage.get( 'reply/' + utils.NEW_TOPIC_COMMENT_ID + '/mode' );
		setupController( utils.NEW_TOPIC_COMMENT_ID, $( [] ), mode, true );
	} else if ( mw.config.get( 'wgDiscussionToolsStartNewTopicTool' ) ) {
		setupController( utils.NEW_TOPIC_COMMENT_ID, $( [] ) );
	}

	// For debugging (now unused in the code)
	mw.dt.pageThreads = pageThreads;

	var promise = OO.ui.isMobile && mw.loader.getState( 'mobile.init' ) ?
		mw.loader.using( 'mobile.init' ) :
		$.Deferred().resolve().promise();

	promise.then( function () {
		var $highlight;
		if ( state.repliedTo === utils.NEW_TOPIC_COMMENT_ID ) {
			// Highlight the last comment on the page
			var lastComment = threadItems[ threadItems.length - 1 ];
			$highlight = highlight( lastComment );

			// If it's the only comment under its heading, highlight the heading too.
			// (It might not be if the new discussion topic was posted without a title: T272666.)
			if (
				lastComment.parent &&
				lastComment.parent.type === 'heading' &&
				lastComment.parent.replies.length === 1
			) {
				$highlight = $highlight.add( highlight( lastComment.parent ) );
			}

			mw.hook( 'postEdit' ).fire( {
				message: mw.msg( 'discussiontools-postedit-confirmation-topicadded', mw.user )
			} );

		} else if ( state.repliedTo ) {
			// Find the comment we replied to, then highlight the last reply
			var repliedToComment = threadItemsById[ state.repliedTo ];
			$highlight = highlight( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );

			if ( OO.ui.isMobile() ) {
				mw.notify( mw.msg( 'discussiontools-postedit-confirmation-published', mw.user ) );
			} else {
				// postEdit is currently desktop only
				mw.hook( 'postEdit' ).fire( {
					message: mw.msg( 'discussiontools-postedit-confirmation-published', mw.user )
				} );
			}
		}

		if ( $highlight ) {
			$highlight.addClass( 'ext-discussiontools-init-publishedcomment' );

			// Show a highlight with the same timing as the post-edit message (mediawiki.action.view.postEdit):
			// show for 3000ms, fade out for 250ms (animation duration is defined in CSS).
			OO.ui.Element.static.scrollIntoView(
				$highlight[ 0 ],
				{
					padding: {
						top: 10,
						// Add padding on mobile to avoid overlapping the notification
						bottom: 10 + ( OO.ui.isMobile() ? 75 : 0 )
					},
					// Specify scrollContainer for compatibility with MobileFrontend.
					// Apparently it makes `<dd>` elements scrollable and OOUI tried to scroll them instead of body.
					scrollContainer: OO.ui.Element.static.getRootScrollableElement( $highlight[ 0 ] )
				}
			).then( function () {
				$highlight.addClass( 'ext-discussiontools-init-highlight-fadein' );
				setTimeout( function () {
					$highlight.addClass( 'ext-discussiontools-init-highlight-fadeout' );
					setTimeout( function () {
						// Remove the node when no longer needed, because it's using CSS 'mix-blend-mode', which
						// affects the text rendering of the whole page, disabling subpixel antialiasing on Windows
						$highlight.remove();
					}, 250 );
				}, 3000 );
			} );
		}
	} );

	// Preload page metadata.
	// TODO: Isn't this too early to load it? We will only need it if the user tries replying...
	getPageData(
		mw.config.get( 'wgRelevantPageName' ),
		mw.config.get( 'wgCurRevisionId' )
	);

	$( window ).on( 'popstate', highlightTargetComment.bind( null, parser ) );
	// eslint-disable-next-line no-jquery/no-global-selector
	$( 'body' ).on( 'click', function ( e ) {
		if ( e.which === OO.ui.MouseButtons.LEFT ) {
			clearHighlightTargetComment( parser );
		}
	} );
	highlightTargetComment( parser );
}

function update( data, comment, pageName, replyWidget ) {
	var api = getApi(),
		pageUpdated = $.Deferred(),
		$content;

	// We posted a new comment, clear the cache, because wgCurRevisionId will not change if we posted
	// to a transcluded page (T266275)
	pageDataCache[ mw.config.get( 'wgRelevantPageName' ) ][ mw.config.get( 'wgCurRevisionId' ) ] = null;

	var pageExists = !!mw.config.get( 'wgRelevantArticleId' );
	if ( !pageExists ) {
		// The page didn't exist before this update, so reload it. We'd handle
		// setting up the content just fine (assuming there's a
		// mw-parser-output), but fixing up the UI tabs/behavior is outside
		// our scope.
		replyWidget.unbindBeforeUnloadHandler();
		replyWidget.clearStorage();
		replyWidget.setPending( true );
		window.location = mw.util.getUrl( pageName, { dtrepliedto: comment.id } );
		return;
	}

	replyWidget.teardown();
	linksController.teardown();
	linksController = null;
	// TODO: Tell controller to teardown all other open widgets

	if ( OO.ui.isMobile() ) {
		// MobileFrontend does not use the 'wikipage.content' hook, and its interface will not
		// re-initialize properly (e.g. page sections won't be collapsible). Reload the whole page.
		window.location = mw.util.getUrl( pageName, { dtrepliedto: comment.id } );
		return;
	}

	// Update page state
	if ( pageName === mw.config.get( 'wgRelevantPageName' ) ) {
		// We can use the result from the VisualEditor API
		$content = $( $.parseHTML( data.content ) );
		$pageContainer.find( '.mw-parser-output' ).replaceWith( $content );
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
			$content = $( $.parseHTML( parseResp.parse.text ) );
			$pageContainer.find( '.mw-parser-output' ).replaceWith( $content );
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
			window.location = mw.util.getUrl( pageName, { dtrepliedto: comment.id } );
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
			timing: mw.now() - replyWidget.saveInitiated,
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
