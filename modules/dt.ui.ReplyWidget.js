var controller = require( 'ext.discussionTools.init' ).controller,
	modifier = require( 'ext.discussionTools.init' ).modifier,
	utils = require( 'ext.discussionTools.init' ).utils,
	logger = require( 'ext.discussionTools.init' ).logger;

/**
 * @external CommentController
 */

/**
 * DiscussionTools ReplyWidget class
 *
 * @class mw.dt.ReplyWidget
 * @extends OO.ui.Widget
 * @constructor
 * @param {CommentController} commentController Comment controller
 * @param {Object} parsoidData Result from controller#getParsoidCommentData
 * @param {Object} [config] Configuration options
 * @param {Object} [config.input] Configuration options for the comment input widget
 */
function ReplyWidget( commentController, parsoidData, config ) {
	var returnTo, contextNode, inputConfig,
		widget = this,
		pageData = parsoidData.pageData,
		comment = parsoidData.comment;

	config = config || {};

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.pending = false;
	this.commentController = commentController;
	this.parsoidData = parsoidData;
	contextNode = utils.closestElement( comment.range.endContainer, [ 'dl', 'ul', 'ol' ] );
	this.context = contextNode ? contextNode.nodeName.toLowerCase() : 'dl';
	// TODO: Should storagePrefix include pageName?
	this.storagePrefix = 'reply/' + comment.id;
	this.storage = mw.storage.session;
	// eslint-disable-next-line no-jquery/no-global-selector
	this.contentDir = $( '#mw-content-text' ).css( 'direction' );

	inputConfig = $.extend(
		{
			placeholder: mw.msg( 'discussiontools-replywidget-placeholder-reply', comment.author ),
			authors: comment.getHeading().getAuthorsBelow()
		},
		config.input
	);
	this.replyBodyWidget = this.createReplyBodyWidget( inputConfig );
	this.replyButton = new OO.ui.ButtonWidget( {
		flags: [ 'primary', 'progressive' ],
		label: mw.msg( 'discussiontools-replywidget-reply' )
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: mw.msg( 'discussiontools-replywidget-cancel' ),
		framed: false
	} );

	this.modeTabSelect = new OO.ui.TabSelectWidget( {
		classes: [ 'dt-ui-replyWidget-modeTabs' ],
		items: [
			new OO.ui.TabOptionWidget( {
				label: mw.msg( 'discussiontools-replywidget-mode-visual' ),
				data: 'visual'
			} ),
			new OO.ui.TabOptionWidget( {
				label: mw.msg( 'discussiontools-replywidget-mode-source' ),
				data: 'source'
			} )
		],
		framed: false
	} );
	// Initialize to avoid flicker when switching mode
	this.modeTabSelect.selectItemByData( this.getMode() );

	this.$preview = $( '<div>' )
		.addClass( 'dt-ui-replyWidget-preview' )
		.attr( 'data-label', mw.msg( 'discussiontools-replywidget-preview' ) )
		// Set preview direction to content direction
		.attr( 'dir', this.contentDir );
	this.$actionsWrapper = $( '<div>' ).addClass( 'dt-ui-replyWidget-actionsWrapper' );
	this.$actions = $( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
		this.cancelButton.$element,
		this.replyButton.$element
	);
	this.$footer = $( '<div>' ).addClass( 'dt-ui-replyWidget-footer' );
	if ( pageData.pageName !== mw.config.get( 'wgRelevantPageName' ) ) {
		this.$footer.append( $( '<p>' ).append(
			mw.message( 'discussiontools-replywidget-transcluded', pageData.pageName ).parseDom()
		) );
	}
	this.$footer.append(
		$( '<p>' ).append(
			mw.message( 'discussiontools-replywidget-terms-click', mw.msg( 'discussiontools-replywidget-reply' ) ).parseDom()
		),
		$( '<p>' ).append(
			$( '<a>' )
				.attr( {
					href: mw.msg( 'discussiontools-replywidget-feedback-link' ),
					target: '_blank',
					rel: 'noopener'
				} )
				.text( mw.msg( 'discussiontools-replywidget-feedback' ) )
		)
	);
	this.$actionsWrapper.append( this.$footer, this.$actions );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: 'tryTeardown' } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );
	this.beforeUnloadHandler = this.onBeforeUnload.bind( this );
	this.unloadHandler = this.onUnload.bind( this );
	this.modeTabSelect.connect( this, {
		choose: 'onModeTabSelectChoose'
	} );

	this.api = new mw.Api( { parameters: { formatversion: 2 } } );
	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.modeTabSelect.$element,
		this.replyBodyWidget.$element,
		this.$preview,
		this.$actionsWrapper
	);
	// Set direction to interface direction
	this.$element.attr( 'dir', $( document.body ).css( 'direction' ) );

	if ( mw.user.isAnon() ) {
		returnTo = {
			returntoquery: encodeURIComponent( window.location.search ),
			returnto: mw.config.get( 'wgPageName' )
		};
		this.anonWarning = new OO.ui.MessageWidget( {
			classes: [ 'dt-ui-replyWidget-anonWarning' ],
			type: 'warning',
			label: mw.message( 'discussiontools-replywidget-anon-warning' )
				.params( [
					mw.util.getUrl( 'Special:Userlogin', returnTo ),
					mw.util.getUrl( 'Special:Userlogin/signup', returnTo )
				] )
				.parseDom()
		} );
		this.anonWarning.$element.append( this.$actions );
		this.$element.append( this.anonWarning.$element, this.$footer );
		this.$actionsWrapper.detach();
	}

	this.checkboxesPromise = controller.getCheckboxesPromise( this.parsoidData.pageData );
	this.checkboxesPromise.then( function ( checkboxes ) {
		var name;
		function trackCheckbox( name ) {
			mw.track( 'dt.schemaVisualEditorFeatureUse', {
				feature: 'dtReply',
				action: 'checkbox-' + name
			} );
		}
		if ( checkboxes.checkboxFields ) {
			widget.$checkboxes = $( '<div>' ).addClass( 'dt-ui-replyWidget-checkboxes' );
			checkboxes.checkboxFields.forEach( function ( field ) {
				widget.$checkboxes.append( field.$element );
			} );
			widget.$actions.prepend( widget.$checkboxes );

			// bind logging:
			for ( name in checkboxes.checkboxesByName ) {
				checkboxes.checkboxesByName[ name ].$element.off( '.dtReply' ).on( 'click.dtReply', trackCheckbox.bind( this, name ) );
			}
		}
	} );
}

