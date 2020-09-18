var
	api = new mw.Api( { parameters: { formatversion: 2 } } ),
	controller = require( './controller.js' ),
	modifier = require( './modifier.js' ),
	logger = require( './logger.js' ),
	storage = mw.storage.session,
	scrollPadding = { top: 10, bottom: 10 },
	defaultEditMode = mw.user.options.get( 'discussiontools-editmode' ) || mw.config.get( 'wgDiscussionToolsFallbackEditMode' ),
	defaultVisual = defaultEditMode === 'visual',
	conf = mw.config.get( 'wgVisualEditorConfig' ),
	visualModules = [ 'ext.discussionTools.ReplyWidgetVisual' ]
		.concat( conf.pluginModules.filter( mw.loader.getState ) ),
	plainModules = [ 'ext.discussionTools.ReplyWidgetPlain' ];

// Start loading reply widget code
if ( defaultVisual ) {
	mw.loader.using( visualModules );
} else {
	mw.loader.using( plainModules );
}

function CommentController( $pageContainer, comment ) {
	var mode;

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

	this.$replyLinkButtons.append(
		$( '<span>' ).addClass( 'dt-init-replylink-bracket' ).text( '[' ),
		this.$replyLink,
		$( '<span>' ).addClass( 'dt-init-replylink-bracket' ).text( ']' )
	);
	modifier.addReplyLink( comment, this.$replyLinkButtons[ 0 ] );

	if ( storage.get( 'reply/' + comment.id + '/saveable' ) ) {
		mode = storage.get( 'reply/' + comment.id + '/mode' );
		this.setup( mode );
	}
}

OO.initClass( CommentController );

/* CommentController private utilities */

/**
 * Get the latest revision ID of the page.
 *
 * @param {string} pageName
 * @return {jQuery.Promise}
 */
function getLatestRevId( pageName ) {
	return api.get( {
		action: 'query',
		prop: 'revisions',
		rvprop: 'ids',
		rvlimit: 1,
		titles: pageName
	} ).then( function ( resp ) {
		return resp.query.pages[ 0 ].revisions[ 0 ].revid;
	} );
}

/**
 * Like #checkCommentOnPage, but assumes the comment was found on the current page,
 * and then follows transclusions to determine the source page where it is written.
 *
 * @param {string} commentId Comment ID
 * @return {jQuery.Promise} Promise which resolves with pageName+oldId, or rejects with an error
 */
function getTranscludedFromSource( commentId ) {
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
					return controller.checkCommentOnPage( errorData.transcludedFrom, latestRevId, commentId )
						.catch( followTransclusion.bind( null, recursionLimit - 1 ) );
				} );
			}
		}
		return $.Deferred().reject( code, data );
	}

	// Arbitrary limit of 10 steps, which should be more than anyone could ever need
	// (there are reasonable use cases for at least 2)
	promise = controller.checkCommentOnPage( pageName, oldId, commentId )
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

/**
 * Create and setup the reply widget
 *
 * @param {string} [mode] Optionally force a mode, 'visual' or 'source'
 */
