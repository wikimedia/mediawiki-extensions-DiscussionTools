var controller = require( 'ext.discussionTools.init' ).controller,
	modifier = require( 'ext.discussionTools.init' ).modifier,
	utils = require( 'ext.discussionTools.init' ).utils,
	logger = require( 'ext.discussionTools.init' ).logger,
	ModeTabSelectWidget = require( './ModeTabSelectWidget.js' ),
	ModeTabOptionWidget = require( './ModeTabOptionWidget.js' ),
	licenseMessages = require( './licenseMessages.json' ),
	featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {},
	enable2017Wikitext = featuresEnabled.sourcemodetoolbar;

require( './AbandonCommentDialog.js' );
require( './AbandonTopicDialog.js' );

/**
 * DiscussionTools ReplyWidget class
 *
 * @class mw.dt.ReplyWidget
 * @extends OO.ui.Widget
 * @constructor
 * @param {CommentController} commentController Comment controller
 * @param {CommentItem} comment Comment item
 * @param {CommentDetails} commentDetails
 * @param {Object} [config] Configuration options
 * @param {Object} [config.input] Configuration options for the comment input widget
 */
function ReplyWidget( commentController, comment, commentDetails, config ) {
	var widget = this;

	config = config || {};

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.pending = false;
	this.commentController = commentController;
	this.comment = comment;
	this.commentDetails = commentDetails;
	this.isNewTopic = !!comment.isNewTopic;
	this.pageName = commentDetails.pageName;
	this.oldId = commentDetails.oldId;
	// pageExists can only be false for the new comment tool, so we
	// don't need to worry about transcluded replies.
	this.pageExists = mw.config.get( 'wgRelevantArticleId', 0 ) !== 0;
	var contextNode = utils.closestElement( comment.range.endContainer, [ 'dl', 'ul', 'ol' ] );
	this.context = contextNode ? contextNode.nodeName.toLowerCase() : 'dl';
	// TODO: Should storagePrefix include pageName?
	this.storagePrefix = 'reply/' + comment.id;
	this.storage = mw.storage.session;
	// eslint-disable-next-line no-jquery/no-global-selector
	this.contentDir = $( '#mw-content-text' ).css( 'direction' );

	var inputConfig = $.extend(
		{
			placeholder: this.isNewTopic ?
				mw.msg( 'discussiontools-replywidget-placeholder-newtopic' ) :
				mw.msg( 'discussiontools-replywidget-placeholder-reply', comment.author ),
			authors: this.isNewTopic ?
				// No suggestions in new topic tool yet (T277357)
				[] :
				// comment is a CommentItem when replying
				comment.getHeading().getAuthorsBelow()
		},
		config.input
	);
	this.replyBodyWidget = this.createReplyBodyWidget( inputConfig );
	this.replyButtonLabel = this.isNewTopic ?
		mw.msg( 'discussiontools-replywidget-newtopic' ) :
		mw.msg( 'discussiontools-replywidget-reply' );
	this.replyButton = new OO.ui.ButtonWidget( {
		flags: [ 'primary', 'progressive' ],
		label: this.replyButtonLabel,
		title: this.replyButtonLabel + ' ' +
			// TODO: Use VE keyboard shortcut generating code
			( $.client.profile().platform === 'mac' ?
				'⌘⏎' :
				mw.msg( 'visualeditor-key-ctrl' ) + '+' + mw.msg( 'visualeditor-key-enter' )
			)
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: mw.msg( 'discussiontools-replywidget-cancel' ),
		framed: false,
		title: mw.msg( 'discussiontools-replywidget-cancel' ) + ' ' +
			// TODO: Use VE keyboard shortcut generating code
			( $.client.profile().platform === 'mac' ?
				'⎋' :
				mw.msg( 'visualeditor-key-escape' )
			)
	} );

	this.$headerWrapper = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-headerWrapper' );

	if ( !OO.ui.isMobile() ) {
		this.modeTabSelect = new ModeTabSelectWidget( {
			classes: [ 'ext-discussiontools-ui-replyWidget-modeTabs' ],
			items: [
				new ModeTabOptionWidget( {
					label: mw.msg( 'discussiontools-replywidget-mode-visual' ),
					data: 'visual'
				} ),
				new ModeTabOptionWidget( {
					label: mw.msg( 'discussiontools-replywidget-mode-source' ),
					data: 'source'
				} )
			],
			framed: false
		} );
		this.modeTabSelect.$element.attr( 'aria-label', mw.msg( 'visualeditor-mweditmode-tooltip' ) );
		// Make the option for the current mode disabled, to make it un-interactable
		// (we override the styles to make it look as if it was selected)
		this.modeTabSelect.findItemFromData( this.getMode() ).setDisabled( true );
		this.modeTabSelect.connect( this, {
			choose: 'onModeTabSelectChoose'
		} );
		this.$headerWrapper.append(
			// Visual mode toolbar attached here by CommentTarget#attachToolbar
			this.modeTabSelect.$element
		);
	}

	this.$preview = $( '<div>' )
		.addClass( 'ext-discussiontools-ui-replyWidget-preview' )
		.attr( 'data-label', mw.msg( 'discussiontools-replywidget-preview' ) )
		// Set preview direction to content direction
		.attr( 'dir', this.contentDir );
	this.$actionsWrapper = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-actionsWrapper' );
	this.$actions = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-actions' ).append(
		this.cancelButton.$element,
		this.replyButton.$element
	);

	this.editSummaryInput = new OO.ui.TextInputWidget( {
		classes: [ 'ext-discussiontools-ui-replyWidget-editSummary' ]
	} );
	mw.widgets.visibleCodePointLimit( this.editSummaryInput, mw.config.get( 'wgCommentCodePointLimit' ) );

	this.editSummaryField = new OO.ui.FieldLayout(
		this.editSummaryInput,
		{
			align: 'top',
			classes: [ 'ext-discussiontools-ui-replyWidget-editSummaryField' ],
			label: mw.msg( 'discussiontools-replywidget-summary' )
		}
	);

	this.advancedToggle = new OO.ui.ButtonWidget( {
		label: mw.msg( 'discussiontools-replywidget-advanced' ),
		indicator: 'down',
		framed: false,
		flags: [ 'progressive' ],
		classes: [ 'ext-discussiontools-ui-replyWidget-advancedToggle' ]
	} );
	this.advanced = new OO.ui.MessageWidget( {
		type: 'message',
		$content: this.editSummaryField.$element,
		classes: [ 'ext-discussiontools-ui-replyWidget-advanced' ]
	} ).toggle( false ).setIcon( '' );

	this.$footer = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-footer' );
	if ( this.pageName !== mw.config.get( 'wgRelevantPageName' ) ) {
		this.$footer.append( $( '<p>' ).append(
			mw.message( 'discussiontools-replywidget-transcluded', this.pageName ).parseDom()
		) );
	}
	var $footerLinks = $( '<ul>' ).addClass( 'ext-discussiontools-ui-replyWidget-footer-links' );
	if ( !mw.user.isAnon() ) {
		$footerLinks.append(
			$( '<li>' ).append(
				$( '<a>' )
					.attr( {
						href: mw.util.getUrl( 'Special:Preferences#mw-prefsection-editing-discussion' ),
						target: '_blank',
						rel: 'noopener'
					} )
					.text( mw.msg( 'discussiontools-replywidget-preferences' ) )
			)
		);
	}
	$footerLinks.append(
		$( '<li>' ).append(
			$( '<a>' )
				.attr( {
					href: this.isNewTopic ?
						mw.msg( 'discussiontools-replywidget-feedback-link-newtopic' ) :
						mw.msg( 'discussiontools-replywidget-feedback-link' ),
					target: '_blank',
					rel: 'noopener'
				} )
				.text( mw.msg( 'discussiontools-replywidget-feedback' ) )
		)
	);
	this.$footer.append(
		$( '<p>' ).addClass( 'plainlinks' ).html(
			this.isNewTopic ? licenseMessages.newtopic : licenseMessages.reply
		),
		$footerLinks
	);
	this.$actionsWrapper.append( this.$footer, this.$actions );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: 'tryTeardown' } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this, true ) );
	this.beforeUnloadHandler = this.onBeforeUnload.bind( this );
	this.unloadHandler = this.onUnload.bind( this );
	this.onWatchToggleHandler = this.onWatchToggle.bind( this );
	this.advancedToggle.connect( this, { click: 'onAdvancedToggleClick' } );
	this.editSummaryInput.connect( this, { change: 'onEditSummaryChange' } );
	this.editSummaryInput.$input.on( 'keydown', this.onKeyDown.bind( this, false ) );
	if ( this.isNewTopic ) {
		this.commentController.sectionTitle.$input.on( 'keydown', this.onKeyDown.bind( this, false ) );
	}

	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// Initialization
	this.$element.addClass( 'ext-discussiontools-ui-replyWidget' ).append(
		this.$headerWrapper,
		this.replyBodyWidget.$element,
		this.$preview,
		this.advancedToggle.$element,
		this.advanced.$element,
		this.$actionsWrapper
	);
	// Set direction to interface direction
	this.$element.attr( 'dir', $( document.body ).css( 'direction' ) );
	if ( this.isNewTopic ) {
		this.$element.addClass( 'ext-discussiontools-ui-replyWidget-newTopic' );
	}

	if ( mw.user.isAnon() ) {
		var returnTo = {
			returntoquery: encodeURIComponent( window.location.search ),
			returnto: mw.config.get( 'wgPageName' )
		};
		this.anonWarning = new OO.ui.MessageWidget( {
			classes: [ 'ext-discussiontools-ui-replyWidget-anonWarning' ],
			type: 'warning',
			label: mw.message( 'discussiontools-replywidget-anon-warning' )
				.params( [
					mw.util.getUrl( 'Special:Userlogin', returnTo ),
					mw.util.getUrl( 'Special:Userlogin/signup', returnTo )
				] )
				.parseDom()
		} );
		this.anonWarning.$element.append( this.$actions );
		this.anonWarning.$label.addClass( 'plainlinks' );
		this.$element.append( this.anonWarning.$element, this.$footer );
		this.$actionsWrapper.detach();
	}

	this.checkboxesPromise = controller.getCheckboxesPromise( this.pageName, this.oldId );
	this.checkboxesPromise.then( function ( checkboxes ) {
		function trackCheckbox( n ) {
			mw.track( 'dt.schemaVisualEditorFeatureUse', {
				feature: 'dtReply',
				action: 'checkbox-' + n
			} );
		}
		if ( checkboxes.checkboxFields ) {
			widget.$checkboxes = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-checkboxes' );
			checkboxes.checkboxFields.forEach( function ( field ) {
				widget.$checkboxes.append( field.$element );
			} );
			widget.editSummaryField.$body.append( widget.$checkboxes );

			// bind logging:
			for ( var name in checkboxes.checkboxesByName ) {
				checkboxes.checkboxesByName[ name ].$element.off( '.dtReply' ).on( 'click.dtReply', trackCheckbox.bind( this, name ) );
			}
		}
	} );
}