/* Inheritance */

OO.inheritClass( ReplyWidget, OO.ui.Widget );

/* Methods */

ReplyWidget.prototype.createReplyBodyWidget = null;

/**
 * Focus the widget
 *
 * @method
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.focus = null;

ReplyWidget.prototype.getValue = null;

ReplyWidget.prototype.isEmpty = null;

ReplyWidget.prototype.getMode = null;

ReplyWidget.prototype.clear = function () {
	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}
};

ReplyWidget.prototype.setPending = function ( pending ) {
	this.pending = pending;
	if ( pending ) {
		this.replyButton.setDisabled( true );
		this.cancelButton.setDisabled( true );
	} else {
		this.replyButton.setDisabled( false );
		this.cancelButton.setDisabled( false );
		this.updateButtons();
	}
};

ReplyWidget.prototype.saveEditMode = function ( mode ) {
	this.api.saveOption( 'discussiontools-editmode', mode ).then( function () {
		mw.user.options.set( 'discussiontools-editmode', mode );
	} );
};

ReplyWidget.prototype.onModeTabSelectChoose = function ( option ) {
	var promise,
		mode = option.getData(),
		widget = this;

	if ( mode === this.getMode() ) {
		return;
	}

	this.setPending( true );
	this.modeTabSelect.setDisabled( true );
	switch ( mode ) {
		case 'source':
			promise = this.commentController.switchToWikitext();
			break;
		case 'visual':
			promise = this.commentController.switchToVisual();
			break;
	}
	// TODO: We rely on #setup to call #saveEditMode, so when we have 2017WTE
	// we will need to save the new preference here as switching will not
	// reload the editor.
	promise.then( null, function () {
		// Switch failed, restore previous tab selection
		widget.modeTabSelect.selectItemByData( mode === 'source' ? 'visual' : 'source' );
	} ).always( function () {
		widget.setPending( false );
		widget.modeTabSelect.setDisabled( false );
	} );

	mw.track( 'dt.schemaVisualEditorFeatureUse', {
		feature: 'editor-switch',
		// TODO: Log as `source-nwe-desktop` when enable2017Wikitext is set
		action: ( mode === 'visual' ? 'visual' : 'source' ) + '-desktop'
	} );
};

/**
 * Setup the widget
 *
 * @param {Mixed} initialValue Initial value
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.setup = function () {
	this.bindBeforeUnloadHandler();
	if ( this.modeTabSelect ) {
		this.modeTabSelect.selectItemByData( this.getMode() );
		this.saveEditMode( this.getMode() );
	}

	return this;
};

ReplyWidget.prototype.afterSetup = function () {
	// Init preview and button state
	this.onInputChange();
	// Autosave
	this.storage.set( this.storagePrefix + '/mode', this.getMode() );
};

/**
 * Try to teardown the widget, prompting the user if unsaved changes will be lost.
 *
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.tryTeardown = function () {
	var promise,
		widget = this;

	if ( !this.isEmpty() ) {
		promise = OO.ui.getWindowManager().openWindow( 'abandoncomment' )
			.closed.then( function ( data ) {
				if ( !( data && data.action === 'discard' ) ) {
					return $.Deferred().reject().promise();
				}
				logger( {
					action: 'abort',
					mechanism: 'cancel',
					type: 'abandon'
				} );
			} );
	} else {
		promise = $.Deferred().resolve().promise();
		logger( {
			action: 'abort',
			mechanism: 'cancel',
			type: 'nochange'
		} );
	}
	promise.then( function () {
		widget.teardown( true );
	} );
	return this;
};

/**
 * Teardown the widget
 *
 * @param {boolean} [abandoned] Widget was torn down after a reply was abandoned
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.teardown = function ( abandoned ) {
	this.unbindBeforeUnloadHandler();
	this.clear();
	this.storage.remove( this.storagePrefix + '/mode' );
	this.storage.remove( this.storagePrefix + '/saveable' );
	this.$preview.empty();
	this.emit( 'teardown', abandoned );
	return this;
};

ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.tryTeardown();
		return false;
	}
};

ReplyWidget.prototype.onInputChange = function () {
	this.updateButtons();
	this.storage.set( this.storagePrefix + '/saveable', this.isEmpty() ? '' : '1' );
	this.preparePreview();
};

/**
 * Update the interface with the preview of the given wikitext.
 *
 * @param {string} [wikitext] Wikitext to preview, defaults to current value
 * @return {jQuery.Promise} Promise resolved when we're done
 */
