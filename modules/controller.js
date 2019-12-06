'use strict';

var $pageContainer, pageComments, pageThreads,
	scrollPadding = { top: 10, bottom: 10 },
	replyWidgetPromise = mw.loader.using( 'ext.discussionTools.ReplyWidget' );

function getReplyIndex( comment ) {
	var commentIndex = pageComments.indexOf( comment );

	function countReplies( c ) {
		var count = c.replies.length;
		c.replies.forEach( function ( r ) {
			count += countReplies( r );
		} );
		return count;
	}

	return commentIndex + countReplies( comment ) + 1;
}

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
			var $link = $( this ),
				userCommentsBeforeReply = pageComments.slice( 0, getReplyIndex( comment ) )
					.filter( function ( c ) {
						return c.author === mw.user.getName();
					} ).length;

			$link.addClass( 'dt-init-replylink-active' );
			// TODO: Allow users to use multiple reply widgets simlutaneously
			// Currently as all widgets share the same Parsoid doc, this could
			// cause problems.
			$pageContainer.addClass( 'dt-init-replylink-open' );

			if ( !widgetPromise ) {
				newList = mw.dt.modifier.addListAtComment( comment );
				newListItem = mw.dt.modifier.addListItem( newList );
				$( newListItem ).text( mw.msg( 'discussiontools-replywidget-loading' ) );
				widgetPromise = replyWidgetPromise.then( function () {
					var replyWidget = new mw.dt.ui.ReplyWidget(
						comment, userCommentsBeforeReply
						// For VE version:
						// { defaultMode: 'source' }
					);

					replyWidget.on( 'cancel', function () {
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

function postReply( widget, parsoidData ) {
	var root, summary,
		comment = parsoidData.comment,
		pageData = parsoidData.pageData,
		newParsoidList = mw.dt.modifier.addListAtComment( comment );

	widget.textWidget.getValue().split( '\n' ).forEach( function ( line, i, arr ) {
		var lineItem = mw.dt.modifier.addListItem( newParsoidList );
		if ( i === arr.length - 1 && line.trim().slice( -4 ) !== '~~~~' ) {
			line += ' ~~~~';
		}
		lineItem.appendChild( mw.dt.modifier.createWikitextNode( line ) );
	} );

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
				oldId: pageData.oldId,
				summary: summary,
				baseTimeStamp: pageData.baseTimeStamp,
				startTimeStamp: pageData.startTimeStamp,
				etag: pageData.etag,
				token: pageData.token
			}
		);
	} );
}

function highlight( comment ) {
	var padding = 5,
		containerRect = RangeFix.getBoundingClientRect( $pageContainer[ 0 ] ),
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

	$pageContainer.prepend( $highlight );
}

function init( $container, state ) {
	var parsoidPromise, parsoidComments, parsoidDoc,
		parsoidPageData = {
			pageName: mw.config.get( 'wgRelevantPageName' ),
			oldId: mw.config.get( 'wgRevisionId' ),
			token: mw.user.tokens.get( 'csrfToken' )
		};

	state = state || {};
	$pageContainer = $container;
	pageComments = mw.dt.parser.getComments( $pageContainer[ 0 ] );
	pageThreads = mw.dt.parser.groupThreads( pageComments );
	pageThreads.forEach( traverseNode );

	$pageContainer.addClass( 'dt-init-done' );
	$pageContainer.removeClass( 'dt-init-replylink-open' );

	// For debugging
	mw.dt.pageThreads = pageThreads;

	if ( state.userCommentsBeforeReply ) {
		highlight(
			pageComments.filter( function ( comment ) {
				// TODO: Find anon comments?
				return comment.author === mw.user.getName();
			} )[ state.userCommentsBeforeReply ]
		);
		state.userCommentsBeforeReply = null;
	}

	parsoidPromise = mw.loader.using( 'ext.visualEditor.targetLoader' ).then( function () {
		return mw.libs.ve.targetLoader.requestPageData(
			'visual', parsoidPageData.pageName, { oldId: parsoidPageData.oldId }
		).then( function ( response ) {
			var data = response.visualeditor;
			// TODO: error handling
			parsoidDoc = ve.createDocumentFromHtml( data.content );
			parsoidComments = mw.dt.parser.getComments( parsoidDoc.body );

			parsoidPageData.baseTimeStamp = data.basetimestamp;
			parsoidPageData.startTimeStamp = data.startimestamp;
			parsoidPageData.etag = data.etag;

			// getThreads build the tree structure, currently only
			// used to set 'replies'
			mw.dt.parser.groupThreads( parsoidComments );
		} );
	} );

	// Map PHP comments to Parsoid comments.
	// TODO: Handle when these don't align
	pageComments.forEach( function ( comment, i ) {
		comment.parsoidPromise = parsoidPromise.then( function () {
			return {
				comment: parsoidComments[ i ],
				doc: parsoidDoc,
				pageData: parsoidPageData
			};
		} );
	} );
}

module.exports = {
	init: init,
	postReply: postReply
};