/* Inheritance */

OO.inheritClass( ReplyWidget, OO.ui.Widget );

/* Methods */

/**
 * Create the widget for the reply body
 *
 * The body widget should implement #setReadOnly, #pushPending and #popPending
 *
 * @method
 * @return {OO.ui.Widget}
 */
ReplyWidget.prototype.createReplyBodyWidget = null;

/**
 * Focus the widget
 *
 * @method
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.focus = null;

/**
 * Get value of reply body, HTML or wikitext
 *
 * @method
 * @return {string}
 */
ReplyWidget.prototype.getValue = null;

/**
 * Check if the reply widget is empty
 *
 * @method
 * @return {boolean}
 */
ReplyWidget.prototype.isEmpty = null;

/**
 * Get the current input mode of the reply widget, 'source' or 'visual'
 *
 * @method
 * @return {string}
 */
ReplyWidget.prototype.getMode = null;

/**
 * Restore the widget to its original state
 *
 * Clear any widget values, reset UI states, and clear
 * any auto-save values.
 */
ReplyWidget.prototype.clear = function () {
	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}
	this.$preview.empty();
	this.previewWikitext = null;
	this.previewTitle = null;
	this.toggleAdvanced( false );

	this.clearStorage();

	this.emit( 'clear' );
};

/**
 * Remove any storage that the widget is using
 */
