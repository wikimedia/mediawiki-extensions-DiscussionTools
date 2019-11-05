var pageComments, pageThreads, parsoidPromise, parsoidComments, parsoidDoc,
	replyWidgetPromise = mw.loader.using( 'ext.discussionTools.ReplyWidget' );

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
	var $tsNode = $( comment.range.endContainer );

	// Is it possible to have a heading nested in a thread?
	if ( comment.type !== 'comment' ) {
		return;
	}

	$tsNode.after(
		' ',
		// TODO: i18n
		$( '<a>' ).text( 'Reply' ).on( 'click', function () {
			var newList, newListItem,
				$link = $( this );

			$link.hide();

			newList = mw.dt.modifier.addListAtComment( comment );
			newListItem = mw.dt.modifier.addListItem( newList );
			// TODO: i18n
			$( newListItem ).text( 'Loading...' );

			replyWidgetPromise.then( function () {
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
					replyWidget.$element.hide();
				} );

				$( newListItem ).empty().append( replyWidget.$element );
				replyWidget.focus();
			} );
		} )
	);
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
	pageComments = mw.dt.parser.getComments( document.getElementById( 'mw-content-text' ) );
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
