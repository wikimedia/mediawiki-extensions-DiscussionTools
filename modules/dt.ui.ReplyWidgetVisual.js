var CommentTargetWidget = require( './CommentTargetWidget.js' );

require( './dt.ui.UsernameCompletion.js' );

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
	// Parent constructor
	ReplyWidgetVisual.super.apply( this, arguments );

	// TODO: Use user preference
	this.defaultMode = 'visual';
	this.initialValue = null;

	// Events
	this.replyBodyWidget.connect( this, {
		change: 'onInputChangeThrottled',
		submit: 'onReplyClick'
	} );

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

ReplyWidgetVisual.prototype.setValue = function ( value ) {
	var target = this.replyBodyWidget.target;
	if ( target && target.getSurface() ) {
		target.setDocument( value );
	} else {
		// #setup hasn't been called yet, just save the value for when it is
		this.initialValue = value;
	}
	return this;
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

ReplyWidgetVisual.prototype.initAutoSave = function () {
	// TODO: Implement
};

ReplyWidgetVisual.prototype.setup = function () {
	this.replyBodyWidget.setDocument( this.initialValue || '<p></p>' );
	this.initialValue = null;

	// Parent method
	ReplyWidgetVisual.super.prototype.setup.call( this );

	this.replyBodyWidget.once( 'change', this.onFirstTransaction.bind( this ) );

	return this;
};

ReplyWidgetVisual.prototype.teardown = function () {
	this.replyBodyWidget.off( 'change' );

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

module.exports = ReplyWidgetVisual;
