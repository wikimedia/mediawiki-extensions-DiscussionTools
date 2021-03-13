/**
 * @external ThreadItem
 */

var
	controller = require( './controller.js' ),
	modifier = require( './modifier.js' ),
	logger = require( './logger.js' ),
	storage = mw.storage.session,
	scrollPadding = { top: 10, bottom: 10 },
	dtConf = require( './config.json' ),
	defaultEditMode = mw.user.options.get( 'discussiontools-editmode' ) || mw.config.get( 'wgDiscussionToolsFallbackEditMode' ),
	defaultVisual = defaultEditMode === 'visual',
	enable2017Wikitext = dtConf.enable2017Wikitext,
	conf = mw.config.get( 'wgVisualEditorConfig' ),
	visualModules = [ 'ext.discussionTools.ReplyWidgetVisual' ]
		.concat( conf.pluginModules.filter( mw.loader.getState ) ),
	plainModules = [ 'ext.discussionTools.ReplyWidgetPlain' ];

// Start loading reply widget code
if ( defaultVisual || enable2017Wikitext ) {
	mw.loader.using( visualModules );
} else {
	mw.loader.using( plainModules );
}

function CommentController( $pageContainer, $replyLink, comment ) {
	var mode;

	// Mixin constructors
	OO.EventEmitter.call( this );

	this.$pageContainer = $pageContainer;
	this.comment = comment;
	this.newListItem = null;
	this.replyWidgetPromise = null;
	this.onReplyLinkClickHandler = this.onReplyLinkClick.bind( this );

	// Reply
	this.$replyLink = $replyLink.on( 'click keypress', this.onReplyLinkClickHandler );
	this.$replyLinkButtons = $replyLink.closest( '.ext-discussiontools-init-replylink-buttons' );

	if ( storage.get( 'reply/' + comment.id + '/saveable' ) ) {
		mode = storage.get( 'reply/' + comment.id + '/mode' );
		this.setup( mode, true );
	}
}

OO.initClass( CommentController );
OO.mixinClass( CommentController, OO.EventEmitter );

/* CommentController private utilities */

/**
 * Get the latest revision ID of the page.
 *
 * @param {string} pageName
 * @return {jQuery.Promise}
 */