ReplyWidget.prototype.clearStorage = function () {
	this.storage.remove( this.storagePrefix + '/mode' );
	this.storage.remove( this.storagePrefix + '/saveable' );
	this.storage.remove( this.storagePrefix + '/summary' );
	this.storage.remove( this.storagePrefix + '/showAdvanced' );
	this.storage.remove( this.storagePrefix + '/formToken' );

	this.emit( 'clearStorage' );
};

ReplyWidget.prototype.setPending = function ( pending ) {
	this.pending = pending;
	if ( pending ) {
		this.replyButton.setDisabled( true );
		this.cancelButton.setDisabled( true );
		this.replyBodyWidget.setReadOnly( true );
		this.replyBodyWidget.pushPending();
	} else {
		this.replyButton.setDisabled( false );
		this.cancelButton.setDisabled( false );
		this.replyBodyWidget.setReadOnly( false );
		this.replyBodyWidget.popPending();
		this.updateButtons();
	}
};

ReplyWidget.prototype.saveEditMode = function ( mode ) {
	controller.getApi().saveOption( 'discussiontools-editmode', mode ).then( function () {
		mw.user.options.set( 'discussiontools-editmode', mode );
	} );
};

ReplyWidget.prototype.onAdvancedToggleClick = function () {
	var showAdvanced = !this.showAdvanced;
	mw.track( 'dt.schemaVisualEditorFeatureUse', {
		feature: 'dtReply',
		action: 'advanced-' + ( showAdvanced ? 'show' : 'hide' )
	} );
	controller.getApi().saveOption( 'discussiontools-showadvanced', +showAdvanced ).then( function () {
		mw.user.options.set( 'discussiontools-showadvanced', +showAdvanced );
	} );
	this.toggleAdvanced( showAdvanced );

	if ( showAdvanced ) {
		var summary = this.editSummaryInput.getValue();

		// If the current summary has not been edited yet, select the text following the autocomment to
		// make it easier to change. Otherwise, move cursor to end.
		var selectFromIndex = summary.length;
		if ( this.isNewTopic ) {
			var titleText = this.commentController.sectionTitle.getValue();
			if ( summary === this.commentController.generateSummary( titleText ) ) {
				selectFromIndex = titleText.length + '/* '.length + ' */ '.length;
			}
		} else {
			// Same as summary.endsWith( defaultReplyTrail )
			var defaultReplyTrail = '*/ ' + mw.msg( 'discussiontools-defaultsummary-reply' );
			var endCommentIndex = summary.indexOf( defaultReplyTrail );
			if ( endCommentIndex + defaultReplyTrail.length === summary.length ) {
				selectFromIndex = endCommentIndex + 3;
			}
		}

		this.editSummaryInput.selectRange( selectFromIndex, summary.length );
		this.editSummaryInput.focus();
	} else {
		this.focus();
	}
};

