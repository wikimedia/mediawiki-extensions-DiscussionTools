/**
 * DiscussionTools ReplyWidget class
 *
 * @class
 * @extends OO.ui.Widget
 * @constructor
 * @param {Object} comment Parsed comment object
 * @param {Object} [config] Configuration options
 */
mw.dt.ui.ReplyWidget = function ( comment, config ) {
	// Parent constructor
	mw.dt.ui.ReplyWidget.super.call( this, config );

	this.comment = comment;

	this.textWidget = new OO.ui.MultilineTextInputWidget( $.extend( {
		rows: 3,
		autosize: true
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
};

mw.dt.ui.ReplyWidget.prototype.onReplyClick = function () {
	var widget = this;

	this.comment.parsoidPromise.then( function ( parsoidData ) {
		return mw.dt.controller.postReply( widget, parsoidData );
	} ).then( function () {
		location.reload();
	} );
};
