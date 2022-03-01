var
	CommentItem = require( './CommentItem.js' ),
	utils = require( './utils.js' );

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

var $highlightedTarget = null;
var missingTargetNotifPromise = null;
/**
 * Highlight the comment(s) on the page associated with the URL hash or query string
 *
 * @param {ThreadItemSet} threadItemSet
 * @param {boolean} [noScroll] Don't scroll to the topmost highlighted comment, e.g. on popstate
 */
function highlightTargetComment( threadItemSet, noScroll ) {
	// Delay with setTimeout() because "the Document's target element" (corresponding to the :target
	// selector in CSS) is not yet updated to match the URL when handling a 'popstate' event.
	setTimeout( function () {
		if ( $highlightedTarget ) {
			$highlightedTarget.remove();
			$highlightedTarget = null;
		}
		if ( missingTargetNotifPromise ) {
			missingTargetNotifPromise.then( function ( notif ) {
				notif.close();
			} );
			missingTargetNotifPromise = null;
		}
		// eslint-disable-next-line no-jquery/no-global-selector
		var targetElement = $( ':target' )[ 0 ];

		if ( targetElement && targetElement.hasAttribute( 'data-mw-comment-start' ) ) {
			var comment = threadItemSet.findCommentById( targetElement.getAttribute( 'id' ) );
			$highlightedTarget = highlight( comment );
			$highlightedTarget.addClass( 'ext-discussiontools-init-targetcomment' );
			$highlightedTarget.addClass( 'ext-discussiontools-init-highlight-fadein' );
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

		var uri;
		try {
			uri = new mw.Uri( location.href );
		} catch ( err ) {
			// T106244: URL encoded values using fallback 8-bit encoding (invalid UTF-8) cause mediawiki.Uri to crash
			return;
		}
		highlightNewComments(
			threadItemSet,
			noScroll,
			uri.query.dtnewcomments && uri.query.dtnewcomments.split( '|' ),
			uri.query.dtnewcommentssince,
			uri.query.dtinthread
		);
	} );
}

/**
 * Highlight a just-published comment/topic
 *
 * @param {ThreadItemSet} threadItemSet Thread item set
 * @param {string} threadItemId Thread item ID (NEW_TOPIC_COMMENT_ID for the a new topic)
 * @return {ThreadItem} Highlighted thread item
 */
function highlightPublishedComment( threadItemSet, threadItemId ) {
	var $highlight, highlightedThreadItem;
	if ( threadItemId === utils.NEW_TOPIC_COMMENT_ID ) {
		// Highlight the last comment on the page
		var lastComment = threadItemSet.threadItems[ threadItemSet.threadItems.length - 1 ];
		$highlight = highlight( lastComment );
		highlightedThreadItem = lastComment;

		// If it's the only comment under its heading, highlight the heading too.
		// (It might not be if the new discussion topic was posted without a title: T272666.)
		if (
			lastComment.parent &&
			lastComment.parent.type === 'heading' &&
			lastComment.parent.replies.length === 1
		) {
			$highlight = $highlight.add( highlight( lastComment.parent ) );
			highlightedThreadItem = lastComment.parent;
		}
	} else {
		// Find the comment we replied to, then highlight the last reply
		var repliedToComment = threadItemSet.threadItemsById[ threadItemId ];
		$highlight = highlight( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );
		highlightedThreadItem = repliedToComment.replies[ repliedToComment.replies.length - 1 ];
	}

	$highlight.addClass( 'ext-discussiontools-init-publishedcomment' );

	// Show a highlight with the same timing as the post-edit message (mediawiki.action.view.postEdit):
	// show for 3000ms, fade out for 250ms (animation duration is defined in CSS).
	OO.ui.Element.static.scrollIntoView(
		$highlight[ 0 ],
		{
			padding: {
				// Add padding to avoid overlapping the post-edit notification (above on desktop, below on mobile)
				top: OO.ui.isMobile() ? 10 : 60,
				bottom: OO.ui.isMobile() ? 85 : 10
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

	return highlightedThreadItem;
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

		var highlights = comments.map( function ( cmt ) {
			return highlight( cmt )[ 0 ];
		} );
		$highlightedTarget = $( highlights );
		$highlightedTarget.addClass( 'ext-discussiontools-init-targetcomment' );
		$highlightedTarget.addClass( 'ext-discussiontools-init-highlight-fadein' );

		if ( !noScroll ) {
			var topmostComment = 0;
			for ( var i = 1; i < comments.length; i++ ) {
				if ( highlights[ i ].getBoundingClientRect().top < highlights[ topmostComment ].getBoundingClientRect().top ) {
					topmostComment = i;
				}
			}
			document.getElementById( comments[ topmostComment ].id ).scrollIntoView();
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

	var uri;
	try {
		uri = new mw.Uri( location.href );
	} catch ( err ) {
		// T106244: URL encoded values using fallback 8-bit encoding (invalid UTF-8) cause mediawiki.Uri to crash
		return;
	}
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
		uri.fragment = undefined;
		history.replaceState( null, document.title, uri );
	} else if (
		'dtnewcomments' in uri.query ||
		'dtnewcommentssince' in uri.query
	) {
		delete uri.query.dtnewcomments;
		delete uri.query.dtnewcommentssince;
		delete uri.query.dtinthread;
		history.pushState( null, document.title, uri );
		highlightTargetComment( threadItemSet );
	}
}

module.exports = {
	highlight: highlight,
	highlightTargetComment: highlightTargetComment,
	highlightPublishedComment: highlightPublishedComment,
	clearHighlightTargetComment: clearHighlightTargetComment
};