ReplyWidget.prototype.toggleAdvanced = function ( showAdvanced ) {
	this.showAdvanced = showAdvanced === undefined ? !this.showAdvanced : showAdvanced;
	this.advanced.toggle( !!this.showAdvanced );
	this.advancedToggle.setIndicator( this.showAdvanced ? 'up' : 'down' );

	this.storeEditSummary();
	this.storage.set( this.storagePrefix + '/showAdvanced', this.showAdvanced ? '1' : '' );
};

ReplyWidget.prototype.onEditSummaryChange = function () {
	this.storeEditSummary();
};

ReplyWidget.prototype.storeEditSummary = function () {
	this.storage.set( this.storagePrefix + '/summary', this.getEditSummary() );
};

ReplyWidget.prototype.getEditSummary = function () {
	return this.editSummaryInput.getValue();
};

ReplyWidget.prototype.onModeTabSelectChoose = function ( option ) {
	var mode = option.getData(),
		widget = this;

	if ( mode === this.getMode() ) {
		return;
	}

	this.modeTabSelect.setDisabled( true );
	this.switch( mode ).then(
		null,
		function () {
			// Switch failed, clear the tab selection
			widget.modeTabSelect.selectItem( null );
		}
	).always( function () {
		widget.modeTabSelect.setDisabled( false );
	} );
};

