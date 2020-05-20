var controller = require( 'ext.discussionTools.init' ).controller,
	utils = require( 'ext.discussionTools.init' ).utils,
	logger = require( 'ext.discussionTools.init' ).logger;

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
 * @param {boolean} [config.switchable] Widget can switch modes (visual/source)
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

	inputConfig = $.extend(
		{ placeholder: mw.msg( 'discussiontools-replywidget-placeholder-reply', comment.author ) },
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

	this.modeTabSelect.connect( this, {
		choose: 'onModeTabSelectChoose'
	} );

	this.$preview = $( '<div>' ).addClass( 'dt-ui-replyWidget-preview' ).attr( 'data-label', mw.msg( 'discussiontools-replywidget-preview' ) );
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

	this.api = new mw.Api();
	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.replyBodyWidget.$element,
		this.$preview,
		this.$actionsWrapper
	);

	if ( config.switchable ) {
		this.$element.prepend( this.modeTabSelect.$element );
	}

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
		if ( checkboxes.checkboxFields ) {
			widget.$checkboxes = $( '<div>' ).addClass( 'dt-ui-replyWidget-checkboxes' );
			checkboxes.checkboxFields.forEach( function ( field ) {
				widget.$checkboxes.append( field.$element );
			} );
			widget.$actions.prepend( widget.$checkboxes );
		}
	} );

	this.initAutoSave();
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

/**
 * Set the reply widget's value
 *
 * @method
 * @chainable
 * @param {Mixed} value Value
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.setValue = null;

ReplyWidget.prototype.isEmpty = null;

ReplyWidget.prototype.getMode = null;

ReplyWidget.prototype.initAutoSave = null;

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
	}
};

ReplyWidget.prototype.onModeTabSelectChoose = function ( option ) {
	var promise,
		widget = this;
	this.setPending( true );
	this.modeTabSelect.setDisabled( true );
	switch ( option.getData() ) {
		case 'source':
			promise = this.commentController.switchToWikitext();
			break;
		case 'visual':
			promise = this.commentController.switchToVisual();
			break;
	}
	promise.then( null, function () {
		// Switch failed, restore previous tab selection
		widget.modeTabSelect.selectItemByData( option.getData() === 'source' ? 'visual' : 'source' );
	} ).always( function () {
		widget.setPending( false );
		widget.modeTabSelect.setDisabled( false );
	} );
};

/**
 * Setup the widget
 *
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.setup = function () {
	this.bindBeforeUnloadHandler();
	this.modeTabSelect.selectItemByData( this.getMode() );
	// Init preview and button state
	this.onInputChange();
	return this;
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
		// TODO: Override messages in dialog to be more ReplyWidget specific
		promise = OO.ui.getWindowManager().openWindow( 'abandonedit' )
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
		widget.teardown();
	} );
	return this;
};

/**
 * Teardown the widget
 *
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.teardown = function () {
	this.unbindBeforeUnloadHandler();
	this.clear();
	this.$preview.empty();
	this.emit( 'teardown' );
	return this;
};

ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.tryTeardown();
		return false;
	}
};

ReplyWidget.prototype.onInputChange = function () {
	var wikitext, parsePromise,
		widget = this,
		indent = {
			dl: ':',
			ul: '*',
			ol: '#'
		}[ this.context ];

	this.replyButton.setDisabled( this.isEmpty() );

	if ( this.getMode() !== 'source' ) {
		return;
	}

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}

	wikitext = this.getValue();
	if ( !wikitext.trim() ) {
		parsePromise = $.Deferred().resolve( null ).promise();
	} else {
		wikitext = controller.sanitizeWikitextLinebreaks(
			controller.autoSignWikitext( wikitext )
		);
		// Drop opacity of signature in preview to make message body preview clearer.
		wikitext = wikitext.slice( 0, -4 ) + '<span style="opacity: 0.6;">~~~~</span>';
		wikitext = indent + wikitext.replace( /\n/g, '\n' + indent );
		this.previewRequest = parsePromise = this.api.post( {
			formatversion: 2,
			action: 'parse',
			text: wikitext,
			pst: true,
			prop: [ 'text', 'modules', 'jsconfigvars' ],
			title: mw.config.get( 'wgPageName' )
		} );
	}
	// TODO: Add list context

	parsePromise.then( function ( response ) {
		widget.$preview.html( response ? response.parse.text : '' );

		if ( response ) {
			mw.config.set( response.parse.jsconfigvars );
			mw.loader.load( response.parse.modulestyles );
			mw.loader.load( response.parse.modules );
		}
	} );
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
					formatversion: 2,
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
			// Re-initialize
			controller.init( $container.find( '.mw-parser-output' ), {
				repliedTo: comment.id
			} );
			mw.hook( 'wikipage.content' ).fire( $container );

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

		if ( OO.getProp( data, 'visualeditoredit', 'edit', 'captcha' ) ) {
			code = 'captcha';

			widget.captchaInput = new mw.libs.confirmEdit.CaptchaInputWidget(
				OO.getProp( data, 'visualeditoredit', 'edit', 'captcha' )
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

OO.ui.getWindowManager().addWindows( [ new mw.widgets.AbandonEditDialog() ] );

module.exports = ReplyWidget;