CommentController.prototype.setup = function ( mode ) {
	var comment = this.comment,
		commentController = this;

	if ( mode === undefined ) {
		mode = mw.user.options.get( 'discussiontools-editmode' ) ||
			( defaultVisual ? 'visual' : 'source' );
	}

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
	// Suppress page takeover behavior for VE editing so that our unload
	// handler can warn of data loss.
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '#ca-edit, #ca-ve-edit, .mw-editsection a, #ca-addsection' ).off( '.ve-target' );

	logger( {
		action: 'init',
		type: 'page',
		mechanism: 'click',
		// TODO: Use 'wikitext-2017' when config.enable2017Wikitext is set
		// eslint-disable-next-line camelcase
		editor_interface: mode === 'visual' ? 'visualeditor' : 'wikitext'
	} );

	this.$replyLinkButtons.addClass( 'dt-init-replylink-active' );

	if ( !this.replyWidgetPromise ) {
		this.replyWidgetPromise = getTranscludedFromSource( comment.id ).then( function ( pageData ) {
			return commentController.createReplyWidget( comment, pageData.pageName, pageData.oldId, {}, mode === 'visual' );
		}, function ( code, data ) {
			commentController.teardown();

			OO.ui.alert(
				code instanceof Error ? code.toString() : api.getErrorMessage( data ),
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
		commentController.newListItem = modifier.addListItem( comment );
		$( commentController.newListItem ).text( mw.msg( 'discussiontools-replywidget-loading' ) );
	}

	commentController.replyWidgetPromise.then( function ( replyWidget ) {
		if ( !commentController.newListItem ) {
			// On subsequent loads, there's no list item yet, so create one now
			commentController.newListItem = modifier.addListItem( comment );
		}
		$( commentController.newListItem ).empty().append( replyWidget.$element );

		commentController.setupReplyWidget( replyWidget, null, true );

		logger( { action: 'ready' } );
		logger( { action: 'loaded' } );
	} );
};

CommentController.prototype.getReplyWidgetClass = function ( visual ) {
	if ( visual === undefined ) {
		visual = defaultVisual;
	}

	return mw.loader.using( visual ? visualModules : plainModules ).then( function () {
		return require( visual ? 'ext.discussionTools.ReplyWidgetVisual' : 'ext.discussionTools.ReplyWidgetPlain' );
	} );
};

CommentController.prototype.createReplyWidget = function ( comment, pageName, oldId, config, visual ) {
	var commentController = this;

	return this.getReplyWidgetClass( visual ).then( function ( ReplyWidget ) {
		return new ReplyWidget( commentController, comment, pageName, oldId, config );
	} );
};

CommentController.prototype.setupReplyWidget = function ( replyWidget, initialValue, scrollIntoView ) {
	replyWidget.connect( this, { teardown: 'teardown' } );

	replyWidget.setup( initialValue );
	if ( scrollIntoView ) {
		replyWidget.scrollElementIntoView( { padding: scrollPadding } );
	}
	replyWidget.focus();

	this.replyWidget = replyWidget;
};

CommentController.prototype.teardown = function ( abandoned ) {
	this.$replyLinkButtons.removeClass( 'dt-init-replylink-active' );
	this.$pageContainer.removeClass( 'dt-init-replylink-open' );
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '.dt-init-replylink-reply' ).attr( {
		tabindex: '0'
	} );
	// We deliberately mangled edit links earlier so VE can't steal our page;
	// have it redo setup to fix those.
	if ( mw.libs.ve && mw.libs.ve.setupEditLinks ) {
		mw.libs.ve.setupEditLinks();
	}
	modifier.removeAddedListItem( this.newListItem );
	this.newListItem = null;
	if ( abandoned ) {
		this.$replyLink.trigger( 'focus' );
	}
};

CommentController.prototype.save = function ( comment, pageName ) {
	var replyWidget = this.replyWidget,
		commentController = this;

	return this.replyWidget.checkboxesPromise.then( function ( checkboxes ) {
		var captchaInput = commentController.replyWidget.captchaInput,
			data = {
				action: 'discussiontoolsedit',
				paction: 'addcomment',
				page: pageName,
				commentid: comment.id,
				summary: replyWidget.getEditSummary(),
				assert: mw.user.isAnon() ? 'anon' : 'user',
				assertuser: mw.user.getName() || undefined,
				dttags: [
					'discussiontools',
					'discussiontools-reply',
					'discussiontools-' + replyWidget.getMode()
				].join( ',' )
			};

		if ( replyWidget.getMode() === 'source' ) {
			data.wikitext = replyWidget.getValue();
		} else {
			data.html = replyWidget.getValue();
		}

		if ( captchaInput ) {
			data.captchaid = captchaInput.getCaptchaId();
			data.captchaword = captchaInput.getCaptchaWord();
		}

		if ( checkboxes.checkboxesByName.wpWatchthis ) {
			data.watchlist = checkboxes.checkboxesByName.wpWatchthis.isSelected() ?
				'watch' :
				'unwatch';
		}

		return mw.libs.ve.targetSaver.postContent(
			data,
			{
				// No timeout. Huge talk pages take a long time to save, and falsely reporting an error can
				// result in duplicate messages when the user retries. (T249071)
				api: new mw.Api( { ajax: { timeout: 0 }, parameters: { formatversion: 2 } } )
			}
		).catch( function ( code, responseData ) {
			// Better user-facing error messages
			if ( code === 'editconflict' ) {
				return $.Deferred().reject( 'editconflict', { errors: [ {
					code: 'editconflict',
					html: mw.message( 'discussiontools-error-comment-conflict' ).parse()
				} ] } ).promise();
			}
			if ( code === 'discussiontools-commentid-notfound' ) {
				return $.Deferred().reject( 'discussiontools-commentid-notfound', { errors: [ {
					code: 'discussiontools-commentid-notfound',
					html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
				} ] } ).promise();
			}
			return $.Deferred().reject( code, responseData ).promise();
		} ).then( function ( responseData ) {
			controller.update( responseData, comment, pageName, replyWidget );
		} );
	} );
};

CommentController.prototype.switchToWikitext = function () {
	var wikitextPromise,
		oldWidget = this.replyWidget,
		target = oldWidget.replyBodyWidget.target,
		previewDeferred = $.Deferred(),
		commentController = this;

	// TODO: We may need to pass oldid/etag when editing is supported
	wikitextPromise = target.getWikitextFragment( target.getSurface().getModel().getDocument() );
	this.replyWidgetPromise = this.createReplyWidget(
		oldWidget.comment,
		oldWidget.pageName,
		oldWidget.oldId,
		{
			showAdvanced: oldWidget.showAdvanced,
			editSummary: oldWidget.getEditSummary()
		},
		false
	);

	return $.when( wikitextPromise, this.replyWidgetPromise ).then( function ( wikitext, replyWidget ) {
		wikitext = modifier.sanitizeWikitextLinebreaks( wikitext );

		// To prevent the "Reply" / "Cancel" buttons from shifting when the preview loads,
		// wait for the preview (but no longer than 500 ms) before swithing the editors.
		replyWidget.preparePreview( wikitext ).then( previewDeferred.resolve );
		setTimeout( previewDeferred.resolve, 500 );

		return previewDeferred.then( function () {
			// Swap out the DOM nodes
			oldWidget.$element.replaceWith( replyWidget.$element );

			// Teardown the old widget
			oldWidget.disconnect( commentController );
			oldWidget.teardown();

			commentController.setupReplyWidget( replyWidget, wikitext );
		} );
	} );
};

CommentController.prototype.switchToVisual = function () {
	var parsePromise,
		oldWidget = this.replyWidget,
		wikitext = oldWidget.getValue(),
		commentController = this;

	wikitext = modifier.sanitizeWikitextLinebreaks( wikitext );

	// Replace wikitext signatures with a special marker recognized by DtDmMWSignatureNode
	// to render them as signature nodes in visual mode.
	wikitext = wikitext.replace(
		// Replace ~~~~ (four tildes), but not ~~~~~ (five tildes)
		/([^~]|^)~~~~([^~]|$)/g,
		'$1<span data-dtsignatureforswitching="1"></span>$2'
	);

	if ( wikitext ) {
		wikitext = wikitext.split( '\n' ).map( function ( line ) {
			return ':' + line;
		} ).join( '\n' );

		// Based on ve.init.mw.Target#parseWikitextFragment
		parsePromise = api.post( {
			action: 'visualeditor',
			paction: 'parsefragment',
			page: oldWidget.pageName,
			wikitext: wikitext,
			pst: true
		} ).then( function ( response ) {
			return response && response.visualeditor.content;
		} );
	} else {
		parsePromise = $.Deferred().resolve( '' ).promise();
	}
	this.replyWidgetPromise = this.createReplyWidget(
		oldWidget.comment,
		oldWidget.pageName,
		oldWidget.oldId,
		{
			showAdvanced: oldWidget.showAdvanced,
			editSummary: oldWidget.getEditSummary()
		},
		true
	);

	return $.when( parsePromise, this.replyWidgetPromise ).then( function ( html, replyWidget ) {
		var doc, bodyChildren, type, $msg,
			unsupportedSelectors = {
				// Tables are almost always multi-line
				table: 'table',
				// Headings are converted to plain text before we can detect them:
				// `:==h2==` -> `<p>==h2==</p>`
				// heading: 'h1, h2, h3, h4, h5, h6',
				// Templates can be multiline
				template: '[typeof*="mw:Transclusion"]',
				// Extensions (includes references) can be multiline, could be supported later (T251633)
				extension: '[typeof*="mw:Extension"]'
				// Images are probably fine unless a multi-line caption was used (rare)
				// image: 'figure, figure-inline'
			};

		if ( html ) {
			doc = replyWidget.replyBodyWidget.target.parseDocument( html );
			// Remove RESTBase IDs (T253584)
			mw.libs.ve.stripRestbaseIds( doc );
			for ( type in unsupportedSelectors ) {
				if ( doc.querySelector( unsupportedSelectors[ type ] ) ) {
					$msg = $( '<div>' ).html(
						mw.message(
							'discussiontools-error-noswitchtove',
							// The following messages are used here:
							// * discussiontools-error-noswitchtove-extension
							// * discussiontools-error-noswitchtove-table
							// * discussiontools-error-noswitchtove-template
							mw.msg( 'discussiontools-error-noswitchtove-' + type )
						).parse()
					);
					$msg.find( 'a' ).attr( {
						target: '_blank',
						rel: 'noopener'
					} );
					OO.ui.alert(
						$msg.contents(),
						{
							title: mw.msg( 'discussiontools-error-noswitchtove-title' ),
							size: 'medium'
						}
					);
					mw.track( 'dt.schemaVisualEditorFeatureUse', {
						feature: 'editor-switch',
						action: 'dialog-prevent-show'
					} );

					return $.Deferred().reject().promise();
				}
			}
			// Check for tables, headings, images, templates
			bodyChildren = Array.prototype.slice.call( doc.body.childNodes );
			// There may be multiple lists when some lines are template generated
			bodyChildren.forEach( function ( child ) {
				if ( child.nodeType === Node.ELEMENT_NODE ) {
					// Unwrap list
					modifier.unwrapList( child );
				}
			} );
		}

		// Swap out the DOM nodes
		oldWidget.$element.replaceWith( replyWidget.$element );

		// Teardown the old widget
		oldWidget.disconnect( commentController );
		oldWidget.teardown();

		commentController.setupReplyWidget( replyWidget, doc );
	} );
};

module.exports = CommentController;
