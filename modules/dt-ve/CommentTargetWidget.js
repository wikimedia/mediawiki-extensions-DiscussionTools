var CommentTarget = require( './CommentTarget.js' );

/**
 * DiscussionTools TargetWidget class
 *
 * @class
 * @extends ve.ui.MWTargetWidget
 *
 * @constructor
 * @param {mw.dt.ReplyWidgetVisual} replyWidget
 * @param {Object} [config] Configuration options
 */
function CommentTargetWidget( replyWidget, config ) {
	config = $.extend( {}, {
		excludeCommands: [
			'heading1',
			'heading2',
			'heading3',
			'heading4',
			'heading5',
			'heading6',
			'insertTable',
			'transclusionFromSequence', // T253667
			'blockquoteWrap', // T258194
			// Disable to allow Tab/Shift+Tab to move focus out of the widget (T172694)
			'indent',
			'outdent'
		]
	}, config );

	this.replyWidget = replyWidget;
	this.authors = config.authors;

	// Parent constructor
	CommentTargetWidget.super.call( this, config );

	// Initialization
	this.$element.addClass( 'dt-ui-targetWidget' );
}

/* Inheritance */

OO.inheritClass( CommentTargetWidget, ve.ui.MWTargetWidget );

/**
 * @inheritdoc
 */
CommentTargetWidget.prototype.createTarget = function () {
	return new CommentTarget( this.replyWidget, {
		// A lot of places expect ve.init.target to exist...
		register: true,
		toolbarGroups: this.toolbarGroups,
		inTargetWidget: true,
		modes: this.modes,
		defaultMode: this.defaultMode
	} );
};

/**
 * @inheritdoc
 */
CommentTargetWidget.prototype.setDocument = function ( docOrHtml ) {
	var mode = this.target.getDefaultMode(),
		doc = ( mode === 'visual' && typeof docOrHtml === 'string' ) ?
			this.target.parseDocument( docOrHtml ) :
			docOrHtml,
		// TODO: This could be upstreamed:
		dmDoc = this.target.constructor.static.createModelFromDom( doc, mode );

	// Parent method
	CommentTargetWidget.super.prototype.setDocument.call( this, dmDoc );

	// Remove MW specific classes as the widget is already inside the content area
	this.getSurface().getView().$element.removeClass( 'mw-body-content' );
	this.getSurface().$placeholder.removeClass( 'mw-body-content' );

	// Fix jquery.ime position (T255191)
	this.getSurface().getView().getDocument().getDocumentNode().$element.addClass( 'ime-position-inside' );

	// HACK
	this.getSurface().authors = this.authors;
};

module.exports = CommentTargetWidget;
