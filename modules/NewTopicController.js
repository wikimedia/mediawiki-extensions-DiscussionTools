var
	CommentController = require( './CommentController.js' ),
	HeadingItem = require( './HeadingItem.js' );

function NewTopicController( $pageContainer, $replyLink ) {
	var comment;

	this.container = new OO.ui.PanelLayout( {
		classes: [ 'dt-ui-newTopic' ],
		expanded: false,
		padded: true,
		framed: true
	} );

	this.sectionTitle = new OO.ui.TextInputWidget( {
		// Wrap in a <h2> element to inherit heading font styles
		$element: $( '<h2>' ),
		classes: [ 'dt-ui-newTopic-sectionTitle' ],
		placeholder: mw.msg( 'discussiontools-newtopic-placeholder-title' ),
		spellcheck: true
	} );
	this.sectionTitleField = new OO.ui.FieldLayout( this.sectionTitle, {
		align: 'top'
	} );
	this.prevTitleText = '';

	this.container.$element.append( this.sectionTitleField.$element );

	// HeadingItem representing the heading being added, so that we can pretend we're replying to it
	comment = new HeadingItem( {
		startContainer: this.sectionTitleField.$element[ 0 ],
		startOffset: 0,
		endContainer: this.sectionTitleField.$element[ 0 ],
		endOffset: this.sectionTitleField.$element[ 0 ].childNodes.length
	} );
	comment.id = 'new|' + mw.config.get( 'wgRelevantPageName' );
	comment.isNewTopic = true;

	NewTopicController.super.call( this, $pageContainer, $replyLink, comment );
}

OO.inheritClass( NewTopicController, CommentController );

/* Static properties */

NewTopicController.static.initType = 'section';

/* Methods */

/**
 * @inheritdoc
 */
NewTopicController.prototype.getTranscludedFromSource = function () {
	var
		pageName = mw.config.get( 'wgRelevantPageName' ),
		oldId = mw.config.get( 'wgCurRevisionId' );

	// Always post on the current page
	return $.Deferred().resolve( {
		pageName: pageName,
		oldId: oldId
	} ).promise();
};

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
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.setupReplyWidget = function ( replyWidget, data ) {
	var title;

	NewTopicController.super.prototype.setupReplyWidget.call( this, replyWidget, data );

	title = this.replyWidget.storage.get( this.replyWidget.storagePrefix + '/title' );
	if ( title && !this.sectionTitle.getValue() ) {
		// Don't overwrite if the user has already typed something in while the widget was loading.
		// TODO This should happen immediately rather than waiting for the reply widget to load,
		// then we wouldn't need this check, but the autosave code is in ReplyWidget.
		this.sectionTitle.setValue( title );
	}

	this.sectionTitle.connect( this, { change: 'onSectionTitleChange' } );
	this.sectionTitle.$input.on( 'blur', this.onSectionTitleBlur.bind( this ) );
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.focus = function () {
	this.sectionTitle.focus();
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.teardown = function ( abandoned ) {
	NewTopicController.super.prototype.teardown.call( this, abandoned );

	this.replyWidget.storage.remove( this.replyWidget.storagePrefix + '/title' );
	this.sectionTitle.setValue( '' );
	this.sectionTitleField.setWarnings( [] );
	this.container.$element.detach();
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.doCrazyIndentReplacements = function ( wikitext ) {
	// No crazy replacements when posting new topics
	return wikitext;
};

/**
 * @inheritdoc
 */
NewTopicController.prototype.undoCrazyIndentReplacements = function ( wikitext ) {
	// No crazy replacements when posting new topics
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

	data = $.extend( {}, data, {
		paction: 'addtopic',
		sectiontitle: this.sectionTitle.getValue(),
		dttags: [
			'discussiontools',
			'discussiontools-newtopic',
			'discussiontools-' + this.replyWidget.getMode()
		].join( ',' )
	} );

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
	var titleText, prevTitleText, generatedSummary, generatedPrevSummary, currentSummary;

	titleText = this.sectionTitle.getValue();
	prevTitleText = this.prevTitleText;

	if ( prevTitleText !== titleText ) {
		this.replyWidget.storage.set( this.replyWidget.storagePrefix + '/title', titleText );

		generatedSummary = this.generateSummary( titleText );
		generatedPrevSummary = this.generateSummary( prevTitleText );

		currentSummary = this.replyWidget.editSummaryInput.getValue();

		// Fill in edit summary if it was not modified by the user yet
		if ( currentSummary === generatedPrevSummary ) {
			this.replyWidget.editSummaryInput.setValue( generatedSummary );
		}
	}

	this.prevTitleText = titleText;

	this.checkSectionTitleValidity();
};

/**
 * Handle 'blur' events for the section title input.
 *
 * @private
 */
NewTopicController.prototype.onSectionTitleBlur = function () {
	this.checkSectionTitleValidity();
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
