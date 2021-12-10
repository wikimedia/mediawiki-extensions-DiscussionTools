var
	utils = require( './utils.js' ),
	logger = require( './logger.js' ),
	controller = require( './controller.js' ),
	CommentController = require( './CommentController.js' ),
	HeadingItem = require( './HeadingItem.js' );

function NewTopicController( $pageContainer, parser ) {
	this.container = new OO.ui.PanelLayout( {
		classes: [ 'ext-discussiontools-ui-newTopic' ],
		expanded: false,
		padded: true,
		framed: true
	} );
	this.$notices = $( '<div>' ).addClass( 'ext-discussiontools-ui-newTopic-notices' );

	this.sectionTitle = new OO.ui.TextInputWidget( {
		// Wrap in a <h2> element to inherit heading font styles
		$element: $( '<h2>' ),
		classes: [ 'ext-discussiontools-ui-newTopic-sectionTitle' ],
		placeholder: mw.msg( 'discussiontools-newtopic-placeholder-title' ),
		spellcheck: true
	} );
	this.sectionTitle.$input.attr( 'aria-label', mw.msg( 'discussiontools-newtopic-placeholder-title' ) );
	this.sectionTitleField = new OO.ui.FieldLayout( this.sectionTitle, {
		align: 'top'
	} );
	this.prevTitleText = '';

	this.container.$element.append( this.$notices, this.sectionTitleField.$element );

	// HeadingItem representing the heading being added, so that we can pretend we're replying to it
	var comment = new HeadingItem( {
		startContainer: this.sectionTitleField.$element[ 0 ],
		startOffset: 0,
		endContainer: this.sectionTitleField.$element[ 0 ],
		endOffset: this.sectionTitleField.$element[ 0 ].childNodes.length
	} );
	comment.id = utils.NEW_TOPIC_COMMENT_ID;
	comment.isNewTopic = true;

	NewTopicController.super.call( this, $pageContainer, comment, parser );
}

OO.inheritClass( NewTopicController, CommentController );

/* Static properties */

NewTopicController.static.initType = 'section';

NewTopicController.static.suppressedEditNotices = [
	// Ignored because we have a custom warning for non-logged-in users.
	'anoneditwarning',
	// Ignored because it contains mostly instructions for signing comments using tildes.
	// (Does not appear in VE notices right now, but just in case.)
	'talkpagetext',
	// Ignored because the empty state takeover has already explained
	// that this is a new article.
	'newarticletext',
	'newarticletextanon'
];

/* Methods */

/**
 * @inheritdoc
 */