ReplyWidget.prototype.switch = function ( mode ) {
	var widget = this;

	if ( mode === this.getMode() ) {
		return $.Deferred().reject().promise();
	}

	var promise;
	this.setPending( true );
	switch ( mode ) {
		case 'source':
			promise = this.commentController.switchToWikitext();
			break;
		case 'visual':
			promise = this.commentController.switchToVisual();
			break;
	}
	// TODO: We rely on #setup to call #saveEditMode, so when we have 2017WTE
	// we will need to save the new preference here as switching will not
	// reload the editor.
	return promise.then( function () {
		// Switch succeeded
		mw.track( 'dt.schemaVisualEditorFeatureUse', {
			feature: 'editor-switch',
			action: (
				mode === 'visual' ?
					'visual' :
					( enable2017Wikitext ? 'source-nwe' : 'source' )
			) + '-desktop'
		} );
	} ).always( function () {
		widget.setPending( false );
	} );
};

/**
 * Setup the widget
 *
 * @param {Object} [data] Initial data
 * @param {Mixed} [data.value] Initial value
 * @param {string} [data.showAdvanced] Whether the "Advanced" menu is initially visible
 * @param {string} [data.editSummary] Initial edit summary
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.setup = function ( data ) {
	data = data || {};

	this.bindBeforeUnloadHandler();
	if ( this.modeTabSelect ) {
		// Make the option for the current mode disabled, to make it un-interactable
		// (we override the styles to make it look as if it was selected)
		this.modeTabSelect.findItemFromData( this.getMode() ).setDisabled( true );
	}
	this.saveEditMode( this.getMode() );

	var summary = this.storage.get( this.storagePrefix + '/summary' ) || data.editSummary;

	if ( !summary ) {
		if ( this.isNewTopic ) {
			// Edit summary is filled in when the user inputs the topic title,
			// in NewTopicController#onSectionTitleChange
			summary = '';
		} else {
			var title = this.comment.getHeading().getLinkableTitle();
			summary = ( title ? '/* ' + title + ' */ ' : '' ) +
				mw.msg( 'discussiontools-defaultsummary-reply' );
		}
	}

	this.toggleAdvanced(
		!!this.storage.get( this.storagePrefix + '/showAdvanced' ) ||
		!!+mw.user.options.get( 'discussiontools-showadvanced' ) ||
		!!data.showAdvanced
	);

	this.editSummaryInput.setValue( summary );

	if ( this.isNewTopic ) {
		this.commentController.sectionTitle.connect( this, { change: 'onInputChangeThrottled' } );
	} else {
		// De-indent replies on mobile
		if ( OO.ui.isMobile() ) {
			this.$element.css( 'margin-left', -this.$element.position().left );
		}
	}

	mw.hook( 'wikipage.watchlistChange' ).add( this.onWatchToggleHandler );

	return this;
};

/**
 * Perform additional actions once the widget has been setup and is ready for input
 */
