var
	lastHighlightedPublishedComment = null,
	CommentItem = require( './CommentItem.js' ),
	utils = require( './utils.js' );

/**
 * Draw a semi-transparent rectangle on the page to highlight the given comment.
 *
 * @class
 * @param {CommentItem|CommentItem[]} comments Comment item(s) to highlight
 */
function Highlight( comments ) {
	var highlight = this;

	this.ranges = [];
	this.$element = $( [] );
	this.topmostElement = null;

	comments = Array.isArray( comments ) ? comments : [ comments ];

	comments.forEach( function ( comment ) {
		var $highlight = $( '<div>' ).addClass( 'ext-discussiontools-init-highlight' );

		// We insert the highlight in the DOM near the comment, so that it remains positioned correctly
		// when it shifts (e.g. collapsing the table of contents), and disappears when it is hidden (e.g.
		// opening visual editor).
		var range = comment.getNativeRange();
		// Support: Firefox, IE 11
		// The highlight node must be inserted after the start marker node (data-mw-comment-start), not
		// before, otherwise Node#getBoundingClientRect() returns wrong results.
		range.insertNode( $highlight[ 0 ] );

		highlight.ranges.push( range );
		highlight.$element = highlight.$element.add( $highlight );
	} );

	// Events
	this.updateDebounced = OO.ui.debounce( this.update.bind( this ), 500 );
	window.addEventListener( 'resize', this.updateDebounced );

	this.update();
}

OO.initClass( Highlight );

/**
 * Update position of highlights, e.g. after window resize
 */
Highlight.prototype.update = function () {
	var highlight = this;
	this.$element.css( {
		'margin-top': '',
		'margin-left': '',
		width: '',
		height: ''
	} );
	this.topmostElement = null;
	var top = Infinity;
	this.ranges.forEach( function ( range, i ) {
		var baseRect = highlight.$element.get( i ).getBoundingClientRect();
		var rect = RangeFix.getBoundingClientRect( range );
		// rect may be null if the range is in a detached or hidden node
		if ( rect ) {
			var padding = 5;
			highlight.$element.eq( i ).css( {
				'margin-top': rect.top - baseRect.top - padding,
				'margin-left': rect.left - baseRect.left - padding,
				width: rect.width + ( padding * 2 ),
				height: rect.height + ( padding * 2 )
			} );
			if ( rect.top < top ) {
				highlight.topmostElement = highlight.$element.get( i );
				top = rect.top;
			}
		}
	} );
};

/**
 * Scroll the topmost comment into view
 */
Highlight.prototype.scrollIntoView = function () {
	if ( this.topmostElement ) {
		this.topmostElement.scrollIntoView();
	}
};

/**
 * Destroy the highlight
 */
Highlight.prototype.destroy = function () {
	this.$element.remove();
	window.removeEventListener( 'resize', this.updateDebounced );
};

var highlightedTarget = null;
var missingTargetNotifPromise = null;
/**
 * Highlight the comment(s) on the page associated with the URL hash or query string
 *
 * @param {ThreadItemSet} threadItemSet
 * @param {boolean} [noScroll] Don't scroll to the topmost highlighted comment, e.g. on popstate
 */
