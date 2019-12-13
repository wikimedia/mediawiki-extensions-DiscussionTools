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

	this.textWidget = new OO.ui.MultilineTextInputWidget( $.extend( {
		rows: 3,
		autosize: true,
		// The following classes can be used here:
		// * mw-editfont-monospace
		// * mw-editfont-sans-serif
		// * mw-editfont-serif
		classes: [ 'mw-editfont-' + mw.user.options.get( 'editfont' ) ]
	}, config.input ) );
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
	this.cancelButton.connect( this, { click: [ 'teardown', true ] } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );
	this.beforeUnloadHandler = this.onBeforeUnload.bind( this );

	this.api = new mw.Api();
	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// this.getTargetWidget().target.getSurface().getModel().getDocument().connect( this, { transact: this.onInputChangeThrottled } );
	this.textWidget.connect( this, { change: this.onInputChangeThrottled } );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.$preview,
		this.textWidget.$element,
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

ReplyWidget.prototype.setup = function () {
	this.bindBeforeUnloadHandler();
};

ReplyWidget.prototype.teardown = function ( confirm ) {
	var promise,
		widget = this;
	if ( confirm && !this.isEmpty() ) {
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
		widget.unbindBeforeUnloadHandler();
		widget.clear();
		widget.emit( 'teardown' );
	} );
};

ReplyWidget.prototype.focus = function () {
	this.textWidget.focus();
};

ReplyWidget.prototype.clear = function () {
	this.textWidget.setValue( '' );
};

ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.emit( 'cancel' );
		return false;
	}
	if ( e.which === OO.ui.Keys.ENTER && ( e.ctrlKey || e.metaKey ) ) {
		this.onReplyClick();
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
		// surface = this.getTargetWidget().target.getSurface();

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}

	// wikitext = surface.getDom();
	wikitext = this.textWidget.getValue();
	if ( !wikitext.trim() ) {
		parsePromise = $.Deferred().resolve( '' ).promise();
	} else {
		wikitext = controller.autoSign( wikitext );
		wikitext = wikitext.slice( 0, -4 ) + '<span style="opacity: 0.5;">~~~~</span>';
		wikitext = indent + wikitext.replace( /\n/g, '\n' + indent );
		this.previewRequest = parsePromise = this.api.parse( wikitext, { pst: true } );
	}
	// TODO: Add list context

	parsePromise.then( function ( html ) {
		var heightAfter,
			heightBefore = widget.$preview.outerHeight( true );
		widget.$preview.html( html );
		heightAfter = widget.$preview.outerHeight( true );

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

ReplyWidget.prototype.isEmpty = function () {
	return !this.textWidget.getValue().trim();
};

ReplyWidget.prototype.onReplyClick = function () {
	var repliedTo,
		widget = this;

	this.textWidget.pushPending();
	this.textWidget.setDisabled( true );
	this.replyButton.setDisabled( true );
	this.cancelButton.setDisabled( true );

	this.comment.parsoidPromise.then( function ( parsoidData ) {
		repliedTo = parsoidData.comment.id;
		return controller.postReply( widget, parsoidData );
	} ).then( function ( data ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		var $container = $( '#mw-content-text' );

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
		controller.init( $container, {
			repliedTo: repliedTo
		} );
		mw.hook( 'wikipage.content' ).fire( $container );

		widget.teardown();
		// TODO: Tell controller to teardown all other open widgets
	} ).always( function () {
		widget.textWidget.popPending();
		widget.textWidget.setDisabled( false );
		widget.replyButton.setDisabled( false );
		widget.cancelButton.setDisabled( false );
	} );
};

/* Window registration */

OO.ui.getWindowManager().addWindows( [ new mw.widgets.AbandonEditDialog() ] );

module.exports = ReplyWidget;
