var CommentTarget = require( './CommentTarget.js' );

/**
 * DiscussionTools TargetWidget class
 *
 * @class
 * @extends ve.ui.MWTargetWidget
 *
 * @constructor
 * @param {Object} [config] Configuration options
 */
function CommentTargetWidget( config ) {
	config = $.extend( {}, {
		excludeCommands: [
			'heading1',
			'heading2',
			'heading3',
			'heading4',
			'heading5',
			'heading6',
			'insertTable'
		]
	}, config );

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
	return new CommentTarget( {
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
	docOrHtml = typeof docOrHtml === 'string' ? this.target.parseDocument( docOrHtml ) : docOrHtml;

	// Parent method
	CommentTargetWidget.super.prototype.setDocument.call( this, docOrHtml );

	// Remove MW specific classes as the widget is already inside the content area
	this.getSurface().getView().$element.removeClass( 'mw-body-content' );
	this.getSurface().$placeholder.removeClass( 'mw-body-content' );

	// HACK
	this.getSurface().authors = this.authors;
};

module.exports = CommentTargetWidget;
