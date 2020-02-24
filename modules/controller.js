'use strict';

var
	parser = require( 'ext.discussionTools.parser' ),
	modifier = require( 'ext.discussionTools.modifier' ),
	logger = require( 'ext.discussionTools.logger' ),
	pageDataCache = {},
	$pageContainer,
	scrollPadding = { top: 10, bottom: 10 },
	config = require( './config.json' ),
	replyWidgetPromise = config.useVisualEditor ?
		mw.loader.using( 'ext.discussionTools.ReplyWidgetVisual' ) :
		mw.loader.using( 'ext.discussionTools.ReplyWidgetPlain' );

function setupComment( comment ) {
	var $replyLink, widgetPromise, newListItem,
		$tsNode = $( comment.range.endContainer );

	// Is it possible to have a heading nested in a thread?
	if ( comment.type !== 'comment' ) {
		return;
	}

	$replyLink = $( '<a>' )
		.addClass( 'dt-init-replylink' )
		.text( mw.msg( 'discussiontools-replylink' ) )
		.on( 'click', function () {
			var $link = $( this );

			logger( {
				action: 'init',
				type: 'page',
				mechanism: 'click',
				// TODO: when we have actual visual mode, this needs to do better at
				// working out which will be used:
				// eslint-disable-next-line camelcase
				editor_interface: config.useVisualEditor ? 'wikitext-2017' : 'wikitext'
			} );

			$link.addClass( 'dt-init-replylink-active' );
			// TODO: Allow users to use multiple reply widgets simlutaneously
			// Currently as all widgets share the same Parsoid doc, this could
			// cause problems.
			$pageContainer.addClass( 'dt-init-replylink-open' );

			if ( !widgetPromise ) {
				widgetPromise = replyWidgetPromise.then( function () {
					var
						ReplyWidget = config.useVisualEditor ?
							require( 'ext.discussionTools.ReplyWidgetVisual' ) :
							require( 'ext.discussionTools.ReplyWidgetPlain' ),
						replyWidget = new ReplyWidget(
							comment
						);

					replyWidget.on( 'teardown', function () {
						$link.removeClass( 'dt-init-replylink-active' );
						$pageContainer.removeClass( 'dt-init-replylink-open' );
						modifier.removeListItem( newListItem );
						newListItem = null;
					} );

					return replyWidget;
				}, function () {
					$link.removeClass( 'dt-init-replylink-active' );
					$pageContainer.removeClass( 'dt-init-replylink-open' );

					logger( {
						action: 'abort',
						type: 'preinit'
					} );
				} );

				// On first load, add a placeholder list item
				newListItem = modifier.addListItem( comment );
				$( newListItem ).text( mw.msg( 'discussiontools-replywidget-loading' ) );
			}

			widgetPromise.then( function ( replyWidget ) {
				if ( !newListItem ) {
					// On subsequent loads, there's no list item yet, so create one now
					newListItem = modifier.addListItem( comment );
				}
				$( newListItem ).empty().append( replyWidget.$element );
				replyWidget.setup();
				replyWidget.scrollElementIntoView( { padding: scrollPadding } );
				replyWidget.focus();

				logger( { action: 'ready' } );
				logger( { action: 'loaded' } );
			} );
		} );

	$tsNode.after( $replyLink );
}

function traverseNode( parent ) {
	parent.replies.forEach( function ( comment ) {
		setupComment( comment );
		traverseNode( comment );
	} );
}

function autoSignWikitext( wikitext ) {
	wikitext = wikitext.trim();
	if ( wikitext.slice( -4 ) !== '~~~~' ) {
		wikitext += ' ~~~~';
	}
	return wikitext;
}

function postReply( widget, parsoidData ) {
	var root, summaryPrefix, summary,
		comment = parsoidData.comment,
		pageData = parsoidData.pageData,
		newParsoidItem = modifier.addListItem( comment );

	widget.insertNewNodes( newParsoidItem );

	root = comment;
	while ( root && root.type !== 'heading' ) {
		root = root.parent;
	}
	if ( root.placeholderHeading ) {
		// This comment is in 0th section, there's no section title for the edit summary
		summaryPrefix = '';
	} else {
		summaryPrefix = '/* ' + root.range.startContainer.innerText + ' */ ';
	}

	summary = summaryPrefix + mw.msg( 'discussiontools-defaultsummary-reply' );

	return mw.libs.ve.targetSaver.saveDoc(
		parsoidData.doc,
		{
			page: pageData.pageName,
			oldid: pageData.oldId,
			summary: summary,
			basetimestamp: pageData.baseTimeStamp,
			starttimestamp: pageData.startTimeStamp,
			etag: pageData.etag,
			assert: mw.user.isAnon() ? 'anon' : 'user',
			assertuser: mw.user.getName() || undefined,
			// This appears redundant currently, but as editing / new-topics get added, we'll expand it
			dttags: [ 'discussiontools', 'discussiontools-reply', 'discussiontools-' + widget.mode ].join( ',' )
		}
	);
}

