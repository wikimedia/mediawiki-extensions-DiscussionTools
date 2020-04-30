'use strict';

var
	$pageContainer,
	parser = require( './parser.js' ),
	utils = require( './utils.js' ),
	pageDataCache = {};

mw.messages.set( require( './controller/contLangMessages.json' ) );

function autoSignWikitext( wikitext ) {
	var matches;
	wikitext = wikitext.trim();
	if ( ( matches = wikitext.match( /~{3,5}$/ ) ) ) {
		// Sig detected, check it has the correct number of tildes
		if ( matches[ 0 ].length !== 4 ) {
			wikitext = wikitext.slice( 0, -matches[ 0 ].length ) + '~~~~';
		}
		// Otherwise 4 tilde signature is left alone,
		// with any adjacent characters
	} else {
		// No sig, append space and sig
		wikitext += ' ~~~~';
	}
	return wikitext;
}

function sanitizeWikitextLinebreaks( wikitext ) {
	return wikitext
		.replace( /\r/g, '\n' )
		.replace( /\n+/g, '\n' );
}

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
		nativeRange, rect,
		$highlight = $( '<div>' ).addClass( 'dt-init-highlight' );

	nativeRange = utils.getNativeRange( comment );
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
 * TODO: Resolve the naming conflict between this raw "pageData" from the API, and the
 * plain object "pageData" that gets attached to parsoidData.
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
			'visual', pageName, {
				oldId: oldId,
				lint: true
			}
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
 * @param {string} commentId Comment ID
 * @return {jQuery.Promise}
 */
function getParsoidCommentData( pageName, oldId, commentId ) {
	var parsoidPageData, parsoidDoc, parsoidComments, parsoidCommentsById;

	return getPageData( pageName, oldId )
		.then( function ( response ) {
			var data, comment, transcludedFrom, transcludedErrMsg, mwTitle, follow,
				lintErrors, lintLocation, lintType;

			data = response.visualeditor;
			parsoidDoc = ve.parseXhtml( data.content );
			// Remove section wrappers, they interfere with transclusion handling
			mw.libs.ve.unwrapParsoidSections( parsoidDoc.body );
			// Mirror VE's ve.init.mw.Target.prototype.fixBase behavior:
			ve.fixBase( parsoidDoc, document, ve.resolveUrl(
				// Don't replace $1 with the page name, because that'll break if
				// the page name contains a slash
				mw.config.get( 'wgArticlePath' ).replace( '$1', '' ),
				document
			) );
			parsoidComments = parser.getComments( parsoidDoc.body );

			parsoidPageData = {
				pageName: pageName,
				oldId: oldId,
				startTimeStamp: data.starttimestamp,
				etag: data.etag
			};

			// getThreads builds the tree structure, currently only
			// used to set 'replies' and 'id'
			parser.groupThreads( parsoidComments );
			parsoidCommentsById = commentsById( parsoidComments );
			comment = parsoidCommentsById[ commentId ];

			if ( !comment ) {
				return $.Deferred().reject( 'comment-disappeared', { errors: [ {
					code: 'comment-disappeared',
					html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
				} ] } ).promise();
			}

			transcludedFrom = parser.getTranscludedFrom( comment );
			if ( transcludedFrom ) {
				mwTitle = transcludedFrom === true ? null : mw.Title.newFromText( transcludedFrom );
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
						transcludedFrom: transcludedFrom,
						follow: follow
					},
					code: 'comment-is-transcluded',
					html: transcludedErrMsg
				} ] } ).promise();
			}

			if ( response.visualeditor.lint ) {
				// Only lint errors that break editing, namely 'fostered'
				lintErrors = response.visualeditor.lint.filter( function ( item ) {
					return item.type === 'fostered';
				} );

				if ( lintErrors.length ) {
					// This only reports the first error
					lintLocation = lintErrors[ 0 ].dsr.slice( 0, 2 ).join( '-' );
					lintType = lintErrors[ 0 ].type;

					return $.Deferred().reject( 'lint', { errors: [ {
						code: 'lint',
						html: mw.message( 'discussiontools-error-lint',
							'https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Lint_errors/' + lintType,
							'https://www.mediawiki.org/wiki/Special:MyLanguage/Help_talk:Lint_errors/' + lintType,
							mw.util.getUrl( pageName, { action: 'edit', dtlinterror: lintLocation } ) ).parse()
					} ] } ).promise();
				}
			}

			return {
				comment: parsoidCommentsById[ commentId ],
				doc: parsoidDoc,
				pageData: parsoidPageData
			};
		} );
}

function getCheckboxesPromise( pageData ) {
	return getPageData(
		pageData.pageName,
		pageData.oldId
	).then( function ( response ) {
		var data = response.visualeditor,
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
	getCheckboxesPromise: getCheckboxesPromise,
	autoSignWikitext: autoSignWikitext,
	sanitizeWikitextLinebreaks: sanitizeWikitextLinebreaks
};
