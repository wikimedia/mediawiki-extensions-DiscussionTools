/**
 * DiscussionTools ReplyWidget class
 *
 * @class
 * @extends OO.ui.Widget
 * @constructor
 * @param {Object} comment Parsed comment object
 * @param {HTMLDocument} parsoidDoc Parsoid document
 * @param {Object} [config] Configuration options
 */
mw.dt.ui.ReplyWidget = function ( comment, parsoidDoc, config ) {
	// Parent constructor
	mw.dt.ui.ReplyWidget.super.call( this, config );

	this.comment = comment;
	this.parsoidDoc = parsoidDoc;

	this.textWidget = new OO.ui.MultilineTextInputWidget( config );
	this.replyButton = new OO.ui.ButtonWidget( {
		flags: [ 'primary', 'progressive' ],
		label: 'Reply'
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: 'Cancel'
	} );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: [ 'emit', 'cancel' ] } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.textWidget.$element,
		$( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
			this.cancelButton.$element,
			this.replyButton.$element
		)
	);
};

/* Inheritance */

OO.inheritClass( mw.dt.ui.ReplyWidget, OO.ui.Widget );

/* Methods */

mw.dt.ui.ReplyWidget.prototype.focus = function () {
	this.textWidget.focus();
};

mw.dt.ui.ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.emit( 'cancel' );
		return false;
	}
};

mw.dt.ui.ReplyWidget.prototype.onReplyClick = function () {
	var widget = this;

	this.comment.parsoidCommentPromise.then( function ( parsoidComment ) {
		var html,
			newParsoidList = mw.dt.modifier.addListAtComment( parsoidComment );

		widget.textWidget.getValue().split( '\n' ).forEach( function ( line, i, arr ) {
			var lineItem = mw.dt.modifier.addListItem( newParsoidList );
			if ( i === arr.length - 1 && line.trim().slice( -4 ) !== '~~~~' ) {
				line += ' ~~~~';
			}
			lineItem.appendChild( mw.dt.modifier.createWikitextNode( line ) );
		} );

		// TODO: We need an ArticleTargetSaver that is separate from
		// Target logic.
		html = ve.init.mw.Target.prototype.getHtml(
			parsoidComment.range.endContainer.ownerDocument
		);
		// eslint-disable-next-line
		console.log( html );
	} );
};