ReplyWidget.prototype.preparePreview = function ( wikitext ) {
	var parsePromise, widget, indent;

	if ( this.getMode() !== 'source' ) {
		return $.Deferred().resolve().promise();
	}

	widget = this;
	indent = {
		dl: ':',
		ul: '*',
		ol: '#'
	}[ this.context ];
	wikitext = wikitext || this.getValue();

	if ( this.previewWikitext === wikitext ) {
		return $.Deferred().resolve().promise();
	}
	this.previewWikitext = wikitext;

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}

	if ( !wikitext.trim() ) {
		parsePromise = $.Deferred().resolve( null ).promise();
	} else {
		wikitext = modifier.sanitizeWikitextLinebreaks( wikitext );
		if ( !modifier.isWikitextSigned( wikitext ) ) {
			// Add signature.
			// Drop opacity of signature in preview to make message body preview clearer.
			wikitext = wikitext + '<span style="opacity: 0.6;">' + mw.msg( 'discussiontools-signature-prefix' ) + '~~~~</span>';
		}
		wikitext = indent + wikitext.replace( /\n/g, '\n' + indent );
		this.previewRequest = parsePromise = this.api.post( {
			action: 'parse',
			text: wikitext,
			pst: true,
			prop: [ 'text', 'modules', 'jsconfigvars' ],
			title: mw.config.get( 'wgPageName' )
		} );
	}
	// TODO: Add list context

	return parsePromise.then( function ( response ) {
		widget.$preview.html( response ? response.parse.text : '' );

		if ( response ) {
			mw.config.set( response.parse.jsconfigvars );
			mw.loader.load( response.parse.modulestyles );
			mw.loader.load( response.parse.modules );
		}
	} );
};

