/**
 * @external CommentController
 * @external CommentItem
 */

/**
 * DiscussionTools ReplyWidgetPlain class
 *
 * @class mw.dt.ReplyWidgetPlain
 * @extends mw.dt.ReplyWidget
 * @constructor
 * @param {CommentController} commentController
 * @param {CommentItem} comment
 * @param {string} pageName
 * @param {number} oldId
 * @param {Object} [config]
 */
function ReplyWidgetPlain() {
	// Parent constructor
	ReplyWidgetPlain.super.apply( this, arguments );

	this.$element.addClass( 'dt-ui-replyWidget-plain' );
}

/* Inheritance */

OO.inheritClass( ReplyWidgetPlain, require( 'ext.discussionTools.ReplyWidget' ) );

/* Methods */

ReplyWidgetPlain.prototype.createReplyBodyWidget = function ( config ) {
	var textInput = new OO.ui.MultilineTextInputWidget( $.extend( {
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
	// Fix jquery.ime position (T255191)
	textInput.$input.addClass( 'ime-position-inside' );
	return textInput;
};

ReplyWidgetPlain.prototype.focus = function () {
	this.replyBodyWidget.focus();

	return this;
};

ReplyWidgetPlain.prototype.clear = function () {
	this.replyBodyWidget.setValue( '' );

	this.storage.remove( this.storagePrefix + '/body' );

	// Parent method
	ReplyWidgetPlain.super.prototype.clear.apply( this, arguments );
};

ReplyWidgetPlain.prototype.isEmpty = function () {
	return !this.replyBodyWidget.getValue().trim();
};

ReplyWidgetPlain.prototype.getMode = function () {
	return 'source';
};

ReplyWidgetPlain.prototype.onInputChange = function () {
	var wikitext;

	// Parent method
	ReplyWidgetPlain.super.prototype.onInputChange.apply( this, arguments );

	wikitext = this.getValue();
	this.storage.set( this.storagePrefix + '/body', wikitext );
};

ReplyWidgetPlain.prototype.setup = function ( initialValue ) {
	var autosaveValue = this.storage.get( this.storagePrefix + '/body' );

	// Parent method
	ReplyWidgetPlain.super.prototype.setup.call( this );

	// Events
	this.replyBodyWidget.connect( this, { change: this.onInputChangeThrottled } );

	this.replyBodyWidget.setValue( initialValue || autosaveValue );

	// needs to bind after the initial setValue:
	this.replyBodyWidget.once( 'change', this.onFirstTransaction.bind( this ) );

	this.afterSetup();

	return this;
};

ReplyWidgetPlain.prototype.teardown = function () {
	this.replyBodyWidget.disconnect( this );
	this.replyBodyWidget.off( 'change' );

	// Parent method
	return ReplyWidgetPlain.super.prototype.teardown.call( this );
};

ReplyWidgetPlain.prototype.onKeyDown = function ( e ) {
	// Parent method
	ReplyWidgetPlain.super.prototype.onKeyDown.call( this, e );

	if ( e.which === OO.ui.Keys.ENTER && ( e.ctrlKey || e.metaKey ) ) {
		this.onReplyClick();
		return false;
	}
};

ReplyWidgetPlain.prototype.getValue = function () {
	return this.replyBodyWidget.getValue();
};

module.exports = ReplyWidgetPlain;
