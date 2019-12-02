'use strict';

var $pageContainer,
	scrollPadding = { top: 10, bottom: 10 },
	replyWidgetPromise = mw.loader.using( 'ext.discussionTools.ReplyWidget' );

function setupComment( comment ) {
	var $replyLink, widgetPromise, newList, newListItem,
		$tsNode = $( comment.range.endContainer );

	// Is it possible to have a heading nested in a thread?
	if ( comment.type !== 'comment' ) {
		return;
	}

	$replyLink = $( '<a>' )
		.addClass( 'dt-init-replylink' )
		// TODO: i18n
		.text( 'Reply' )
		.on( 'click', function () {
			var $link = $( this );

			$link.addClass( 'dt-init-replylink-active' );
			// TODO: Allow users to use multiple reply widgets simlutaneously
			// Currently as all widgets share the same Parsoid doc, this could
			// cause problems.
			$pageContainer.addClass( 'dt-init-replylink-open' );

			if ( !widgetPromise ) {
				newList = mw.dt.modifier.addListAtComment( comment );
				newListItem = mw.dt.modifier.addListItem( newList );
				// TODO: i18n
				$( newListItem ).text( 'Loading...' );
				widgetPromise = replyWidgetPromise.then( function () {
					var replyWidget = new mw.dt.ui.ReplyWidget(
						comment,
						{
							// TODO: Remove placeholder
							doc: '<p>Reply to ' + comment.author + '</p>',
							defaultMode: 'source'
						}
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

	// TODO: i18n
	summary = '/* ' + root.range.toString() + ' */ Reply';

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

function init( $container ) {
	var pageComments, pageThreads, parsoidPromise, parsoidComments, parsoidDoc,
		parsoidPageData = {
			pageName: mw.config.get( 'wgRelevantPageName' ),
			oldId: mw.config.get( 'wgRevisionId' ),
			token: mw.user.tokens.get( 'csrfToken' )
		};

	$pageContainer = $container;
	pageComments = mw.dt.parser.getComments( $pageContainer[ 0 ] );
	pageThreads = mw.dt.parser.groupThreads( pageComments );
	pageThreads.forEach( traverseNode );

	// For debugging
	mw.dt.pageThreads = pageThreads;

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
