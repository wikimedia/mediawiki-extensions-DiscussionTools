'use strict';

var
	api = new mw.Api( { parameters: { formatversion: 2 } } ),
	$pageContainer,
	Parser = require( './Parser.js' ),
	pageDataCache = {};

mw.messages.set( require( './controller/contLangMessages.json' ) );

function traverseNode( parent ) {
	// Loads later to avoid circular dependency
	var CommentController = require( './CommentController.js' );
	parent.replies.forEach( function ( comment ) {
		if ( comment.type === 'comment' ) {
			// eslint-disable-next-line no-new
			new CommentController( $pageContainer, comment );
		}
		traverseNode( comment );
	} );
}

function highlight( comment ) {
	var padding = 5,
		// $container must be position:relative/absolute
		$container = OO.ui.getDefaultOverlay(),
		containerRect = $container[ 0 ].getBoundingClientRect(),
		rect = RangeFix.getBoundingClientRect( comment.getNativeRange() ),
		$highlight = $( '<div>' ).addClass( 'dt-init-highlight' );

	$highlight.css( {
		top: rect.top - containerRect.top - padding,
		left: rect.left - containerRect.left - padding,
		width: rect.width + ( padding * 2 ),
		height: rect.height + ( padding * 2 )
	} );
	$container.prepend( $highlight );

	OO.ui.Element.static.scrollIntoView( $highlight[ 0 ], { padding: { top: 10, bottom: 10 } } ).then( function () {
		setTimeout( function () {
			$highlight.addClass( 'dt-init-highlight-fade' );
			setTimeout( function () {
				$highlight.remove();
			}, 500 );
		}, 500 );
	} );
}

/**
 * Get various pieces of page metadata.
 *
 * This method caches responses. If you call it again with the same parameters, you'll get the exact
 * same Promise object, and no API request will be made.
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @return {jQuery.Promise}
 */
function getPageData( pageName, oldId ) {
	var lintPromise, transcludedFromPromise, veMetadataPromise;
	pageDataCache[ pageName ] = pageDataCache[ pageName ] || {};
	if ( pageDataCache[ pageName ][ oldId ] ) {
		return pageDataCache[ pageName ][ oldId ];
	}

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
		return OO.getProp( response, 'discussiontools' ) || [];
	} );

	veMetadataPromise = api.get( {
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
		} );
	return pageDataCache[ pageName ][ oldId ];
}

/**
 * Check if a given comment on a page can be replied to
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @param {string} commentId Comment ID
 * @return {jQuery.Promise} Resolves with the pageName+oldId if the comment appears on the page.
 *  Rejects with error data if the comment is transcluded, or there are lint errors on the page.
 */
function checkCommentOnPage( pageName, oldId, commentId ) {
	return getPageData( pageName, oldId )
		.then( function ( response ) {
			var isTranscludedFrom, transcludedErrMsg, mwTitle, follow,
				lintType,
				lintErrors = response.linterrors,
				transcludedFrom = response.transcludedfrom;

			// We no longer check if the comment exists on the page, is this an issue?
			// if ( !comment ) {
			//  return $.Deferred().reject( 'comment-disappeared', { errors: [ {
			//   code: 'comment-disappeared',
			//   html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
			//  } ] } ).promise();
			// }

			isTranscludedFrom = transcludedFrom[ commentId ];
			if ( isTranscludedFrom ) {
				mwTitle = isTranscludedFrom === true ? null : mw.Title.newFromText( isTranscludedFrom );
				// If this refers to a template rather than a subpage, we never want to edit it
				follow = mwTitle && mwTitle.getNamespaceId() !== mw.config.get( 'wgNamespaceIds' ).template;

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
				lintType = lintErrors[ 0 ].category;

				return $.Deferred().reject( 'lint', { errors: [ {
					code: 'lint',
					html: mw.message( 'discussiontools-error-lint',
						'https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Lint_errors/' + lintType,
						'https://www.mediawiki.org/wiki/Special:MyLanguage/Help_talk:Lint_errors/' + lintType,
						mw.util.getUrl( pageName, { action: 'edit', lintid: lintErrors[ 0 ].lintId } ) ).parse()
				} ] } ).promise();
			}

			return {
				pageName: pageName,
				oldId: oldId
			};
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
		}
		// targetLoader was loaded by getPageData
		return mw.libs.ve.targetLoader.createCheckboxFields( checkboxesDef );
		// TODO: createCheckboxField doesn't make links in the label open in a new
		// window as that method currently lives in ve.utils
	} );
}

function init( $container, state ) {
	var parser,
		pageThreads,
		repliedToComment;

	$pageContainer = $container;
	parser = new Parser( $pageContainer[ 0 ] );
	pageThreads = parser.getThreads();

	$pageContainer.removeClass( 'dt-init-replylink-open' );

	pageThreads.forEach( traverseNode );

	// For debugging
	mw.dt.pageThreads = pageThreads;

	if ( state.repliedTo ) {
		// Find the comment we replied to, then highlight the last reply
		repliedToComment = parser.findCommentById( state.repliedTo );
		highlight( repliedToComment.replies[ repliedToComment.replies.length - 1 ] );
	}

	// Preload page metadata.
	// TODO: Isn't this too early to load it? We will only need it if the user tries replying...
	getPageData(
		mw.config.get( 'wgRelevantPageName' ),
		mw.config.get( 'wgCurRevisionId' )
	);
}

module.exports = {
	init: init,
	checkCommentOnPage: checkCommentOnPage,
	getCheckboxesPromise: getCheckboxesPromise
};