ReplyWidget.prototype.afterSetup = function () {
	// Init preview and button state
	this.onInputChange();
	// Autosave
	this.storage.set( this.storagePrefix + '/mode', this.getMode() );
};

/**
 * Get a random token that is unique to this reply instance
 *
 * @return {string} Form token
 */
ReplyWidget.prototype.getFormToken = function () {
	var formToken = this.storage.get( this.storagePrefix + '/formToken' );
	if ( !formToken ) {
		// See ApiBase::PARAM_MAX_CHARS in ApiDiscussionToolsEdit.php
		var maxLength = 16;
		formToken = Math.random().toString( 36 ).slice( 2, maxLength + 2 );
		this.storage.set( this.storagePrefix + '/formToken', formToken );
	}
	return formToken;
};

/**
 * Try to teardown the widget, prompting the user if unsaved changes will be lost.
 *
 * @chainable
 * @return {jQuery.Promise} Resolves if widget was torn down, rejects if it wasn't
 */
ReplyWidget.prototype.tryTeardown = function () {
	var promise,
		widget = this;

	if ( !this.isEmpty() || ( this.isNewTopic && this.commentController.sectionTitle.getValue() ) ) {
		promise = OO.ui.getWindowManager().openWindow( this.isNewTopic ? 'abandontopic' : 'abandoncomment' )
			.closed.then( function ( data ) {
				if ( !( data && data.action === 'discard' ) ) {
					return $.Deferred().reject().promise();
				}
				logger( {
					action: 'abort',
					mechanism: 'cancel',
					type: 'abandon'
				} );
			} );
	} else {
		promise = $.Deferred().resolve().promise();
		logger( {
			action: 'abort',
			mechanism: 'cancel',
			type: 'nochange'
		} );
	}
	promise = promise.then( function () {
		widget.teardown( true );
	} );
	return promise;
};

/**
 * Teardown the widget
 *
 * @param {boolean} [abandoned] Widget was torn down after a reply was abandoned
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.teardown = function ( abandoned ) {
	if ( this.isNewTopic ) {
		this.commentController.sectionTitle.disconnect( this );
	}
	// Make sure that the selector is blurred before it gets removed from the document, otherwise
	// event handlers for arrow keys are not removed, and it keeps trying to switch modes (T274423)
	if ( this.modeTabSelect ) {
		this.modeTabSelect.blur();
	}
	this.unbindBeforeUnloadHandler();
	mw.hook( 'wikipage.watchlistChange' ).remove( this.onWatchToggleHandler );

	this.clear();
	this.emit( 'teardown', abandoned );
	return this;
};

/**
 * Handle changes to the watch state of the page
 *
 * @param {boolean} isWatched
 * @param {string} expiry
 * @param {string} expirySelected
 */
ReplyWidget.prototype.onWatchToggle = function ( isWatched ) {
	var widget = this;
	if ( this.pageName === mw.config.get( 'wgRelevantPageName' ) ) {
		this.checkboxesPromise.then( function ( checkboxes ) {
			if ( checkboxes.checkboxesByName.wpWatchthis ) {
				checkboxes.checkboxesByName.wpWatchthis.setSelected(
					!!mw.user.options.get( 'watchdefault' ) ||
					( !!mw.user.options.get( 'watchcreations' ) && !widget.pageExists ) ||
					isWatched
				);
			}
		} );
	}
};

/**
 * Handle key down events anywhere in the reply widget
 *
 * @param {boolean} isMultiline The current input is multiline
 * @param {jQuery.Event} e Key down event
 * @return {boolean} Return false to prevent default event
 */
ReplyWidget.prototype.onKeyDown = function ( isMultiline, e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.tryTeardown();
		return false;
	}

	// VE surfaces already handle CTRL+Enter, but this will catch
	// the plain surface, and the edit summary input.
	if ( e.which === OO.ui.Keys.ENTER && ( !isMultiline || e.ctrlKey || e.metaKey ) ) {
		this.onReplyClick();
		return false;
	}
};