function highlight( comment ) {
	var padding = 5,
		// $container must be position:relative/absolute
		$container = OO.ui.getDefaultOverlay(),
		containerRect = $container[ 0 ].getBoundingClientRect(),
		nativeRange, rect,
		$highlight = $( '<div>' ).addClass( 'dt-init-highlight' );

	nativeRange = document.createRange();
	nativeRange.setStart( comment.range.startContainer, comment.range.startOffset );
	nativeRange.setEnd( comment.range.endContainer, comment.range.endOffset );
	rect = RangeFix.getBoundingClientRect( nativeRange );

	$highlight.css( {
		top: rect.top - containerRect.top - padding,
		left: rect.left - containerRect.left - padding,
		width: rect.width + ( padding * 2 ),
		height: rect.height + ( padding * 2 )
	} );

	setTimeout( function () {
		$highlight.addClass( 'dt-init-highlight-fade' );
		setTimeout( function () {
			$highlight.remove();
		}, 500 );
	}, 500 );

	$container.prepend( $highlight );
}

function commentsById( comments ) {
	var byId = {};
	comments.forEach( function ( comment ) {
		byId[ comment.id ] = comment;
	} );
	return byId;
}

/**
 * Get the Parsoid document HTML and metadata needed to edit this page from the API.
 *
 * This method caches responses. If you call it again with the same parameters, you'll get the exact
 * same Promise object, and no API request will be made.
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @return {jQuery.Promise}
 */
function getPageData( pageName, oldId ) {
	pageDataCache[ pageName ] = pageDataCache[ pageName ] || {};
	if ( pageDataCache[ pageName ][ oldId ] ) {
		return pageDataCache[ pageName ][ oldId ];
	}
	pageDataCache[ pageName ][ oldId ] = mw.loader.using( 'ext.visualEditor.targetLoader' ).then( function () {
		return mw.libs.ve.targetLoader.requestPageData(
			'visual', pageName, { oldId: oldId }
		);
	}, function () {
		// Clear on failure
		pageDataCache[ pageName ][ oldId ] = null;
	} );
	return pageDataCache[ pageName ][ oldId ];
}

/**
 * Get the Parsoid document DOM, parse comments and threads, and find a specific comment in it.
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @param {string} commentId Comment ID, from a comment parsed in the local document
 * @return {jQuery.Promise}
 */
function getParsoidCommentData( pageName, oldId, commentId ) {
	var parsoidPageData, parsoidDoc, parsoidComments, parsoidCommentsById;

	return getPageData( pageName, oldId )
		.then( function ( response ) {
			var data = response.visualeditor;
			// TODO: error handling
			parsoidDoc = ve.createDocumentFromHtml( data.content );
			parsoidComments = parser.getComments( parsoidDoc.body );

			parsoidPageData = {
				pageName: pageName,
				oldId: oldId
			};
			parsoidPageData.baseTimeStamp = data.basetimestamp;
			parsoidPageData.startTimeStamp = data.starttimestamp;
			parsoidPageData.etag = data.etag;

			// getThreads build the tree structure, currently only
			// used to set 'replies'
			parser.groupThreads( parsoidComments );
			parsoidCommentsById = commentsById( parsoidComments );

			if ( !parsoidCommentsById[ commentId ] ) {
				return $.Deferred().reject( 'comment-disappeared', { errors: [ {
					code: 'comment-disappeared',
					html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
				} ] } ).promise();
			}

			return {
				comment: parsoidCommentsById[ commentId ],
				doc: parsoidDoc,
				pageData: parsoidPageData
			};
		} );
}

function init( $container, state ) {
	var
		pageComments, pageThreads, pageCommentsById,
		repliedToComment;

	state = state || {};
	$pageContainer = $container;
	pageComments = parser.getComments( $pageContainer[ 0 ] );
	pageThreads = parser.groupThreads( pageComments );
	pageCommentsById = commentsById( pageComments );

	pageThreads.forEach( traverseNode );

	$pageContainer.addClass( 'dt-init-done' );
	$pageContainer.removeClass( 'dt-init-replylink-open' );

	// For debugging
	mw.dt.pageThreads = pageThreads;

	if ( state.repliedTo ) {
		// Find the comment we replied to, then highlight the last reply
		repliedToComment = pageCommentsById[ state.repliedTo ];
		highlight( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );
	}

	// Preload the Parsoid document.
	// TODO: Isn't this too early to load it? We will only need it if the user tries replying...
	getPageData(
		mw.config.get( 'wgRelevantPageName' ),
		mw.config.get( 'wgCurRevisionId' )
	);
}

module.exports = {
	init: init,
	getParsoidCommentData: getParsoidCommentData,
	postReply: postReply,
	autoSignWikitext: autoSignWikitext
};
