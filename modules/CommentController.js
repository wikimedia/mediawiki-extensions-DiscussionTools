var
	controller = require( './controller.js' ),
	modifier = require( './modifier.js' ),
	logger = require( './logger.js' ),
	storage = mw.storage.session,
	scrollPadding = { top: 10, bottom: 10 },
	config = require( './controller/config.json' ),
	// TODO: Remember last editor used
	useVisual = config.useVisualEditor;

// Start loading reply widget code
if ( useVisual ) {
	mw.loader.using( 'ext.discussionTools.ReplyWidgetVisual' );
} else {
	mw.loader.using( 'ext.discussionTools.ReplyWidgetPlain' );
}

function CommentController( $pageContainer, comment ) {
	this.$pageContainer = $pageContainer;
	this.comment = comment;
	this.newListItem = null;
	this.replyWidgetPromise = null;

	this.$replyLinkButtons = $( '<span>' )
		.addClass( 'dt-init-replylink-buttons' );

	// Reply
	this.$replyLink = $( '<a>' )
		.addClass( 'dt-init-replylink-reply' )
		.text( mw.msg( 'discussiontools-replylink' ) )
		.attr( {
			role: 'button',
			tabindex: '0'
		} )
		.on( 'click keypress', this.onReplyLinkClick.bind( this ) );

	this.$replyLinkButtons.append( this.$replyLink );
	modifier.addReplyLink( comment, this.$replyLinkButtons[ 0 ] );

	if ( storage.get( 'reply/' + comment.id + '/body' ) ) {
		this.setup();
	}
}

OO.initClass( CommentController );

/* CommentController private utilites */

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
					return controller.getParsoidCommentData( errorData.transcludedFrom, latestRevId, commentId )
						.catch( followTransclusion.bind( null, recursionLimit - 1 ) );
				} );
			}
		}
		return $.Deferred().reject( code, data );
	}

	// Arbitrary limit of 10 steps, which should be more than anyone could ever need
	// (there are reasonable use cases for at least 2)
	promise = controller.getParsoidCommentData( pageName, oldId, commentId )
		.catch( followTransclusion.bind( null, 10 ) );

	return promise;
}

/* Methods */

CommentController.prototype.onReplyLinkClick = function ( e ) {
	if ( e.type === 'keypress' && e.which !== OO.ui.Keys.ENTER && e.which !== OO.ui.Keys.SPACE ) {
		// Only handle keypresses on the "Enter" or "Space" keys
		return;
	}
	e.preventDefault();
	this.setup();
};

CommentController.prototype.setup = function () {
	var parsoidPromise,
		commentController = this;

	// TODO: Allow users to use multiple reply widgets simultaneously.
	// Currently submitting a reply from one widget would also destroy the other ones.
	// eslint-disable-next-line no-jquery/no-class-state
	if ( this.$pageContainer.hasClass( 'dt-init-replylink-open' ) ) {
		// Support: IE 11
		// On other browsers, the link is made unclickable using 'pointer-events' in CSS
		return;
	}
	this.$pageContainer.addClass( 'dt-init-replylink-open' );
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '.dt-init-replylink-reply' ).attr( {
		tabindex: '-1'
	} );

	logger( {
		action: 'init',
		type: 'page',
		mechanism: 'click',
		// TODO: when we have actual visual mode, this needs to do better at
		// working out which will be used:
		// eslint-disable-next-line camelcase
		editor_interface: useVisual ? 'wikitext-2017' : 'wikitext'
	} );

	this.$replyLinkButtons.addClass( 'dt-init-replylink-active' );

	if ( !this.replyWidgetPromise ) {
		parsoidPromise = getParsoidTranscludedCommentData( this.comment.id );

		this.replyWidgetPromise = parsoidPromise.then( function ( parsoidData ) {
			return commentController.createReplyWidget( parsoidData );
		}, function ( code, data ) {
			commentController.teardown();

			OO.ui.alert(
				( new mw.Api() ).getErrorMessage( data ),
				{ size: 'medium' }
			);

			logger( {
				action: 'abort',
				type: 'preinit'
			} );

			commentController.replyWidgetPromise = null;

			return $.Deferred().reject();
		} );

		// On first load, add a placeholder list item
		commentController.newListItem = modifier.addListItem( commentController.comment );
		$( commentController.newListItem ).text( mw.msg( 'discussiontools-replywidget-loading' ) );
	}

	commentController.replyWidgetPromise.then( this.setupReplyWidget.bind( this ) );
};