/**
 * Handle input change events anywhere in the reply widget
 */
ReplyWidget.prototype.onInputChange = function () {
	this.updateButtons();
	this.storage.set( this.storagePrefix + '/saveable', this.isEmpty() ? '' : '1' );
	this.preparePreview();
};

/**
 * Update the interface with the preview of the given wikitext.
 *
 * @param {string} [wikitext] Wikitext to preview, defaults to current value
 * @return {jQuery.Promise} Promise resolved when we're done
 */
ReplyWidget.prototype.preparePreview = function ( wikitext ) {
	var widget = this;

	if ( this.getMode() !== 'source' ) {
		return $.Deferred().resolve().promise();
	}

	// For now, indentation is always ':'. If we need context-aware
	// indentation we would use the following:
	// indent = {
	//   dl: ':',
	//   ul: '*',
	//   ol: '#'
	// }[ this.context ];
	var indent = ':';
	wikitext = wikitext !== undefined ? wikitext : this.getValue();
	wikitext = utils.htmlTrim( wikitext );
	var title = this.isNewTopic && this.commentController.sectionTitle.getValue();

	if ( this.previewWikitext === wikitext && this.previewTitle === title ) {
		return $.Deferred().resolve().promise();
	}
	this.previewWikitext = wikitext;
	this.previewTitle = title;

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}

	var parsePromise;
	if ( !wikitext ) {
		parsePromise = $.Deferred().resolve( null ).promise();
	} else {
		wikitext = this.commentController.doIndentReplacements( wikitext, indent );

		if ( !modifier.isWikitextSigned( wikitext ) ) {
			// Add signature.
			var signature = mw.msg( 'discussiontools-signature-prefix' ) + '~~~~';
			// Drop opacity of signature in preview to make message body preview clearer.
			// Extract any leading spaces outside the <span> markup to ensure accurate previews.
			signature = signature.replace( /^( *)(.+)$/, function ( _, leadingSpaces, sig ) {
				return leadingSpaces + '<span style="opacity: 0.6;">' + sig + '</span>';
			} );
			wikitext += signature;
		}
		if ( title ) {
			wikitext = '== ' + title + ' ==\n' + wikitext;
		}
		this.previewRequest = parsePromise = controller.getApi().post( {
			action: 'parse',
			text: wikitext,
			pst: true,
			preview: true,
			disableeditsection: true,
			prop: [ 'text', 'modules', 'jsconfigvars' ],
			title: this.pageName
		} );
	}
	// TODO: Add list context

	return parsePromise.then( function ( response ) {
		widget.$preview.html( response ? response.parse.text : '' );

		if ( response ) {
			mw.config.set( response.parse.jsconfigvars );
			mw.loader.load( response.parse.modulestyles );
			mw.loader.load( response.parse.modules );
		}

		mw.hook( 'wikipage.content' ).fire( widget.$preview );
	} );
};

/**
 * Update buttons when widget state has changed
 */
ReplyWidget.prototype.updateButtons = function () {
	this.replyButton.setDisabled( this.isEmpty() );
};

/**
 * Handle the first change in the reply widget
 *
 * Currently only the first change in the body, used for logging.
 */
ReplyWidget.prototype.onFirstChange = function () {
	logger( { action: 'firstChange' } );
};

/**
 * Bind the beforeunload handler, if needed and if not already bound.
 *
 * @private
 */
ReplyWidget.prototype.bindBeforeUnloadHandler = function () {
	$( window ).on( 'beforeunload', this.beforeUnloadHandler );
	$( window ).on( 'unload', this.unloadHandler );
};

/**
 * Unbind the beforeunload handler if it is bound.
 *
 * @private
 */
ReplyWidget.prototype.unbindBeforeUnloadHandler = function () {
	$( window ).off( 'beforeunload', this.beforeUnloadHandler );
	$( window ).off( 'unload', this.unloadHandler );
};

