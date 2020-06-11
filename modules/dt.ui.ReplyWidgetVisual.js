var CommentTargetWidget = require( './CommentTargetWidget.js' );

require( './dt.ui.UsernameCompletionAction.js' );
require( './dt.ui.UsernameCompletionTool.js' );

/**
 * DiscussionTools ReplyWidgetVisual class
 *
 * @class mw.dt.ReplyWidgetVisual
 * @extends mw.dt.ReplyWidget
 * @constructor
 * @param {Object} commentController
 * @param {Object} parsoidData
 * @param {Object} [config] Configuration options
 */
function ReplyWidgetVisual() {
	// TODO: Support 2017 wikitext editor
	this.defaultMode = 'visual';
	this.initialValue = null;

	// Parent constructor
	ReplyWidgetVisual.super.apply( this, arguments );

	// TODO: Rename this widget to VE, as it isn't just visual mode
	this.$element.addClass( 'dt-ui-replyWidget-ve' );
}

/* Inheritance */

OO.inheritClass( ReplyWidgetVisual, require( 'ext.discussionTools.ReplyWidget' ) );

/* Methods */

ReplyWidgetVisual.prototype.createReplyBodyWidget = function ( config ) {
	return new CommentTargetWidget( $.extend( {
		defaultMode: this.defaultMode
	}, config ) );
};

ReplyWidgetVisual.prototype.getValue = function () {
	if ( this.getMode() === 'source' ) {
		return this.replyBodyWidget.target.getSurface().getModel().getDom();
	} else {
		return this.replyBodyWidget.target.getSurface().getHtml();
	}
};

ReplyWidgetVisual.prototype.clear = function () {
	// Parent method
	ReplyWidgetVisual.super.prototype.clear.apply( this, arguments );

	this.replyBodyWidget.clear();
};

ReplyWidgetVisual.prototype.isEmpty = function () {
	var surface = this.replyBodyWidget.target.getSurface();
	return !( surface && surface.getModel().getDocument().data.hasContent() );
};

ReplyWidgetVisual.prototype.getMode = function () {
	return this.replyBodyWidget.target.getSurface() ?
		this.replyBodyWidget.target.getSurface().getMode() :
		this.defaultMode;
};

ReplyWidgetVisual.prototype.setup = function ( initialValue ) {
	var htmlOrDoc,
		widget = this,
		target = this.replyBodyWidget.target;

	if ( this.storage.get( this.storagePrefix + '/saveable' ) ) {
		htmlOrDoc = this.storage.get( this.storagePrefix + '/ve-dochtml' );
		target.recovered = true;
	} else {
		htmlOrDoc = initialValue || '<p></p>';
	}

	target.originalHtml = htmlOrDoc instanceof HTMLDocument ? ve.properInnerHtml( htmlOrDoc.body ) : htmlOrDoc;
	target.fromEditedState = !!initialValue;

	this.replyBodyWidget.setDocument( htmlOrDoc );

	target.once( 'surfaceReady', function () {
		target.getSurface().getModel().setAutosaveDocId( widget.storagePrefix );
		target.initAutosave();
		widget.afterSetup();

		// This needs to bind after surfaceReady so any initial population doesn't trigger it early:
		widget.replyBodyWidget.once( 'change', widget.onFirstTransaction.bind( widget ) );
	} );

	// Parent method
	ReplyWidgetVisual.super.prototype.setup.call( this );

	// Events
	this.replyBodyWidget.connect( this, {
		change: 'onInputChangeThrottled',
		submit: 'onReplyClick'
	} );

	return this;
};

ReplyWidgetVisual.prototype.teardown = function () {
	this.replyBodyWidget.disconnect( this );
	this.replyBodyWidget.off( 'change' );
	// TODO: Just teardown the whole target?
	this.replyBodyWidget.target.clearDocState();

	// Parent method
	return ReplyWidgetVisual.super.prototype.teardown.call( this );
};

ReplyWidgetVisual.prototype.focus = function () {
	var targetWidget = this.replyBodyWidget;
	setTimeout( function () {
		targetWidget.getSurface().getModel().selectLastContentOffset();
		targetWidget.focus();
	} );

	return this;
};

ReplyWidgetVisual.prototype.setPending = function ( pending ) {
	ReplyWidgetVisual.super.prototype.setPending.call( this, pending );

	if ( pending ) {
		this.replyBodyWidget.pushPending();
		this.replyBodyWidget.setReadOnly( true );
	} else {
		this.replyBodyWidget.popPending();
		this.replyBodyWidget.setReadOnly( false );
	}
};

ve.trackSubscribe( 'activity.', function ( topic, data ) {
	mw.track( 'dt.schemaVisualEditorFeatureUse', ve.extendObject( data, {
		feature: topic.split( '.' )[ 1 ]
	} ) );
} );

module.exports = ReplyWidgetVisual;
