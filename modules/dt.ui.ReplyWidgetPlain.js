var controller = require( 'ext.discussionTools.controller' ),
	modifier = require( 'ext.discussionTools.modifier' );

/**
 * DiscussionTools ReplyWidgetPlain class
 *
 * @class mw.dt.ReplyWidgetPlain
 * @extends mw.dt.ReplyWidget
 * @constructor
 * @param {Object} comment Parsed comment object
 * @param {Object} [config] Configuration options
 */
function ReplyWidgetPlain( comment, config ) {
	// Parent constructor
	ReplyWidgetPlain.super.call( this, comment, config );

	this.mode = 'source';

	// Events
	this.replyBodyWidget.connect( this, { change: this.onInputChangeThrottled } );
}

/* Inheritance */

OO.inheritClass( ReplyWidgetPlain, require( 'ext.discussionTools.ReplyWidget' ) );

/* Methods */

ReplyWidgetPlain.prototype.createReplyBodyWidget = function ( config ) {
	return new OO.ui.MultilineTextInputWidget( $.extend( {
		rows: 3,
		autosize: true,
		// The following classes can be used here:
		// * mw-editfont-monospace
		// * mw-editfont-sans-serif
		// * mw-editfont-serif
		classes: [ 'mw-editfont-' + mw.user.options.get( 'editfont' ) ]
	}, config ) );
};

ReplyWidgetPlain.prototype.focus = function () {
	this.replyBodyWidget.focus();
};

ReplyWidgetPlain.prototype.clear = function () {
	this.replyBodyWidget.setValue( '' );
};

ReplyWidgetPlain.prototype.isEmpty = function () {
	return !this.replyBodyWidget.getValue().trim();
};

ReplyWidgetPlain.prototype.onKeyDown = function ( e ) {
	// Parent method
	ReplyWidgetPlain.super.prototype.onKeyDown.call( this, e );

	if ( e.which === OO.ui.Keys.ENTER && ( e.ctrlKey || e.metaKey ) ) {
		this.onReplyClick();
		return false;
	}
};

ReplyWidgetPlain.prototype.setPending = function ( pending ) {
	// Parent method
	ReplyWidgetPlain.super.prototype.setPending.call( this, pending );

	if ( pending ) {
		this.replyBodyWidget.pushPending();
		this.replyBodyWidget.setDisabled( true );
	} else {
		this.replyBodyWidget.popPending();
		this.replyBodyWidget.setDisabled( false );
	}
};

ReplyWidgetPlain.prototype.insertNewNodes = function ( parentNode ) {
	var wikitext = controller.autoSignWikitext( this.getValue() );
	wikitext.split( '\n' ).forEach( function ( line ) {
		var lineItem = modifier.addListItem( parentNode );
		lineItem.appendChild( modifier.createWikitextNode( line ) );
	} );
};

ReplyWidgetPlain.prototype.getValue = function () {
	return this.replyBodyWidget.getValue();
};

module.exports = ReplyWidgetPlain;
