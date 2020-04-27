/**
 * DiscussionTools ReplyWidgetPlain class
 *
 * @class mw.dt.ReplyWidgetPlain
 * @extends mw.dt.ReplyWidget
 * @constructor
 * @param {Object} commentController
 * @param {Object} parsoidData
 * @param {Object} [config] Configuration options
 */
function ReplyWidgetPlain() {
	// Parent constructor
	ReplyWidgetPlain.super.apply( this, arguments );

	// Events
	this.replyBodyWidget.connect( this, { change: this.onInputChangeThrottled } );
}

/* Inheritance */

OO.inheritClass( ReplyWidgetPlain, require( 'ext.discussionTools.ReplyWidget' ) );

/* Methods */

ReplyWidgetPlain.prototype.createReplyBodyWidget = function ( config ) {
	return new OO.ui.MultilineTextInputWidget( $.extend( {
		rows: 3,
		// TODO: Fix upstream to support a value meaning no max limit (e.g. Infinity)
		maxRows: 999,
		autosize: true,
		// The following classes are used here:
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
	// Parent method
	ReplyWidgetPlain.super.prototype.clear.apply( this, arguments );

	this.replyBodyWidget.setValue( '' );
};

ReplyWidgetPlain.prototype.isEmpty = function () {
	return !this.replyBodyWidget.getValue().trim();
};

ReplyWidgetPlain.prototype.getMode = function () {
	return 'source';
};

ReplyWidgetPlain.prototype.initAutoSave = function () {
	var body;
	this.storage = mw.storage.session;
	this.storage.set( this.storagePrefix + '/class', 'ReplyWidgetPlain' );
	if ( ( body = this.storage.get( this.storagePrefix + '/body' ) ) ) {
		this.replyBodyWidget.setValue( body );
	}
};

ReplyWidgetPlain.prototype.onInputChange = function () {
	var wikitext;

	// Parent method
	ReplyWidgetPlain.super.prototype.onInputChange.apply( this, arguments );

	wikitext = this.getValue();
	this.storage.set( this.storagePrefix + '/body', wikitext );
};

ReplyWidgetPlain.prototype.setup = function () {
	// Parent method
	ReplyWidgetPlain.super.prototype.setup.call( this );

	this.replyBodyWidget.once( 'change', this.onFirstTransaction.bind( this ) );
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

ReplyWidgetPlain.prototype.getValue = function () {
	return this.replyBodyWidget.getValue();
};

module.exports = ReplyWidgetPlain;
