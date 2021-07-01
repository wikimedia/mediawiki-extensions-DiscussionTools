var
	utils = require( './utils.js' );

function ReplyLinksController( $pageContainer ) {
	// Mixin constructors
	OO.EventEmitter.call( this );

	this.$pageContainer = $pageContainer;
	this.onReplyLinkClickHandler = this.onReplyLinkClick.bind( this );
	this.onAddSectionLinkClickHandler = this.onAddSectionLinkClick.bind( this );

	// Reply links
	this.$replyLinks = $pageContainer.find( 'a.ext-discussiontools-init-replylink-reply[data-mw-comment]' );
	this.$replyLinks.on( 'click keypress', this.onReplyLinkClickHandler );

	// "Add topic" link in the skin interface
	var featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {};
	if ( featuresEnabled.newtopictool && mw.user.options.get( 'discussiontools-newtopictool' ) ) {
		// eslint-disable-next-line no-jquery/no-global-selector
		var $addSectionTab = $( '#ca-addsection' );
		// TODO If the page doesn't exist yet, we'll need to handle the interface differently,
		// for now just don't enable the tool there
		var pageExists = !!mw.config.get( 'wgRelevantArticleId' );
		if ( $addSectionTab.length && pageExists ) {
			// Disable VisualEditor's new section editor (in wikitext mode / NWE), to allow our own
			$addSectionTab.off( '.ve-target' );
			this.$addSectionLink = $addSectionTab.find( 'a' );
			this.$addSectionLink.on( 'click keypress', this.onAddSectionLinkClickHandler );
		}
	}
}

OO.initClass( ReplyLinksController );
OO.mixinClass( ReplyLinksController, OO.EventEmitter );

/**
 * @event link-click
 * @param {string} id
 * $@param {jQuery} $link
 */

/* Methods */

ReplyLinksController.prototype.onReplyLinkClick = function ( e ) {
	if ( !this.isActivationEvent( e ) ) {
		return;
	}
	e.preventDefault();

	this.emit( 'link-click', $( e.target ).data( 'mw-comment' ).id, $( e.target ) );
};

ReplyLinksController.prototype.onAddSectionLinkClick = function ( e ) {
	if ( !this.isActivationEvent( e ) ) {
		return;
	}
	e.preventDefault();

	this.emit( 'link-click', utils.NEW_TOPIC_COMMENT_ID, $( e.target ) );
};

ReplyLinksController.prototype.isActivationEvent = function ( e ) {
	if ( e.type === 'keypress' && e.which !== OO.ui.Keys.ENTER && e.which !== OO.ui.Keys.SPACE ) {
		// Only handle keypresses on the "Enter" or "Space" keys
		return false;
	}
	if ( e.type === 'click' && ( e.which !== OO.ui.MouseButtons.LEFT || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey ) ) {
		// Only handle unmodified left clicks
		return false;
	}
	return true;
};

ReplyLinksController.prototype.focusLink = function ( $link ) {
	if ( $link.is( this.$replyLinks ) ) {
		$link.trigger( 'focus' );
	}
};

ReplyLinksController.prototype.setActiveLink = function ( $link ) {
	this.$activeLink = $link;

	if ( this.$activeLink.is( this.$replyLinks ) ) {
		this.$activeLink.closest( '.ext-discussiontools-init-replylink-buttons' )
			.addClass( 'ext-discussiontools-init-replylink-active' );
	}

	this.$pageContainer.addClass( 'ext-discussiontools-init-replylink-open' );
	this.$replyLinks.attr( {
		tabindex: '-1'
	} );

	// Suppress page takeover behavior for VE editing so that our unload
	// handler can warn of data loss.
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '#ca-edit, #ca-ve-edit, .mw-editsection a, #ca-addsection' ).off( '.ve-target' );
};

ReplyLinksController.prototype.clearActiveLink = function () {
	if ( this.$activeLink.is( this.$replyLinks ) ) {
		this.$activeLink.closest( '.ext-discussiontools-init-replylink-buttons' )
			.removeClass( 'ext-discussiontools-init-replylink-active' );
	}

	this.$pageContainer.removeClass( 'ext-discussiontools-init-replylink-open' );
	this.$replyLinks.attr( {
		tabindex: '0'
	} );

	// We deliberately mangled edit links earlier so VE can't steal our page;
	// have it redo setup to fix those.
	if ( mw.libs.ve && mw.libs.ve.setupEditLinks ) {
		mw.libs.ve.setupEditLinks();
		// Disable VisualEditor's new section editor (in wikitext mode / NWE), to allow our own
		// eslint-disable-next-line no-jquery/no-global-selector
		$( '#ca-addsection' ).off( '.ve-target' );
	}

	this.$activeLink = null;
};

ReplyLinksController.prototype.teardown = function () {
	if ( this.$activeLink ) {
		this.clearActiveLink();
	}

	this.$replyLinks.off( 'click keypress', this.onReplyLinkClickHandler );
	this.$addSectionLink.off( 'click keypress', this.onAddSectionLinkClickHandler );
};

module.exports = ReplyLinksController;