NewTopicController.prototype.setup = function ( mode ) {
	var rootScrollable = OO.ui.Element.static.getRootScrollableElement( document.body );

	this.$pageContainer.append( this.container.$element );
	NewTopicController.super.prototype.setup.call( this, mode );

	// The section title field is added to the page immediately, we can scroll to the bottom and focus
	// it while the content field is still loading.
	rootScrollable.scrollTop = rootScrollable.scrollHeight;
	this.focus();

	var firstUse = !mw.user.options.get( 'discussiontools-newtopictool-opened' );
	if (
		( firstUse || mw.user.options.get( 'discussiontools-newtopictool-hint-shown' ) ) &&
		mw.config.get( 'wgUserId' ) && mw.config.get( 'wgUserEditCount', 0 ) >= 500
	) {
		// Topic hint should be shown to logged in users who have more than
		// 500 edits on their first use of the tool, and should persist until
		// they deliberately close it.
		this.setupTopicHint();
	}
	if ( firstUse ) {
		controller.getApi().saveOption( 'discussiontools-newtopictool-opened', '1' ).then( function () {
			mw.user.options.set( 'discussiontools-newtopictool-opened', '1' );
		} );
	}
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.setupReplyWidget = function ( replyWidget, data ) {
	NewTopicController.super.prototype.setupReplyWidget.call( this, replyWidget, data );

	this.$notices.empty();
	for ( var noticeName in this.replyWidget.commentDetails.notices ) {
		if ( this.constructor.static.suppressedEditNotices.indexOf( noticeName ) !== -1 ) {
			continue;
		}
		var noticeItem = this.replyWidget.commentDetails.notices[ noticeName ];
		var $noticeElement = $( '<div>' )
			.addClass( 'ext-discussiontools-ui-replyWidget-notice' )
			.html( typeof noticeItem === 'string' ? noticeItem : noticeItem.message );
		this.$notices.append( $noticeElement );
	}

	var title = this.replyWidget.storage.get( this.replyWidget.storagePrefix + '/title' );
	if ( title && !this.sectionTitle.getValue() ) {
		// Don't overwrite if the user has already typed something in while the widget was loading.
		// TODO This should happen immediately rather than waiting for the reply widget to load,
		// then we wouldn't need this check, but the autosave code is in ReplyWidget.
		this.sectionTitle.setValue( title );
	}

	this.sectionTitle.connect( this, { change: 'onSectionTitleChange' } );
	this.replyWidget.connect( this, { bodyFocus: 'onBodyFocus' } );

	replyWidget.connect( this, {
		clear: 'clear',
		clearStorage: 'clearStorage'
	} );
};

/**
 * Create and display a hint dialog that redirects users to the non-DT version of this tool
 */
NewTopicController.prototype.setupTopicHint = function () {
	var legacyURI;
	try {
		legacyURI = new mw.Uri();
	} catch ( err ) {
		// T106244: URL encoded values using fallback 8-bit encoding (invalid UTF-8) cause mediawiki.Uri to crash
		return;
	}
	legacyURI.query.action = 'edit';
	legacyURI.query.section = 'new';
	legacyURI.query.dtenable = '0';
	this.topicHint = new OO.ui.MessageWidget( {
		label: mw.message( 'discussiontools-newtopic-legacy-hint', legacyURI.toString() ).parseDom(),
		icon: 'article'
	} );
	this.topicHint.$element.addClass( 'ext-discussiontools-ui-newTopic-hint' );
	// TODO: Once showClose lands in OOUI's MessageWidget this can be replaced:
	var dismissButton = new OO.ui.ButtonWidget( {
		icon: 'close',
		framed: false,
		title: mw.msg( 'discussiontools-newtopic-legacy-hint-close' )
	} ).connect( this, { click: 'onTopicHintCloseClick' } );
	this.topicHint.$element.prepend( dismissButton.$element );
	this.container.$element.before( this.topicHint.$element );

	this.topicHint.toggle( true );

	// This needs to persist once it's shown
	controller.getApi().saveOption( 'discussiontools-newtopictool-hint-shown', 1 ).then( function () {
		mw.user.options.set( 'discussiontools-newtopictool-hint-shown', 1 );
	} );
};

/**
 * Handle clicks on the close button for the hint dialog
 */
NewTopicController.prototype.onTopicHintCloseClick = function () {
	this.toggle( false );
	controller.getApi().saveOption( 'discussiontools-newtopictool-hint-shown', null ).then( function () {
		mw.user.options.set( 'discussiontools-newtopictool-hint-shown', null );
	} );
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.focus = function () {
	this.sectionTitle.focus();
};

/**
 * Restore the widget to its original state
 */
NewTopicController.prototype.clear = function () {
	// This is going to get called as part of the teardown chain from replywidget
	this.sectionTitle.setValue( '' );
	this.sectionTitleField.setWarnings( [] );
};

/**
 * Remove any storage that the widget is using
 */
NewTopicController.prototype.clearStorage = function () {
	// This is going to get called as part of the teardown chain from replywidget
	if ( this.replyWidget ) {
		this.replyWidget.storage.remove( this.replyWidget.storagePrefix + '/title' );
	}
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.teardown = function ( abandoned ) {
	NewTopicController.super.prototype.teardown.call( this, abandoned );

	this.container.$element.detach();
	if ( this.topicHint ) {
		this.topicHint.$element.detach();
	}

	if ( mw.config.get( 'wgDiscussionToolsStartNewTopicTool' ) ) {
		var uri;
		try {
			uri = new mw.Uri();
		} catch ( err ) {
			// T106244: URL encoded values using fallback 8-bit encoding (invalid UTF-8) cause mediawiki.Uri to crash
			return;
		}
		delete uri.query.action;
		delete uri.query.veaction;
		delete uri.query.section;
		history.replaceState( null, document.title, uri.toString() );
		mw.config.set( 'wgDiscussionToolsStartNewTopicTool', false );
	}
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.doIndentReplacements = function ( wikitext ) {
	// No indent replacements when posting new topics
	return wikitext;
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.undoIndentReplacements = function ( wikitext ) {
	// No indent replacements when posting new topics
	return wikitext;
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.getUnsupportedNodeSelectors = function () {
	// No unsupported nodes when posting new topics
	return {};
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.getApiQuery = function ( comment, pageName, checkboxes ) {
	var data = NewTopicController.super.prototype.getApiQuery.call( this, comment, pageName, checkboxes );

	// Rebuild the tags array and remove the reply tag
	var tags = ( data.dttags || '' ).split( ',' );
	var replyTag = tags.indexOf( 'discussiontools-reply' );
	if ( replyTag !== -1 ) {
		tags.splice( replyTag, 1 );
	}
	// Add the newtopic tag
	tags.push( 'discussiontools-newtopic' );

	data = $.extend( {}, data, {
		paction: 'addtopic',
		sectiontitle: this.sectionTitle.getValue(),
		dttags: tags.join( ',' ),
		editingStatsId: logger.getSessionId()
	} );

	// Allow MediaWiki to generate the summary if it wasn't modified by the user. This avoids
	// inconsistencies in how wiki markup is stripped from section titles when they're used in
	// automatic summaries. (T275178)
	if ( data.summary === this.generateSummary( this.sectionTitle.getValue() ) ) {
		delete data.summary;
	}

	return data;
};

/**
 * Generate a default edit summary based on the section title.
 *
 * @param {string} titleText Section title
 * @return {string}
 */
NewTopicController.prototype.generateSummary = function ( titleText ) {
	return titleText ? mw.msg( 'newsectionsummary', titleText ) : '';
};

/**
 * Handle 'change' events for the section title input.
 *
 * @private
 */
NewTopicController.prototype.onSectionTitleChange = function () {
	var titleText = this.sectionTitle.getValue();
	var prevTitleText = this.prevTitleText;

	if ( prevTitleText !== titleText ) {
		this.replyWidget.storage.set( this.replyWidget.storagePrefix + '/title', titleText );

		var generatedSummary = this.generateSummary( titleText );
		var generatedPrevSummary = this.generateSummary( prevTitleText );

		var currentSummary = this.replyWidget.editSummaryInput.getValue();

		// Fill in edit summary if it was not modified by the user yet
		if ( currentSummary === generatedPrevSummary ) {
			this.replyWidget.editSummaryInput.setValue( generatedSummary );
		}
	}

	this.prevTitleText = titleText;

	this.checkSectionTitleValidity();
};

/**
 * Handle 'focus' events for the description field (regardless of mode).
 *
 * @private
 */
NewTopicController.prototype.onBodyFocus = function () {
	var offsetBefore = this.replyWidget.$element.offset().top;
	var rootScrollable = OO.ui.Element.static.getRootScrollableElement( document.body );
	var scrollBefore = rootScrollable.scrollTop;

	this.checkSectionTitleValidity();

	var offsetChange = this.replyWidget.$element.offset().top - offsetBefore;
	// Ensure the rest of the widget doesn't move when the validation
	// message is triggered by a focus. (T275923)
	// Browsers sometimes also scroll in response to focus events,
	// so use the old scrollTop value for consistent results.
	rootScrollable.scrollTop = scrollBefore + offsetChange;
};

/**
 * Check if the section title is valid, and display a warning message.
 *
 * @private
 */
NewTopicController.prototype.checkSectionTitleValidity = function () {
	if ( !this.sectionTitle.getValue() ) {
		// Show warning about missing title
		this.sectionTitleField.setWarnings( [
			mw.msg( 'discussiontools-newtopic-missing-title' )
		] );
	} else {
		this.sectionTitleField.setWarnings( [] );
	}
};

module.exports = NewTopicController;
