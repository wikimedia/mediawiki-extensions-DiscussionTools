'use strict';

var
	parser = require( 'ext.discussionTools.parser' ),
	modifier = require( 'ext.discussionTools.modifier' ),
	$pageContainer,
	scrollPadding = { top: 10, bottom: 10 },
	config = require( './config.json' ),
	replyWidgetPromise = config.useVisualEditor ?
		mw.loader.using( 'ext.discussionTools.ReplyWidgetVisual' ) :
		mw.loader.using( 'ext.discussionTools.ReplyWidgetPlain' );

function setupComment( comment ) {
	var $replyLink, widgetPromise, newList, newListItem,
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

			$link.addClass( 'dt-init-replylink-active' );
			// TODO: Allow users to use multiple reply widgets simlutaneously
			// Currently as all widgets share the same Parsoid doc, this could
			// cause problems.
			$pageContainer.addClass( 'dt-init-replylink-open' );

			if ( !widgetPromise ) {
				newList = modifier.addListAtComment( comment );
				newListItem = modifier.addListItem( newList );
				$( newListItem ).text( mw.msg( 'discussiontools-replywidget-loading' ) );
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
						$( newListItem ).hide();
					} );

					$( newListItem ).empty().append( replyWidget.$element );
					return replyWidget;
				}, function () {
					$link.removeClass( 'dt-init-replylink-active' );
					$pageContainer.removeClass( 'dt-init-replylink-open' );
				} );
			}
			widgetPromise.then( function ( replyWidget ) {
				$( newListItem ).show();
				replyWidget.setup();
				replyWidget.scrollElementIntoView( { padding: scrollPadding } );
				replyWidget.focus();
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
	var root, summary,
		comment = parsoidData.comment,
		pageData = parsoidData.pageData,
		newParsoidList = modifier.addListAtComment( comment );

	widget.insertNewNodes( newParsoidList );

	root = comment;
	while ( root && root.type !== 'heading' ) {
		root = root.parent;
	}

	summary = '/* ' + root.range.toString() + ' */ ' + mw.msg( 'discussiontools-defaultsummary-reply' );

	return mw.libs.ve.targetSaver.deflateDoc( parsoidData.doc ).then( function ( html ) {
		return mw.libs.ve.targetSaver.postHtml(
			html,
			null,
			{
				page: pageData.pageName,
				oldid: pageData.oldId,
				summary: summary,
				basetimestamp: pageData.baseTimeStamp,
				starttimestamp: pageData.startTimeStamp,
				etag: pageData.etag,
				token: pageData.token
			}
		);
	} );
}

function highlight( comment ) {
	var padding = 5,
		// $container must be position:relative/absolute
		$container = OO.ui.getDefaultOverlay(),
		containerRect = $container[ 0 ].getBoundingClientRect(),
		rect = RangeFix.getBoundingClientRect( comment.range ),
		$highlight = $( '<div>' ).addClass( 'dt-init-highlight' );

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

function init( $container, state ) {
	var
		parsoidPromise, parsoidDoc,
		parsoidComments, parsoidCommentsById,
		pageComments, pageThreads, pageCommentsById,
		repliedToComment,
		parsoidPageData = {
			pageName: mw.config.get( 'wgRelevantPageName' ),
			oldId: mw.config.get( 'wgRevisionId' ),
			token: mw.user.tokens.get( 'csrfToken' )
		};

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

	parsoidPromise = mw.loader.using( 'ext.visualEditor.targetLoader' ).then( function () {
		return mw.libs.ve.targetLoader.requestPageData(
			'visual', parsoidPageData.pageName, { oldId: parsoidPageData.oldId }
		).then( function ( response ) {
			var data = response.visualeditor;
			// TODO: error handling
			parsoidDoc = ve.createDocumentFromHtml( data.content );
			parsoidComments = parser.getComments( parsoidDoc.body );

			parsoidPageData.baseTimeStamp = data.basetimestamp;
			parsoidPageData.startTimeStamp = data.starttimestamp;
			parsoidPageData.etag = data.etag;

			// getThreads build the tree structure, currently only
			// used to set 'replies'
			parser.groupThreads( parsoidComments );
			parsoidCommentsById = commentsById( parsoidComments );
		} );
	} );

	// Map PHP comments to Parsoid comments.
	pageComments.forEach( function ( comment ) {
		comment.parsoidPromise = parsoidPromise.then( function () {
			if ( !parsoidCommentsById[ comment.id ] ) {
				throw new Error( 'Could not find comment in Parsoid HTML' );
			}
			return {
				comment: parsoidCommentsById[ comment.id ],
				doc: parsoidDoc,
				pageData: parsoidPageData
			};
		} );
	} );
}

module.exports = {
	init: init,
	postReply: postReply,
	autoSignWikitext: autoSignWikitext
};