ReplyWidget.prototype.updateButtons = function () {
	this.replyButton.setDisabled( this.isEmpty() );
};

ReplyWidget.prototype.onFirstTransaction = function () {
	logger( { action: 'firstChange' } );
};

/**
 * Bind the beforeunload handler, if needed and if not already bound.
 *
 * @private
 */
ReplyWidget.prototype.bindBeforeUnloadHandler = function () {
	$( window ).on( 'beforeunload', this.beforeUnloadHandler );
	$( window ).on( 'unload', this.unloadHandler );
};

/**
 * Unbind the beforeunload handler if it is bound.
 *
 * @private
 */
ReplyWidget.prototype.unbindBeforeUnloadHandler = function () {
	$( window ).off( 'beforeunload', this.beforeUnloadHandler );
	$( window ).off( 'unload', this.unloadHandler );
};

/**
 * Respond to beforeunload event.
 *
 * @private
 * @param {jQuery.Event} e Event
 * @return {string|undefined}
 */
ReplyWidget.prototype.onBeforeUnload = function ( e ) {
	if ( !this.isEmpty() ) {
		e.preventDefault();
		return '';
	}
};

/**
 * Respond to unload event.
 *
 * @private
 * @param {jQuery.Event} e Event
 */
ReplyWidget.prototype.onUnload = function () {
	logger( {
		action: 'abort',
		type: this.isEmpty() ? 'nochange' : 'abandon',
		mechanism: 'navigate'
	} );
};