CommentController.prototype.getReplyWidgetClass = function ( visual ) {
	var moduleName;

	if ( visual === undefined ) {
		visual = useVisual;
	}

	moduleName = visual ? 'ext.discussionTools.ReplyWidgetVisual' : 'ext.discussionTools.ReplyWidgetPlain';
	return mw.loader.using( moduleName ).then( function () {
		return require( moduleName );
	} );
};

CommentController.prototype.createReplyWidget = function ( parsoidData, visual ) {
	var commentController = this;

	return this.getReplyWidgetClass( visual ).then( function ( ReplyWidget ) {
		commentController.replyWidget = new ReplyWidget( commentController, parsoidData );
		commentController.replyWidget.connect( commentController, { teardown: 'teardown' } );
	} );
};

CommentController.prototype.setupReplyWidget = function () {
	if ( !this.newListItem ) {
		// On subsequent loads, there's no list item yet, so create one now
		this.newListItem = modifier.addListItem( this.comment );
	}
	$( this.newListItem ).empty().append( this.replyWidget.$element );
	this.replyWidget.setup();
	this.replyWidget.scrollElementIntoView( { padding: scrollPadding } );
	this.replyWidget.focus();

	logger( { action: 'ready' } );
	logger( { action: 'loaded' } );
};

CommentController.prototype.teardown = function () {
	this.$replyLinkButtons.removeClass( 'dt-init-replylink-active' );
	this.$pageContainer.removeClass( 'dt-init-replylink-open' );
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '.dt-init-replylink-reply' ).attr( {
		tabindex: '0'
	} );
	modifier.removeListItem( this.newListItem );
	this.newListItem = null;
	this.$replyLink.trigger( 'focus' );
};

CommentController.prototype.postReply = function ( parsoidData ) {
	var wikitext, doc, container, newParsoidItem,
		comment = parsoidData.comment;

	doc = comment.range.endContainer.ownerDocument;
	container = doc.createElement( 'div' );

	if ( this.replyWidget.getMode() === 'source' ) {
		// Convert wikitext to comment DOM
		wikitext = this.replyWidget.getValue();
		// Use autoSign to avoid double signing
		wikitext = controller.sanitizeWikitextLinebreaks( controller.autoSignWikitext( wikitext ) );
		wikitext.split( '\n' ).forEach( function ( line ) {
			var p = doc.createElement( 'p' );
			p.appendChild( modifier.createWikitextNode( line ) );
			container.appendChild( p );
		} );
	} else {
		container.innerHTML = this.replyWidget.getValue();
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
};

CommentController.prototype.save = function ( parsoidData ) {
	var root, summaryPrefix, summary, postPromise, savePromise,
		mode = this.replyWidget.getMode(),
		comment = parsoidData.comment,
		pageData = parsoidData.pageData,
		commentController = this;

	// Update the Parsoid DOM
	postPromise = this.postReply( parsoidData );

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

	return $.when( this.replyWidget.checkboxesPromise, postPromise ).then( function ( checkboxes ) {
		var captchaInput = commentController.replyWidget.captchaInput,
			data = {
				page: pageData.pageName,
				oldid: pageData.oldId,
				summary: summary,
				baserevid: pageData.oldId,
				starttimestamp: pageData.startTimeStamp,
				etag: pageData.etag,
				assert: mw.user.isAnon() ? 'anon' : 'user',
				assertuser: mw.user.getName() || undefined,
				dttags: [
					'discussiontools',
					'discussiontools-reply',
					'discussiontools-' + mode
				].join( ',' )
			};

		if ( captchaInput ) {
			data.captchaid = captchaInput.getCaptchaId();
			data.captchaword = captchaInput.getCaptchaWord();
		}

		if ( checkboxes.checkboxesByName.wpWatchthis ) {
			data.watchlist = checkboxes.checkboxesByName.wpWatchthis.isSelected() ?
				'watch' :
				'unwatch';
		}

		savePromise = mw.libs.ve.targetSaver.saveDoc(
			parsoidData.doc,
			data,
			{
				// No timeout. Huge talk pages take a long time to save, and falsely reporting an error can
				// result in duplicate messages when the user retries. (T249071)
				api: new mw.Api( { ajax: { timeout: 0 } } )
			}
		).catch( function ( code, data ) {
			// Handle edit conflicts. Load the latest revision of the page, then try again. If the parent
			// comment has been deleted from the page, or if retry also fails for some other reason, the
			// error is handled as normal below.
			if ( code === 'editconflict' ) {
				return getLatestRevId( pageData.pageName ).then( function ( latestRevId ) {
					return controller.getParsoidCommentData( pageData.pageName, latestRevId, comment.id ).then( function ( parsoidData ) {
						return commentController.save( parsoidData );
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
};

module.exports = CommentController;