function highlightTargetComment( threadItemSet, noScroll ) {
	if ( highlightedTarget ) {
		highlightedTarget.destroy();
		highlightedTarget = null;
	}
	if ( missingTargetNotifPromise ) {
		missingTargetNotifPromise.then( function ( notif ) {
			notif.close();
		} );
		missingTargetNotifPromise = null;
	}
	// Delay with setTimeout() because "the Document's target element" (corresponding to the :target
	// selector in CSS) is not yet updated to match the URL when handling a 'popstate' event.
	setTimeout( function () {
		// eslint-disable-next-line no-jquery/no-global-selector
		var targetElement = $( ':target' )[ 0 ];

		if ( targetElement && targetElement.hasAttribute( 'data-mw-comment-start' ) ) {
			var comment = threadItemSet.findCommentById( targetElement.getAttribute( 'id' ) );
			highlightedTarget = new Highlight( comment );
			highlightedTarget.$element.addClass( 'ext-discussiontools-init-targetcomment' );
			highlightedTarget.$element.addClass( 'ext-discussiontools-init-highlight-fadein' );
			return;
		}

		if ( location.hash.match( /^#c-/ ) && !targetElement ) {
			missingTargetNotifPromise = mw.loader.using( 'mediawiki.notification' ).then( function () {
				return mw.notification.notify(
					mw.message( 'discussiontools-target-comment-missing' ).parse(),
					{ type: 'warn', autoHide: false }
				);
			} );
		}

		var url = new URL( location.href );
		highlightNewComments(
			threadItemSet,
			noScroll,
			url.searchParams.get( 'dtnewcomments' ) && url.searchParams.get( 'dtnewcomments' ).split( '|' ),
			url.searchParams.get( 'dtnewcommentssince' ),
			url.searchParams.get( 'dtinthread' )
		);
	} );
}

/**
 * Highlight a just-published comment/topic
 *
 * These highlights show for a short period of time then tear themselves down.
 *
 * @param {ThreadItemSet} threadItemSet Thread item set
 * @param {string} threadItemId Thread item ID (NEW_TOPIC_COMMENT_ID for the a new topic)
 */
function highlightPublishedComment( threadItemSet, threadItemId ) {
	var highlightComments = [];

	if ( threadItemId === utils.NEW_TOPIC_COMMENT_ID ) {
		// Highlight the last comment on the page
		var lastComment = threadItemSet.threadItems[ threadItemSet.threadItems.length - 1 ];
		lastHighlightedPublishedComment = lastComment;
		highlightComments.push( lastComment );

		// If it's the only comment under its heading, highlight the heading too.
		// (It might not be if the new discussion topic was posted without a title: T272666.)
		if (
			lastComment.parent &&
			lastComment.parent.type === 'heading' &&
			lastComment.parent.replies.length === 1
		) {
			highlightComments.push( lastComment.parent );
			lastHighlightedPublishedComment = lastComment.parent;
		}
	} else {
		// Find the comment we replied to, then highlight the last reply
		var repliedToComment = threadItemSet.threadItemsById[ threadItemId ];
		highlightComments.push( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );
		lastHighlightedPublishedComment = highlightComments[ 0 ];
	}
	var highlight = new Highlight( highlightComments );

	highlight.$element.addClass( 'ext-discussiontools-init-publishedcomment' );

	// Show a highlight with the same timing as the post-edit message (mediawiki.action.view.postEdit):
	// show for 3000ms, fade out for 250ms (animation duration is defined in CSS).
	OO.ui.Element.static.scrollIntoView(
		highlight.topmostElement,
		{
			padding: {
				// Add padding to avoid overlapping the post-edit notification (above on desktop, below on mobile)
				top: OO.ui.isMobile() ? 10 : 60,
				bottom: OO.ui.isMobile() ? 85 : 10
			},
			// Specify scrollContainer for compatibility with MobileFrontend.
			// Apparently it makes `<dd>` elements scrollable and OOUI tried to scroll them instead of body.
			scrollContainer: OO.ui.Element.static.getRootScrollableElement( highlight.topmostElement )
		}
	).then( function () {
		highlight.$element.addClass( 'ext-discussiontools-init-highlight-fadein' );
		setTimeout( function () {
			highlight.$element.addClass( 'ext-discussiontools-init-highlight-fadeout' );
			setTimeout( function () {
				// Remove the node when no longer needed, because it's using CSS 'mix-blend-mode', which
				// affects the text rendering of the whole page, disabling subpixel antialiasing on Windows
				highlight.destroy();
			}, 250 );
		}, 3000 );
	} );
}

/**
 * Highlight the new comments on the page associated with the query string
 *
 * @param {ThreadItemSet} threadItemSet
 * @param {boolean} [noScroll] Don't scroll to the topmost highlighted comment, e.g. on popstate
 * @param {string[]} [newCommentIds] A list of comment IDs to highlight
 * @param {string} [newCommentsSinceId] Highlight all comments after the comment with this ID
 * @param {boolean} [inThread] When using newCommentsSinceId, only highlight comments in the same thread
 */
function highlightNewComments( threadItemSet, noScroll, newCommentIds, newCommentsSinceId, inThread ) {
	if ( highlightedTarget ) {
		highlightedTarget.destroy();
		highlightedTarget = null;
	}

	newCommentIds = newCommentIds || [];

	var highlightsRequested = newCommentIds.length || newCommentsSinceId;
	var highlightsRequestedSingle = !newCommentsSinceId && newCommentIds.length === 1;

	if ( newCommentsSinceId ) {
		var newCommentsSince = threadItemSet.findCommentById( newCommentsSinceId );
		if ( newCommentsSince && newCommentsSince instanceof CommentItem ) {
			var sinceTimestamp = newCommentsSince.timestamp;
			var threadItems;
			if ( inThread ) {
				var heading = newCommentsSince.getSubscribableHeading() || newCommentsSince.getHeading();
				threadItems = heading.getThreadItemsBelow();
			} else {
				threadItems = threadItemSet.getCommentItems();
			}
			threadItems.forEach( function ( threadItem ) {
				if (
					threadItem instanceof CommentItem &&
					threadItem.timestamp >= sinceTimestamp
				) {
					newCommentIds.push( threadItem.id );
				}
			} );
		}
	}

	if ( newCommentIds.length ) {
		var comments = newCommentIds.map( function ( id ) {
			return threadItemSet.findCommentById( id );
		} ).filter( function ( cmt ) {
			return !!cmt;
		} );
		if ( comments.length === 0 ) {
			return;
		}

		highlightedTarget = new Highlight( comments );
		highlightedTarget.$element.addClass( 'ext-discussiontools-init-targetcomment' );
		highlightedTarget.$element.addClass( 'ext-discussiontools-init-highlight-fadein' );

		if ( !noScroll ) {
			highlightedTarget.scrollIntoView();
		}
	} else if ( highlightsRequested ) {
		missingTargetNotifPromise = mw.loader.using( 'mediawiki.notification' ).then( function () {
			return mw.notification.notify(
				mw.message(
					highlightsRequestedSingle ?
						'discussiontools-target-comment-missing' :
						'discussiontools-target-comments-missing'
				).parse(),
				{ type: 'warn', autoHide: false }
			);
		} );
	}
}

/**
 * Clear the highlighting of the comment in the URL hash
 *
 * @param {ThreadItemSet} threadItemSet
 */
function clearHighlightTargetComment( threadItemSet ) {
	if ( missingTargetNotifPromise ) {
		missingTargetNotifPromise.then( function ( notif ) {
			notif.close();
		} );
		missingTargetNotifPromise = null;
	}

	var url = new URL( location.href );
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
		url.hash = '';
		history.replaceState( null, document.title, url );
	} else if (
		url.searchParams.has( 'dtnewcomments' ) ||
		url.searchParams.has( 'dtnewcommentssince' )
	) {
		url.searchParams.delete( 'dtnewcomments' );
		url.searchParams.delete( 'dtnewcommentssince' );
		url.searchParams.delete( 'dtinthread' );
		history.pushState( null, document.title, url );
		highlightTargetComment( threadItemSet );
	}
}

/**
 * Get the last highlighted just-published comment, if any
 *
 * Used to show an auto-subscription popup to first-time users
 *
 * @return {ThreadItem|null}
 */
function getLastHighlightedPublishedComment() {
	return lastHighlightedPublishedComment;
}

module.exports = {
	highlightTargetComment: highlightTargetComment,
	highlightPublishedComment: highlightPublishedComment,
	highlightNewComments: highlightNewComments,
	clearHighlightTargetComment: clearHighlightTargetComment,
	getLastHighlightedPublishedComment: getLastHighlightedPublishedComment
};
