var controller = require( 'ext.discussionTools.controller' ),
	modifier = require( 'ext.discussionTools.modifier' ),
	logger = require( 'ext.discussionTools.logger' );

/**
 * DiscussionTools ReplyWidget class
 *
 * @class mw.dt.ReplyWidget
 * @extends OO.ui.Widget
 * @constructor
 * @param {Object} comment Parsed comment object
 * @param {Object} [config] Configuration options
 * @param {Object} [config.input] Configuration options for the comment input widget
 */
function ReplyWidget( comment, config ) {
	var returnTo, contextNode, inputConfig;

	config = config || {};

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.comment = comment;
	contextNode = modifier.closest( this.comment.range.endContainer, 'dl, ul, ol' );
	this.context = contextNode ? contextNode.nodeName.toLowerCase() : 'dl';

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

	this.$preview = $( '<div>' ).addClass( 'dt-ui-replyWidget-preview' ).attr( 'data-label', mw.msg( 'discussiontools-replywidget-preview' ) );
	this.$actionsWrapper = $( '<div>' ).addClass( 'dt-ui-replyWidget-actionsWrapper' );
	this.$actions = $( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
		this.cancelButton.$element,
		this.replyButton.$element
	);
	this.$terms = $( '<div>' ).addClass( 'dt-ui-replyWidget-terms' ).append(
		mw.message( 'discussiontools-replywidget-terms-click', mw.msg( 'discussiontools-replywidget-reply' ) ).parseDom()
	);
	this.$actionsWrapper.append( this.$terms, this.$actions );

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
		this.$element.append( this.anonWarning.$element, this.$terms );
		this.$actionsWrapper.detach();
	}

	// Init preview and button state
	this.onInputChange();
}

/* Inheritance */

OO.inheritClass( ReplyWidget, OO.ui.Widget );

/* Methods */

ReplyWidget.prototype.createReplyBodyWidget = null;

ReplyWidget.prototype.focus = null;

ReplyWidget.prototype.insertNewNodes = null;

ReplyWidget.prototype.getValue = null;

ReplyWidget.prototype.isEmpty = null;

ReplyWidget.prototype.clear = function () {
	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}
};

ReplyWidget.prototype.setPending = function ( pending ) {
	if ( pending ) {
		this.replyButton.setDisabled( true );
		this.cancelButton.setDisabled( true );
	} else {
		this.replyButton.setDisabled( false );
		this.cancelButton.setDisabled( false );
	}
};

ReplyWidget.prototype.setup = function () {
	this.bindBeforeUnloadHandler();
};

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
};

ReplyWidget.prototype.teardown = function () {
	this.unbindBeforeUnloadHandler();
	this.clear();
	this.$preview.empty();
	this.emit( 'teardown' );
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

	if ( this.mode !== 'source' ) {
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
		wikitext = controller.autoSignWikitext( wikitext );
		wikitext = wikitext.slice( 0, -4 ) + '<span style="opacity: 0.6;">~~~~</span>';
		wikitext = indent + wikitext.replace( /\n/g, '\n' + indent );
		this.previewRequest = parsePromise = this.api.post( {
			formatversion: 2,
			action: 'parse',
			text: wikitext,
			pst: true,
			prop: [ 'text', 'modules' ],
			title: mw.config.get( 'wgPageName' )
		} );
	}
	// TODO: Add list context

	parsePromise.then( function ( response ) {
		widget.$preview.html( response ? response.parse.text : '' );

		if ( response ) {
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
	var widget = this;

	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}

	this.setPending( true );

	logger( { action: 'saveIntent' } );

	// We must get a new copy of the document every time, otherwise any unsaved replies will pile up
	controller.getParsoidCommentData( this.comment.id ).then( function ( parsoidData ) {
		logger( { action: 'saveAttempt' } );

		return controller.postReply( widget, parsoidData );
	} ).then( function ( data ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		var $container = $( '#mw-content-text' );

		widget.teardown();
		// TODO: Tell controller to teardown all other open widgets

		// Update page state
		$container.html( data.content );
		mw.config.set( {
			wgCurRevisionId: data.newrevid,
			wgRevisionId: data.newrevid
		} );
		mw.config.set( data.jsconfigvars );
		mw.loader.load( data.modules );
		// TODO update categories, lastmodified
		// (see ve.init.mw.DesktopArticleTarget.prototype.replacePageContent)

		// Re-initialize
		controller.init( $container.find( '.mw-parser-output' ), {
			repliedTo: widget.comment.id
		} );
		mw.hook( 'wikipage.content' ).fire( $container );

		logger( {
			action: 'saveSuccess',
			// eslint-disable-next-line camelcase
			revision_id: data.newrevid
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

		widget.errorMessage = new OO.ui.MessageWidget( {
			type: 'error',
			label: widget.api.getErrorMessage( data )
		} );
		widget.errorMessage.$element.insertBefore( widget.replyBodyWidget.$element );

		if ( data.edit && data.edit.captcha ) {
			code = 'captcha';
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
