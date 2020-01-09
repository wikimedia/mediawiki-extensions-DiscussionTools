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
function CommentTargetWidget() {
	// Parent constructor
	CommentTargetWidget.super.apply( this, arguments );

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
};

module.exports = CommentTargetWidget;
