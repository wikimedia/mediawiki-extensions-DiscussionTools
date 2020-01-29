var controller = require( 'ext.discussionTools.controller' ),
	modifier = require( 'ext.discussionTools.modifier' );

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
	var returnTo, contextNode;

	config = config || {};

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.comment = comment;
	contextNode = modifier.closest( this.comment.range.endContainer, 'dl, ul, ol' );
	this.context = contextNode ? contextNode.nodeName.toLowerCase() : 'dl';

	this.replyBodyWidget = this.createReplyBodyWidget( config.input );
	this.replyButton = new OO.ui.ButtonWidget( {
		flags: [ 'primary', 'progressive' ],
		label: mw.msg( 'discussiontools-replywidget-reply' )
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: mw.msg( 'discussiontools-replywidget-cancel' )
	} );

	this.$preview = $( '<div>' ).addClass( 'dt-ui-replyWidget-preview' );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: 'tryTeardown' } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );
	this.beforeUnloadHandler = this.onBeforeUnload.bind( this );

	this.api = new mw.Api();
	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.$preview,
		this.replyBodyWidget.$element,
		$( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
			$( '<div>' ).addClass( 'dt-ui-replyWidget-terms' ).append(
				mw.message( 'discussiontools-replywidget-terms-click', mw.msg( 'discussiontools-replywidget-reply' ) ).parseDom()
			),
			this.cancelButton.$element,
			this.replyButton.$element
		)
	);

	if ( mw.user.isAnon() ) {
		returnTo = {
			returntoquery: encodeURIComponent( window.location.search ),
			returnto: mw.config.get( 'wgPageName' )
		};
		this.$element.prepend(
			new OO.ui.MessageWidget( {
				classes: [ 'dt-ui-replyWidget-anonWarning' ],
				type: 'warning',
				label: mw.message( 'discussiontools-replywidget-anon-warning' )
					.params( [
						mw.util.getUrl( 'Special:Userlogin', returnTo ),
						mw.util.getUrl( 'Special:Userlogin/signup', returnTo )
					] )
					.parseDom()
			} ).$element
		);
	}

	// Init preview?
	this.onInputChangeThrottled();
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
			} );
	} else {
		promise = $.Deferred().resolve().promise();
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
		wikitext = wikitext.slice( 0, -4 ) + '<span style="opacity: 0.5;">~~~~</span>';
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
		var heightAfter,
			heightBefore = widget.$preview.outerHeight( true );
		widget.$preview.html( response ? response.parse.text : '' );
		heightAfter = widget.$preview.outerHeight( true );

		if ( response ) {
			mw.loader.load( response.parse.modulestyles );
			mw.loader.load( response.parse.modules );
		}

		// TODO: IE11?
		window.scrollBy( 0, heightAfter - heightBefore );
	} );
};

/**
 * Bind the beforeunload handler, if needed and if not already bound.
 *
 * @private
 */
ReplyWidget.prototype.bindBeforeUnloadHandler = function () {
	$( window ).on( 'beforeunload', this.beforeUnloadHandler );
};

/**
 * Unbind the beforeunload handler if it is bound.
 *
 * @private
 */
ReplyWidget.prototype.unbindBeforeUnloadHandler = function () {
	$( window ).off( 'beforeunload', this.beforeUnloadHandler );
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

ReplyWidget.prototype.onReplyClick = function () {
	var repliedTo,
		widget = this;

	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}

	this.setPending( true );

	this.comment.parsoidPromise.then( function ( parsoidData ) {
		repliedTo = parsoidData.comment.id;
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
			repliedTo: repliedTo
		} );
		mw.hook( 'wikipage.content' ).fire( $container );
	}, function ( code, data ) {
		widget.errorMessage = new OO.ui.MessageWidget( {
			type: 'error',
			label: ( new mw.Api() ).getErrorMessage( data )
		} );
		widget.errorMessage.$element.insertBefore( widget.replyBodyWidget.$element );
	} ).always( function () {
		widget.setPending( false );
	} );
};

/* Window registration */

OO.ui.getWindowManager().addWindows( [ new mw.widgets.AbandonEditDialog() ] );

module.exports = ReplyWidget;
