var controller = require( 'ext.discussionTools.controller' );

/**
 * DiscussionTools ReplyWidget class
 *
 * @class mw.dt.ReplyWidget
 * @extends OO.ui.Widget
 * @constructor
 * @param {Object} comment Parsed comment object
 * @param {Object} [config] Configuration options
 */
function ReplyWidget( comment, config ) {
	var returnTo;

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.comment = comment;

	this.textWidget = new OO.ui.MultilineTextInputWidget( $.extend( {
		rows: 3,
		autosize: true,
		// The following classes can be used here:
		// * mw-editfont-monospace
		// * mw-editfont-sans-serif
		// * mw-editfont-serif
		classes: [ 'mw-editfont-' + mw.user.options.get( 'editfont' ) ]
	}, config ) );
	this.replyButton = new OO.ui.ButtonWidget( {
		flags: [ 'primary', 'progressive' ],
		label: mw.msg( 'discussiontools-replywidget-reply' )
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: mw.msg( 'discussiontools-replywidget-cancel' )
	} );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: [ 'emit', 'cancel' ] } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
		this.textWidget.$element,
		$( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
			$( '<div>' ).addClass( 'dt-ui-replyWidget-terms' ).append(
				mw.message( 'discussiontools-replywidget-terms-click', mw.msg( 'discussiontools-replywidget-reply' ) ).parseDom()
			),
			this.cancelButton.$element,
			this.replyButton.$element
		)
	);

	if ( mw.user.isAnon() ) {
		returnTo = {
			returntoquery: encodeURIComponent( window.location.search ),
			returnto: mw.config.get( 'wgPageName' )
		};
		this.$element.prepend(
			new OO.ui.MessageWidget( {
				classes: [ 'dt-ui-replyWidget-anonWarning' ],
				type: 'warning',
				label: mw.message( 'discussiontools-replywidget-anon-warning' )
					.params( [
						mw.util.getUrl( 'Special:Userlogin', returnTo ),
						mw.util.getUrl( 'Special:Userlogin/signup', returnTo )
					] )
					.parseDom()
			} ).$element
		);
	}
}

/* Inheritance */

OO.inheritClass( ReplyWidget, OO.ui.Widget );

/* Methods */

ReplyWidget.prototype.focus = function () {
	this.textWidget.focus();
};

ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.emit( 'cancel' );
		return false;
	}
	if ( e.which === OO.ui.Keys.ENTER && ( e.ctrlKey || e.metaKey ) ) {
		this.onReplyClick();
		return false;
	}
};

ReplyWidget.prototype.onReplyClick = function () {
	var repliedTo,
		widget = this;

	this.textWidget.pushPending();
	this.textWidget.setDisabled( true );
	this.replyButton.setDisabled( true );
	this.cancelButton.setDisabled( true );

	this.comment.parsoidPromise.then( function ( parsoidData ) {
		repliedTo = parsoidData.comment.id;
		return controller.postReply( widget, parsoidData );
	} ).then( function ( data ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		var $container = $( '#mw-content-text' );

		// Update page state
		$container.html( data.content );
		mw.config.set( {
			wgCurRevisionId: data.newrevid,
			wgRevisionId: data.newrevid
		} );
		mw.config.set( data.jsconfigvars );
		mw.loader.load( data.modules );
		// TODO update categories, lastmodified
		// (see ve.init.mw.DesktopArticleTarget.prototype.replacePageContent)

		// Re-initialize
		controller.init( $container, {
			repliedTo: repliedTo
		} );
		mw.hook( 'wikipage.content' ).fire( $container );

		// TODO: Tell controller to teardown all previous widgets
	} ).always( function () {
		widget.textWidget.popPending();
		widget.textWidget.setDisabled( false );
		widget.replyButton.setDisabled( false );
		widget.cancelButton.setDisabled( false );
	} );
};

module.exports = ReplyWidget;
