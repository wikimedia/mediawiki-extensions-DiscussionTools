'use strict';

var
	parser = require( './parser.js' ),
	modifier = require( './modifier.js' ),
	logger = require( './logger.js' ),
	pageDataCache = {},
	$pageContainer,
	scrollPadding = { top: 10, bottom: 10 },
	config = require( './controller/config.json' ),
	replyWidgetPromise = config.useVisualEditor ?
		mw.loader.using( 'ext.discussionTools.ReplyWidgetVisual' ) :
		mw.loader.using( 'ext.discussionTools.ReplyWidgetPlain' );

mw.messages.set( require( './controller/contLangMessages.json' ) );

function setupComment( comment ) {
	var $replyLinkButtons, $replyLink, parsoidPromise, widgetPromise, newListItem;

	// Is it possible to have a heading nested in a thread?
	if ( comment.type !== 'comment' ) {
		return;
	}

	$replyLinkButtons = $( '<span>' )
		.addClass( 'dt-init-replylink-buttons' );

	// Reply
	$replyLink = $( '<a>' )
		.addClass( 'dt-init-replylink-reply' )
		.text( mw.msg( 'discussiontools-replylink' ) )
		.on( 'click', function () {
			// TODO: Allow users to use multiple reply widgets simultaneously.
			// Currently submitting a reply from one widget would also destroy the other ones.
			// eslint-disable-next-line no-jquery/no-class-state
			if ( $pageContainer.hasClass( 'dt-init-replylink-open' ) ) {
				// Support: IE 11
				// On other browsers, the link is made unclickable using 'pointer-events' in CSS
				return;
			}
			$pageContainer.addClass( 'dt-init-replylink-open' );

			logger( {
				action: 'init',
				type: 'page',
				mechanism: 'click',
				// TODO: when we have actual visual mode, this needs to do better at
				// working out which will be used:
				// eslint-disable-next-line camelcase
				editor_interface: config.useVisualEditor ? 'wikitext-2017' : 'wikitext'
			} );

			$replyLinkButtons.addClass( 'dt-init-replylink-active' );

			function teardown() {
				$replyLinkButtons.removeClass( 'dt-init-replylink-active' );
				$pageContainer.removeClass( 'dt-init-replylink-open' );
				modifier.removeListItem( newListItem );
				newListItem = null;
			}

			if ( !widgetPromise ) {
				// eslint-disable-next-line no-use-before-define
				parsoidPromise = getParsoidTranscludedCommentData( comment.id );

				widgetPromise = parsoidPromise.then( function ( parsoidData ) {
					return replyWidgetPromise.then( function () {
						var
							ReplyWidget = config.useVisualEditor ?
								require( 'ext.discussionTools.ReplyWidgetVisual' ) :
								require( 'ext.discussionTools.ReplyWidgetPlain' ),
							replyWidget = new ReplyWidget( parsoidData );

						replyWidget.on( 'teardown', teardown );

						return replyWidget;
					} );
				}, function ( code, data ) {
					teardown();

					OO.ui.alert(
						( new mw.Api() ).getErrorMessage( data ),
						{ size: 'medium' }
					);

					logger( {
						action: 'abort',
						type: 'preinit'
					} );

					widgetPromise = null;

					return $.Deferred().reject();
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

	$replyLinkButtons.append( $replyLink );
	modifier.addReplyLink( comment, $replyLinkButtons[ 0 ] );
}

function traverseNode( parent ) {
	parent.replies.forEach( function ( comment ) {
		setupComment( comment );
		traverseNode( comment );
	} );
}

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

function postReply( widget, parsoidData ) {
	var wikitext, doc, container, newParsoidItem,
		comment = parsoidData.comment;

	doc = comment.range.endContainer.ownerDocument;
	container = doc.createElement( 'div' );

	if ( widget.getMode() === 'source' ) {
		// Convert wikitext to comment DOM
		wikitext = widget.getValue();
		// Use autoSign to avoid double signing
		wikitext = sanitizeWikitextLinebreaks( autoSignWikitext( wikitext ) );
		wikitext.split( '\n' ).forEach( function ( line ) {
			var p = doc.createElement( 'p' );
			p.appendChild( modifier.createWikitextNode( line ) );
			container.appendChild( p );
		} );
	} else {
		container.innerHTML = widget.getValue();
		// If the last node isn't a paragraph (e.g. it's a list), then
		// add another paragraph to contain the signature.
		if ( container.lastChild.nodeName.toLowerCase() !== 'p' ) {
			container.appendChild( doc.createElement( 'p' ) );
		}
		// Sign the last line
		// TODO: Check if the user tried to sign in visual mode by typing wikitext?
		// TODO: When we implement posting new topics, the leading space will create an indent-pre
		container.lastChild.appendChild( modifier.createWikitextNode( ' ~~~~' ) );
	}

	// Transfer comment DOM to Parsoid DOM
	// Wrap every root node of the document in a new list item (dd/li).
	// In wikitext mode every root node is a paragraph.
	// In visual mode the editor takes care of preventing problematic nodes
	// like <table> or <h2> from ever occuring in the comment.
	while ( container.children.length ) {
		if ( !newParsoidItem ) {
			newParsoidItem = modifier.addListItem( comment );
		} else {
			newParsoidItem = modifier.addSiblingListItem( newParsoidItem );
		}
		newParsoidItem.appendChild( container.firstChild );
	}

	return $.Deferred().resolve().promise();
}

/**
 * Get the latest revision ID of the page.
 *
 * @param {string} pageName
 * @return {jQuery.Promise}
 */
function getLatestRevId( pageName ) {
	return ( new mw.Api() ).get( {
		action: 'query',
		prop: 'revisions',
		rvprop: 'ids',
		rvlimit: 1,
		titles: pageName,
		formatversion: 2
	} ).then( function ( resp ) {
		return resp.query.pages[ 0 ].revisions[ 0 ].revid;
	} );
}

function save( widget, parsoidData ) {
	var root, summaryPrefix, summary, postPromise, savePromise,
		mode = widget.getMode(),
		comment = parsoidData.comment,
		pageData = parsoidData.pageData;

	// Update the Parsoid DOM
	postPromise = postReply( widget, parsoidData );

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

	return $.when( widget.checkboxesPromise, postPromise ).then( function ( checkboxes ) {
		var data = {
			page: pageData.pageName,
			oldid: pageData.oldId,
			summary: summary,
			baserevid: pageData.oldId,
			starttimestamp: pageData.startTimeStamp,
			etag: pageData.etag,
			captchaid: widget.captchaInput && widget.captchaInput.getCaptchaId(),
			captchaword: widget.captchaInput && widget.captchaInput.getCaptchaWord(),
			assert: mw.user.isAnon() ? 'anon' : 'user',
			assertuser: mw.user.getName() || undefined,
			dttags: [
				'discussiontools',
				'discussiontools-reply',
				'discussiontools-' + mode
			].join( ',' )
		};

		if ( checkboxes.checkboxesByName.wpWatchthis ) {
			data.watchlist = checkboxes.checkboxesByName.wpWatchthis.isSelected() ?
				'watch' :
				'unwatch';
		}

		savePromise = mw.libs.ve.targetSaver.saveDoc(
			parsoidData.doc,
			data
		).catch( function ( code, data ) {
			// Handle edit conflicts. Load the latest revision of the page, then try again. If the parent
			// comment has been deleted from the page, or if retry also fails for some other reason, the
			// error is handled as normal below.
			if ( code === 'editconflict' ) {
				return getLatestRevId( pageData.pageName ).then( function ( latestRevId ) {
					// eslint-disable-next-line no-use-before-define
					return getParsoidCommentData( pageData.pageName, latestRevId, comment.id ).then( function ( parsoidData ) {
						return save( widget, parsoidData );
					} );
				} );
			}
			return $.Deferred().reject( code, data ).promise();
		} );
		savePromise.then( function () {
			var watch;
			// Update watch link to match 'watch checkbox' in save dialog.
			// User logged in if module loaded.
			if ( mw.loader.getState( 'mediawiki.page.watch.ajax' ) === 'ready' ) {
				watch = require( 'mediawiki.page.watch.ajax' );
				watch.updateWatchLink(
					// eslint-disable-next-line no-jquery/no-global-selector
					$( '#ca-watch a, #ca-unwatch a' ),
					data.watchlist === 'watch' ? 'unwatch' : 'watch'
				);
			}
		} );
		return savePromise;
	} );
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
 * @param {string} commentId Comment ID
 * @return {jQuery.Promise}
 */
function getParsoidCommentData( pageName, oldId, commentId ) {
	var parsoidPageData, parsoidDoc, parsoidComments, parsoidCommentsById;

	return getPageData( pageName, oldId )
		.then( function ( response ) {
			var data, comment, transcludedFrom, transcludedErrMsg, mwTitle, follow;

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
					transcludedErrMsg = mw.message( 'discussiontools-error-comment-is-transcluded-title',
						mwTitle.getPrefixedText() ).parse();
				} else {
					transcludedErrMsg = mw.message( 'discussiontools-error-comment-is-transcluded' ).parse();
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

			return {
				comment: parsoidCommentsById[ commentId ],
				doc: parsoidDoc,
				pageData: parsoidPageData
			};
		} );
}

/**
 * Like #getParsoidCommentData, but assumes the comment was found on the current page,
 * and then follows transclusions to determine the source page where it is written.
 *
 * @param {string} commentId Comment ID, from a comment parsed in the local document
 * @return {jQuery.Promise}
 */
function getParsoidTranscludedCommentData( commentId ) {
	var promise,
		pageName = mw.config.get( 'wgRelevantPageName' ),
		oldId = mw.config.get( 'wgCurRevisionId' );

	function followTransclusion( recursionLimit, code, data ) {
		var errorData;
		if ( recursionLimit > 0 && code === 'comment-is-transcluded' ) {
			errorData = data.errors[ 0 ].data;
			if ( errorData.follow && typeof errorData.transcludedFrom === 'string' ) {
				return getLatestRevId( errorData.transcludedFrom ).then( function ( latestRevId ) {
					// Fetch the transcluded page, until we cross the recursion limit
					return getParsoidCommentData( errorData.transcludedFrom, latestRevId, commentId )
						.catch( followTransclusion.bind( null, recursionLimit - 1 ) );
				} );
			}
		}
		return $.Deferred().reject( code, data );
	}

	// Arbitrary limit of 10 steps, which should be more than anyone could ever need
	// (there are reasonable use cases for at least 2)
	promise = getParsoidCommentData( pageName, oldId, commentId )
		.catch( followTransclusion.bind( null, 10 ) );

	return promise;
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
	save: save,
	autoSignWikitext: autoSignWikitext,
	sanitizeWikitextLinebreaks: sanitizeWikitextLinebreaks
};
