var
	registries = require( './dt.ui.registries.js' );

/**
 * DiscussionTools-specific target, inheriting from the stand-alone target
 *
 * @class
 * @extends ve.init.mw.Target
 *
 * @param {Object} config Configuration options
 */
function CommentTarget( config ) {
	config = config || {};

	// Parent constructor
	CommentTarget.super.call( this, ve.extendObject( {
		toolbarConfig: { actions: true, $overlay: true, position: 'top' }
	}, config ) );
}

/* Inheritance */

OO.inheritClass( CommentTarget, ve.init.mw.Target );

/* Static methods */

CommentTarget.static.name = 'discussionTools';

CommentTarget.static.modes = [ 'visual', 'source' ];

CommentTarget.static.toolbarGroups = [
	{
		name: 'style',
		title: OO.ui.deferMsg( 'visualeditor-toolbar-style-tooltip' ),
		include: [ 'bold', 'italic', 'moreTextStyle' ]
	},
	{
		name: 'link',
		include: [ 'link' ]
	},
	{
		name: 'other',
		include: [ 'usernameCompletion' ]
	}
];

CommentTarget.static.importRules = ve.copy( CommentTarget.static.importRules );

CommentTarget.static.importRules.external.conversions = ve.extendObject(
	{},
	CommentTarget.static.importRules.external.conversions,
	{
		mwHeading: 'paragraph'
	}
);

CommentTarget.static.importRules.external.blacklist = ve.extendObject(
	{},
	CommentTarget.static.importRules.external.blacklist,
	{
		// Annotations
		// Allow pasting external links
		'link/mwExternal': false,
		// Strip all table structure
		mwTable: true,
		tableSection: true,
		tableRow: true,
		tableCell: true
	}
);

CommentTarget.prototype.attachToolbar = function () {
	this.$element.parent().parent().children().first().prepend( this.getToolbar().$element );
};

CommentTarget.prototype.getSurfaceConfig = function ( config ) {
	return CommentTarget.super.prototype.getSurfaceConfig.call( this, ve.extendObject( {
		commandRegistry: registries.commandRegistry,
		sequenceRegistry: registries.sequenceRegistry,
		// eslint-disable-next-line no-jquery/no-global-selector
		$overlayContainer: $( '#content' )
	}, config ) );
};

/* Registration */

ve.init.mw.targetFactory.register( CommentTarget );

module.exports = CommentTarget;