/**
 * Respond to beforeunload event.
 *
 * @private
 * @param {jQuery.Event} e Event
 * @return {string|undefined}
 */
ReplyWidget.prototype.onBeforeUnload = function ( e ) {
	if ( !this.isEmpty() ) {
		e.preventDefault();
		return '';
	}
};

/**
 * Respond to unload event.
 *
 * @private
 * @param {jQuery.Event} e Event
 */
ReplyWidget.prototype.onUnload = function () {
	logger( {
		action: 'abort',
		type: this.isEmpty() ? 'nochange' : 'abandon',
		mechanism: 'navigate'
	} );
};

/**
 * Handle clicks on the reply button
 */
ReplyWidget.prototype.onReplyClick = function () {
	var widget = this;

	if ( this.pending || this.isEmpty() ) {
		return;
	}

	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}

	this.saveInitiated = mw.now();
	this.setPending( true );

	logger( { action: 'saveIntent' } );

	// TODO: When editing a transcluded page, VE API returning the page HTML is a waste, since we won't use it
	var pageName = this.pageName,
		comment = this.comment;
	logger( { action: 'saveAttempt' } );
	widget.commentController.save( comment, pageName ).fail( function ( code, data ) {
		// Compare to ve.init.mw.ArticleTargetEvents.js in VisualEditor.
		var typeMap = {
			badtoken: 'userBadToken',
			assertanonfailed: 'userNewUser',
			assertuserfailed: 'userNewUser',
			assertnameduserfailed: 'userNewUser',
			'abusefilter-disallowed': 'extensionAbuseFilter',
			'abusefilter-warning': 'extensionAbuseFilter',
			captcha: 'extensionCaptcha',
			spamblacklist: 'extensionSpamBlacklist',
			'titleblacklist-forbidden': 'extensionTitleBlacklist',
			pagedeleted: 'editPageDeleted',
			editconflict: 'editConflict'
		};

		if ( widget.captchaMessage ) {
			widget.captchaMessage.$element.detach();
		}
		widget.captchaInput = undefined;

		if ( OO.getProp( data, 'discussiontoolsedit', 'edit', 'captcha' ) ) {
			code = 'captcha';

			widget.captchaInput = new mw.libs.confirmEdit.CaptchaInputWidget(
				OO.getProp( data, 'discussiontoolsedit', 'edit', 'captcha' )
			);
			// Save when pressing 'Enter' in captcha field as it is single line.
			widget.captchaInput.on( 'enter', function () {
				widget.onReplyClick();
			} );

			widget.captchaMessage = new OO.ui.MessageWidget( {
				type: 'notice',
				label: widget.captchaInput.$element,
				classes: [ 'ext-discussiontools-ui-replyWidget-captcha' ]
			} );
			widget.captchaMessage.$element.insertAfter( widget.$preview );

			widget.captchaInput.focus();
			widget.captchaInput.scrollElementIntoView();

		} else {
			widget.errorMessage = new OO.ui.MessageWidget( {
				type: 'error',
				label: code instanceof Error ? code.toString() : controller.getApi().getErrorMessage( data ),
				classes: [ 'ext-discussiontools-ui-replyWidget-error' ]
			} );
			widget.errorMessage.$element.insertBefore( widget.replyBodyWidget.$element );
		}

		if ( code instanceof Error ) {
			code = 'exception';
		}
		// Log more precise error codes, mw.Api just gives us 'http' in all of these cases
		if ( data ) {
			if ( data.textStatus === 'timeout' || data.textStatus === 'abort' || data.textStatus === 'parsererror' ) {
				code = data.textStatus;
			} else if ( data.xhr ) {
				code = 'http-' + ( data.xhr.status || 0 );
			}
		}

		logger( {
			action: 'saveFailure',
			timing: mw.now() - widget.saveInitiated,
			message: code,
			type: typeMap[ code ] || 'responseUnknown'
		} );
	} ).always( function () {
		widget.setPending( false );
	} );
};

module.exports = ReplyWidget;
