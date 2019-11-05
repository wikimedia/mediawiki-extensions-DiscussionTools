var pageComments, pageThreads, parsoidPromise, parsoidComments, parsoidDoc,
	widgetPromise = mw.loader.using( 'oojs-ui-core' );

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
		$( '<a>' ).text( 'Reply' ).on( 'click', function () {
			var newList, newListItem,
				$link = $( this );

			$link.hide();

			newList = mw.dt.modifier.addListAtComment( comment );
			newListItem = mw.dt.modifier.addListItem( newList );
			$( newListItem ).text( 'Loading...' );

			widgetPromise.then( function () {
				var replyWidget = new OO.ui.MultilineTextInputWidget( {
						value: 'Reply to ' + comment.author
					} ),
					replyButton = new OO.ui.ButtonWidget( {
						flags: [ 'primary', 'progressive' ],
						label: 'Reply'
					} );

				replyButton.on( 'click', function () {
					comment.parsoidCommentPromise.then( function ( parsoidComment ) {
						var html,
							newParsoidList = mw.dt.modifier.addListAtComment( parsoidComment );

						replyWidget.getValue().split( '\n' ).forEach( function ( line, i, arr ) {
							var lineItem = mw.dt.modifier.addListItem( newParsoidList );
							if ( i === arr.length - 1 && line.trim().slice( -4 ) !== '~~~~' ) {
								line += ' ~~~~';
							}
							lineItem.appendChild( mw.dt.modifier.createWikitextNode( line ) );
						} );

						// TODO: We need an ArticleTargetSaver that is separate from
						// Target logic.
						html = ve.init.mw.Target.prototype.getHtml(
							parsoidComment.range.endContainer.ownerDocument
						);
						// eslint-disable-next-line
						console.log( html );
					} );
				} );

				$( newListItem ).empty().append(
					replyWidget.$element, replyButton.$element
				);
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
			// TODO: error handling
			parsoidDoc = ve.createDocumentFromHtml( response.visualeditor.content );
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
