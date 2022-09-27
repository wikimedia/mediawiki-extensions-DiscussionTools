function LedeSectionDialog() {
	// Parent constructor
	LedeSectionDialog.super.apply( this, arguments );
}

/* Inheritance */
OO.inheritClass( LedeSectionDialog, OO.ui.ProcessDialog );

LedeSectionDialog.static.name = 'ledeSection';

LedeSectionDialog.static.size = 'larger';

LedeSectionDialog.static.title = OO.ui.deferMsg( 'discussiontools-ledesection-title' );

LedeSectionDialog.static.actions = [
	{
		label: OO.ui.deferMsg( 'visualeditor-dialog-action-done' ),
		flags: [ 'safe', 'close' ]
	}
];

LedeSectionDialog.prototype.initialize = function () {
	// Parent method
	LedeSectionDialog.super.prototype.initialize.call( this );

	this.contentLayout = new OO.ui.PanelLayout( {
		scrollable: true,
		padded: true,
		expanded: false,
		classes: [ 'ext-discussiontools-ui-ledeSectionDialog-content', 'mw-parser-output', 'content' ]
	} );

	this.$body.append( this.contentLayout.$element );
};

LedeSectionDialog.prototype.getSetupProcess = function ( data ) {
	return LedeSectionDialog.super.prototype.getSetupProcess.call( this, data )
		.next( function () {
			this.contentLayout.$element.empty().append( data.$content );
		}, this );
};

module.exports = LedeSectionDialog;
