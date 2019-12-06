/**
 * DiscussionTools ReplyWidget class
 *
 * @class
 * @extends OO.ui.Widget
 * @constructor
 * @param {Object} comment Parsed comment object
 * @param {number} userCommentsBeforeReply User comments before this reply
 * @param {Object} [config] Configuration options
 */
mw.dt.ui.ReplyWidget = function ( comment, userCommentsBeforeReply, config ) {
	// Parent constructor
	mw.dt.ui.ReplyWidget.super.call( this, config );

	this.comment = comment;
	this.userCommentsBeforeReply = userCommentsBeforeReply;

	this.textWidget = new OO.ui.MultilineTextInputWidget( $.extend( {
		rows: 3,
		autosize: true,
		// The following classes can be used here:
		// * mw-editfont-monospace
		// * mw-editfont-sans-serif
		// * mw-editfont-serif
		classes: [ 'mw-editfont-' + mw.user.options.get( 'editfont' ) ]
	}, config ) );
	this.replyButton = new OO.ui.ButtonWidget( {
		flags: [ 'primary', 'progressive' ],
		label: 'Reply'
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: 'Cancel'
	} );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: [ 'emit', 'cancel' ] } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.textWidget.$element,
		$( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
			this.cancelButton.$element,
			this.replyButton.$element
		)
	);
};

/* Inheritance */

OO.inheritClass( mw.dt.ui.ReplyWidget, OO.ui.Widget );

/* Methods */

mw.dt.ui.ReplyWidget.prototype.focus = function () {
	this.textWidget.focus();
};

mw.dt.ui.ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.emit( 'cancel' );
		return false;
	}
	if ( e.which === OO.ui.Keys.ENTER && ( e.ctrlKey || e.metaKey ) ) {
		this.onReplyClick();
		return false;
	}
};

mw.dt.ui.ReplyWidget.prototype.onReplyClick = function () {
	var widget = this;

	this.comment.parsoidPromise.then( function ( parsoidData ) {
		return mw.dt.controller.postReply( widget, parsoidData );
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
		mw.dt.controller.init( $container, {
			userCommentsBeforeReply: widget.userCommentsBeforeReply
		} );
		mw.hook( 'wikipage.content' ).fire( $container );

		// TODO: Tell controller to teardown all previous widgets
	} );
};