ReplyWidget.prototype.onReplyClick = function () {
	var widget = this,
		pageData = this.parsoidData.pageData,
		comment = this.parsoidData.comment;

	if ( this.pending || this.isEmpty() ) {
		return;
	}

	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}

	this.setPending( true );

	logger( { action: 'saveIntent' } );

	// TODO: When editing a transcluded page, VE API returning the page HTML is a waste, since we won't use it

	// We must get a new copy of the document every time, otherwise any unsaved replies will pile up
	// TODO: Move most of this logic to the CommentController
	controller.getParsoidCommentData(
		pageData.pageName,
		pageData.oldId,
		comment.id
	).then( function ( parsoidData ) {
		logger( { action: 'saveAttempt' } );
		return widget.commentController.save( parsoidData );
	} ).then( function ( data ) {
		var
			pageUpdated = $.Deferred(),
			// eslint-disable-next-line no-jquery/no-global-selector
			$container = $( '#mw-content-text' );

		widget.teardown();
		// TODO: Tell controller to teardown all other open widgets

		// Update page state
		if ( pageData.pageName === mw.config.get( 'wgRelevantPageName' ) ) {
			// We can use the result from the VisualEditor API
			$container.html( data.content );
			mw.config.set( {
				wgCurRevisionId: data.newrevid,
				wgRevisionId: data.newrevid
			} );
			mw.config.set( data.jsconfigvars );
			// Note: VE API merges 'modules' and 'modulestyles'
			mw.loader.load( data.modules );
			// TODO update categories, displaytitle, lastmodified
			// (see ve.init.mw.DesktopArticleTarget.prototype.replacePageContent)

			pageUpdated.resolve();

		} else {
			// We saved to another page, we must purge and then fetch the current page
			widget.api.post( {
				action: 'purge',
				titles: mw.config.get( 'wgRelevantPageName' )
			} ).then( function () {
				return widget.api.get( {
					action: 'parse',
					prop: [ 'text', 'modules', 'jsconfigvars' ],
					page: mw.config.get( 'wgRelevantPageName' )
				} );
			} ).then( function ( parseResp ) {
				$container.html( parseResp.parse.text );
				mw.config.set( parseResp.parse.jsconfigvars );
				mw.loader.load( parseResp.parse.modulestyles );
				mw.loader.load( parseResp.parse.modules );
				// TODO update categories, displaytitle, lastmodified
				// We may not be able to use prop=displaytitle without making changes in the action=parse API,
				// VE API has some confusing code that changes the HTML escaping on it before returning???

				pageUpdated.resolve();

			} ).catch( function () {
				// We saved the reply, but couldn't purge or fetch the updated page. Seems difficult to
				// explain this problem. Redirect to the page where the user can at least see their reply…
				window.location = mw.util.getUrl( pageData.pageName );
			} );
		}

		pageUpdated.then( function () {
			// Re-initialize and highlight the new reply.
			mw.dt.initState.repliedTo = comment.id;

			// We need our init code to run after everyone else's handlers for this hook,
			// so that all changes to the page layout have been completed (e.g. collapsible elements),
			// and we can measure things and display the highlight in the right place.
			mw.hook( 'wikipage.content' ).remove( mw.dt.init );
			mw.hook( 'wikipage.content' ).fire( $container );
			// The hooks have "memory" so calling add() after fire() actually fires the handler,
			// and calling add() before fire() would actually fire it twice.
			mw.hook( 'wikipage.content' ).add( mw.dt.init );

			logger( {
				action: 'saveSuccess',
				// eslint-disable-next-line camelcase
				revision_id: data.newrevid
			} );
		} );

	}, function ( code, data ) {
		var typeMap = {
			// Compare to ve.init.mw.ArticleTargetEvents.js in VisualEditor.
			editconflict: 'editConflict',
			wasdeleted: 'editPageDeleted',
			abusefilter: 'extensionAbuseFilter',
			'abusefilter-disallowed': 'extensionAbuseFilter',
			captcha: 'extensionCaptcha',
			spamprotectiontext: 'extensionSpamBlacklist',
			titleblacklist: 'extensionTitleBlacklist',
			'titleblacklist-forbidden-edit': 'extensionTitleBlacklist',
			badtoken: 'userBadToken',
			newuser: 'userNewUser',
			spamblacklist: 'extensionSpamBlacklist',
			empty: 'responseEmpty',
			unknown: 'responseUnknown',
			pagedeleted: 'editPageDeleted'
		};

		if ( widget.captchaMessage ) {
			widget.captchaMessage.$element.detach();
		}
		widget.captchaInput = undefined;

		if ( OO.getProp( data, 'discussiontoolsedit', 'edit', 'captcha' ) ) {
			code = 'captcha';

			widget.captchaInput = new mw.libs.confirmEdit.CaptchaInputWidget(
				OO.getProp( data, 'discussiontoolsedit', 'edit', 'captcha' )
			);
			// Save when pressing 'Enter' in captcha field as it is single line.
			widget.captchaInput.on( 'enter', function () {
				widget.onReplyClick();
			} );

			widget.captchaMessage = new OO.ui.MessageWidget( {
				type: 'notice',
				label: widget.captchaInput.$element
			} );
			widget.captchaMessage.$element.insertAfter( widget.$preview );

			widget.captchaInput.focus();
			widget.captchaInput.scrollElementIntoView();

		} else {
			widget.errorMessage = new OO.ui.MessageWidget( {
				type: 'error',
				label: code instanceof Error ? code.toString() : widget.api.getErrorMessage( data )
			} );
			widget.errorMessage.$element.insertBefore( widget.replyBodyWidget.$element );
		}

		logger( {
			action: 'saveFailure',
			message: code,
			type: typeMap[ code ] || 'responseUnknown'
		} );
	} ).always( function () {
		widget.setPending( false );
	} );
};

/* Window registration */

function AbandonCommentDialog() {
	// Parent constructor
	AbandonCommentDialog.super.apply( this, arguments );
}

/* Inheritance */

OO.inheritClass( AbandonCommentDialog, mw.widgets.AbandonEditDialog );

AbandonCommentDialog.static.name = 'abandoncomment';
AbandonCommentDialog.static.message = OO.ui.deferMsg( 'discussiontools-replywidget-abandon' );
AbandonCommentDialog.static.actions = OO.copy( AbandonCommentDialog.static.actions );
AbandonCommentDialog.static.actions[ 0 ].label =
	OO.ui.deferMsg( 'discussiontools-replywidget-abandon-discard' );

AbandonCommentDialog.static.actions[ 1 ].label =
	OO.ui.deferMsg( 'discussiontools-replywidget-abandon-keep' );

OO.ui.getWindowManager().addWindows( [ new AbandonCommentDialog() ] );

module.exports = ReplyWidget;
