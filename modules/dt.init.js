var pageComments, pageThreads, parsoidPromise, parsoidComments, parsoidDoc,
	replyWidgetPromise = mw.loader.using( 'ext.discussionTools.ReplyWidget' ),
	// eslint-disable-next-line no-jquery/no-global-selector
	$pageContainer = $( '#mw-content-text' );

/**
 * @class mw.discussionTools
 * @singleton
 */
mw.dt = {
	init: {},
	ui: {},
	parser: require( 'ext.discussionTools.parser' ),
	modifier: require( 'ext.discussionTools.modifier' )
};

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

			$link.hide();
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
						parsoidDoc,
						{
							// TODO: Remove placeholder
							doc: '<p>Reply to ' + comment.author + '</p>',
							defaultMode: 'source'
						}
					);

					replyWidget.on( 'cancel', function () {
						$link.show();
						$pageContainer.removeClass( 'dt-init-replylink-open' );
						$( newListItem ).hide();
					} );

					$( newListItem ).empty().append( replyWidget.$element );
					return replyWidget;
				}, function () {
					$link.show();
					$pageContainer.removeClass( 'dt-init-replylink-open' );
				} );
			}

			widgetPromise.then( function ( replyWidget ) {
				$( newListItem ).show();
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

if ( new mw.Uri().query.dtdebug ) {
	mw.loader.load( 'ext.discussionTools.debug' );
} else {
	pageComments = mw.dt.parser.getComments( $pageContainer[ 0 ] );
	pageThreads = mw.dt.parser.groupThreads( pageComments );
	pageThreads.forEach( traverseNode );

	// For debugging
	mw.dt.pageThreads = pageThreads;

	parsoidPromise = mw.loader.using( [
		'ext.visualEditor.targetLoader',
		// TODO: We are loading ext.visualEditor.base just for ve.createDocumentFromHTML
		'ext.visualEditor.base',
		// TODO: Loading mw.Target class for save testing
		'ext.visualEditor.mediawiki'
	] ).then( function () {
		return mw.libs.ve.targetLoader.requestPageData(
			'visual', mw.config.get( 'wgRelevantPageName' ), {
				oldId: mw.config.get( 'wgRevisionId' )
			}
		).then( function ( response ) {
			var data = response.visualeditor;
			// TODO: error handling
			parsoidDoc = ve.createDocumentFromHtml( data.content );
			parsoidComments = mw.dt.parser.getComments( parsoidDoc.body );

			// getThreads build the tree structure, currently only
			// used to set 'replies'
			mw.dt.parser.groupThreads( parsoidComments );
		} );
	} );

	// Map PHP comments to Parsoid comments.
	// TODO: Handle when these don't align
	pageComments.forEach( function ( comment, i ) {
		comment.parsoidCommentPromise = parsoidPromise.then( function () {
			return parsoidComments[ i ];
		} );
	} );
}