function getLatestRevId( pageName ) {
	return controller.getApi().get( {
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
CommentController.prototype.getTranscludedFromSource = function ( commentId ) {
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
};

/* Static properties */

CommentController.static.initType = 'page';

/* Methods */

CommentController.prototype.onReplyLinkClick = function ( e ) {
	if ( e.type === 'keypress' && e.which !== OO.ui.Keys.ENTER && e.which !== OO.ui.Keys.SPACE ) {
		// Only handle keypresses on the "Enter" or "Space" keys
		return;
	}
	if ( e.type === 'click' && ( e.which !== OO.ui.MouseButtons.LEFT || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey ) ) {
		// Only handle unmodified left clicks
		return;
	}

	e.preventDefault();

	this.emit( 'link-click' );
};

/**
 * Create and setup the reply widget
 *
 * @param {string} [mode] Optionally force a mode, 'visual' or 'source'
 * @param {boolean} [hideErrors]
 */
CommentController.prototype.setup = function ( mode, hideErrors ) {
	var comment = this.comment,
		commentController = this;

	if ( mode === undefined ) {
		mode = mw.user.options.get( 'discussiontools-editmode' ) ||
			( defaultVisual ? 'visual' : 'source' );
	}

	this.$pageContainer.addClass( 'ext-discussiontools-init-replylink-open' );
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '.ext-discussiontools-init-replylink-reply' ).attr( {
		tabindex: '-1'
	} );
	// Suppress page takeover behavior for VE editing so that our unload
	// handler can warn of data loss.
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '#ca-edit, #ca-ve-edit, .mw-editsection a, #ca-addsection' ).off( '.ve-target' );

	logger( {
		action: 'init',
		type: this.constructor.static.initType || 'page',
		mechanism: 'click',
		// eslint-disable-next-line camelcase
		editor_interface: mode === 'visual' ? 'visualeditor' :
			( enable2017Wikitext ? 'wikitext-2017' : 'wikitext' )
	} );

	this.$replyLinkButtons.addClass( 'ext-discussiontools-init-replylink-active' );

	if ( !this.replyWidgetPromise ) {
		this.replyWidgetPromise = this.getTranscludedFromSource( comment.id ).then( function ( pageData ) {
			return commentController.createReplyWidget( comment, pageData.pageName, pageData.oldId, { mode: mode } );
		}, function ( code, data ) {
			commentController.teardown();

			if ( !hideErrors ) {
				OO.ui.alert(
					code instanceof Error ? code.toString() : controller.getApi().getErrorMessage( data ),
					{ size: 'medium' }
				);
			}

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

		commentController.setupReplyWidget( replyWidget );

		commentController.showAndFocus();

		logger( { action: 'ready' } );
		logger( { action: 'loaded' } );
	} );
};

CommentController.prototype.getReplyWidgetClass = function ( visual ) {
	// If 2017WTE mode is enabled, always use ReplyWidgetVisual.
	visual = visual || enable2017Wikitext;

	return mw.loader.using( visual ? visualModules : plainModules ).then( function () {
		return require( visual ? 'ext.discussionTools.ReplyWidgetVisual' : 'ext.discussionTools.ReplyWidgetPlain' );
	} );
};

CommentController.prototype.createReplyWidget = function ( comment, pageName, oldId, config ) {
	var commentController = this;
	return this.getReplyWidgetClass( config.mode === 'visual' ).then( function ( ReplyWidget ) {
		return new ReplyWidget( commentController, comment, pageName, oldId, config );
	} );
};

CommentController.prototype.setupReplyWidget = function ( replyWidget, data ) {
	replyWidget.connect( this, { teardown: 'teardown' } );

	replyWidget.setup( data );

	this.replyWidget = replyWidget;
};

/**
 * Focus the first input field inside the controller.
 */
CommentController.prototype.focus = function () {
	this.replyWidget.focus();
};

CommentController.prototype.showAndFocus = function () {
	this.replyWidget.scrollElementIntoView( { padding: scrollPadding } );
	this.focus();
};

CommentController.prototype.teardown = function ( abandoned ) {
	this.$replyLinkButtons.removeClass( 'ext-discussiontools-init-replylink-active' );
	this.$pageContainer.removeClass( 'ext-discussiontools-init-replylink-open' );
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '.ext-discussiontools-init-replylink-reply' ).attr( {
		tabindex: '0'
	} );
	// We deliberately mangled edit links earlier so VE can't steal our page;
	// have it redo setup to fix those.
	if ( mw.libs.ve && mw.libs.ve.setupEditLinks ) {
		mw.libs.ve.setupEditLinks();
		// Disable VisualEditor's new section editor (in wikitext mode / NWE), to allow our own
		// eslint-disable-next-line no-jquery/no-global-selector
		$( '#ca-addsection' ).off( '.ve-target' );
	}
	modifier.removeAddedListItem( this.newListItem );
	this.newListItem = null;
	if ( abandoned ) {
		this.$replyLink.trigger( 'focus' );
	}
	this.emit( 'teardown' );
};

/**
 * Get the parameters of the API query that can be used to post this comment.
 *
 * @param {ThreadItem} comment Parent comment
 * @param {string} pageName Title of the page to post on
 * @param {Object} checkboxes Value of the promise returned by controller#getCheckboxesPromise
 * @return {Object}
 */
CommentController.prototype.getApiQuery = function ( comment, pageName, checkboxes ) {
	var captchaInput, replyWidget, data;

	replyWidget = this.replyWidget;

	data = {
		action: 'discussiontoolsedit',
		paction: 'addcomment',
		page: pageName,
		commentid: comment.id,
		summary: replyWidget.getEditSummary(),
		assert: mw.user.isAnon() ? 'anon' : 'user',
		assertuser: mw.user.getName() || undefined,
		uselang: mw.config.get( 'wgUserLanguage' ),
		// HACK: Always display reply links afterwards, ignoring preferences etc., in case this was
		// a page view with reply links forced with ?dtenable=1 or otherwise
		dtenable: '1',
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

	captchaInput = replyWidget.captchaInput;
	if ( captchaInput ) {
		data.captchaid = captchaInput.getCaptchaId();
		data.captchaword = captchaInput.getCaptchaWord();
	}

	if ( checkboxes.checkboxesByName.wpWatchthis ) {
		data.watchlist = checkboxes.checkboxesByName.wpWatchthis.isSelected() ?
			'watch' :
			'unwatch';
	}

	return data;
};

CommentController.prototype.save = function ( comment, pageName ) {
	var replyWidget = this.replyWidget,
		commentController = this;

	return this.replyWidget.checkboxesPromise.then( function ( checkboxes ) {
		var defaults, noTimeoutApi,
			data = commentController.getApiQuery( comment, pageName, checkboxes );

		// No timeout. Huge talk pages can take a long time to save, and falsely reporting an error
		// could result in duplicate messages if the user retries. (T249071)
		defaults = OO.copy( controller.getApi().defaults );
		defaults.timeout = 0;
		noTimeoutApi = new mw.Api( defaults );

		return mw.libs.ve.targetSaver.postContent(
			data, { api: noTimeoutApi }
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
		oldShowAdvanced = oldWidget.showAdvanced,
		oldEditSummary = oldWidget.getEditSummary(),
		previewDeferred = $.Deferred(),
		commentController = this;

	// TODO: We may need to pass oldid/etag when editing is supported
	wikitextPromise = target.getWikitextFragment( target.getSurface().getModel().getDocument() );
	this.replyWidgetPromise = this.createReplyWidget(
		oldWidget.comment,
		oldWidget.pageName,
		oldWidget.oldId,
		{ mode: 'source' }
	);

	return $.when( wikitextPromise, this.replyWidgetPromise ).then( function ( wikitext, replyWidget ) {
		// To prevent the "Reply" / "Cancel" buttons from shifting when the preview loads,
		// wait for the preview (but no longer than 500 ms) before swithing the editors.
		replyWidget.preparePreview( wikitext ).then( previewDeferred.resolve );
		setTimeout( previewDeferred.resolve, 500 );

		return previewDeferred.then( function () {
			// Teardown the old widget
			oldWidget.disconnect( commentController );
			oldWidget.teardown();

			// Swap out the DOM nodes
			oldWidget.$element.replaceWith( replyWidget.$element );

			commentController.setupReplyWidget( replyWidget, {
				value: wikitext,
				showAdvanced: oldShowAdvanced,
				editSummary: oldEditSummary
			} );

			// Focus the editor
			replyWidget.focus();
		} );
	} );
};

/**
 * Remove empty lines and add indent characters to convert the paragraphs in given wikitext to
 * definition list items, as customary in discussions.
 *
 * @param {string} wikitext
 * @param {string} indent Indent character, ':' or '*'
 * @return {string}
 */
CommentController.prototype.doIndentReplacements = function ( wikitext, indent ) {
	wikitext = modifier.sanitizeWikitextLinebreaks( wikitext );

	wikitext = wikitext.split( '\n' ).map( function ( line ) {
		return indent + line;
	} ).join( '\n' );

	return wikitext;
};

/**
 * Turn definition list items, customary in discussions, back into normal paragraphs, suitable for
 * the editing interface.
 *
 * @param {Node} rootNode Node potentially containing definition lists (modified in-place)
 */
CommentController.prototype.undoIndentReplacements = function ( rootNode ) {
	var children = Array.prototype.slice.call( rootNode.childNodes );
	// There may be multiple lists when some lines are template generated
	children.forEach( function ( child ) {
		if ( child.nodeType === Node.ELEMENT_NODE ) {
			// Unwrap list
			modifier.unwrapList( child );
		}
	} );
};

/**
 * Get the list of selectors that match nodes that can't be inserted in the comment. (We disallow
 * things that generate wikitext syntax that may conflict with list item syntax.)
 *
 * @return {Object} Map of type used for error messages (string) to CSS selector (string)
 */
CommentController.prototype.getUnsupportedNodeSelectors = function () {
	return {
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
};

CommentController.prototype.switchToVisual = function () {
	var parsePromise,
		oldWidget = this.replyWidget,
		oldShowAdvanced = oldWidget.showAdvanced,
		oldEditSummary = oldWidget.getEditSummary(),
		wikitext = oldWidget.getValue(),
		commentController = this;

	// Replace wikitext signatures with a special marker recognized by DtDmMWSignatureNode
	// to render them as signature nodes in visual mode.
	wikitext = wikitext.replace(
		// Replace ~~~~ (four tildes), but not ~~~~~ (five tildes)
		/([^~]|^)~~~~([^~]|$)/g,
		'$1<span data-dtsignatureforswitching="1"></span>$2'
	);

	if ( wikitext ) {
		wikitext = this.doIndentReplacements( wikitext, ':' );

		// Based on ve.init.mw.Target#parseWikitextFragment
		parsePromise = controller.getApi().post( {
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
		{ mode: 'visual' }
	);

	return $.when( parsePromise, this.replyWidgetPromise ).then( function ( html, replyWidget ) {
		var doc, type, $msg,
			unsupportedSelectors = commentController.getUnsupportedNodeSelectors();

		if ( html ) {
			doc = replyWidget.replyBodyWidget.target.parseDocument( html );
			// Remove RESTBase IDs (T253584)
			mw.libs.ve.stripRestbaseIds( doc );
			// Check for tables, headings, images, templates
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
			commentController.undoIndentReplacements( doc.body );
		}

		// Teardown the old widget
		oldWidget.disconnect( commentController );
		oldWidget.teardown();

		// Swap out the DOM nodes
		oldWidget.$element.replaceWith( replyWidget.$element );

		commentController.setupReplyWidget( replyWidget, {
			value: doc,
			showAdvanced: oldShowAdvanced,
			editSummary: oldEditSummary
		} );

		// Focus the editor
		replyWidget.focus();
	} );
};

module.exports = CommentController;
