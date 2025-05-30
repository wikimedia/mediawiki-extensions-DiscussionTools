const controller = require( 'ext.discussionTools.init' ).controller,
	utils = require( 'ext.discussionTools.init' ).utils,
	ModeTabSelectWidget = require( './ModeTabSelectWidget.js' ),
	ModeTabOptionWidget = require( './ModeTabOptionWidget.js' ),
	contLangMessages = require( './contLangMessages.json' ),
	licenseMessages = require( './licenseMessages.json' ),
	featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {},
	enable2017Wikitext = featuresEnabled.sourcemodetoolbar,
	dtConf = require( 'ext.discussionTools.init' ).config;

require( './AbandonCommentDialog.js' );
require( './AbandonTopicDialog.js' );

/**
 * DiscussionTools ReplyWidget class
 *
 * @class mw.dt.ReplyWidget
 * @extends OO.ui.Widget
 * @constructor
 * @param {CommentController} commentController Comment controller
 * @param {CommentDetails} commentDetails
 * @param {Object} [config] Configuration options
 * @param {Object} [config.input] Configuration options for the comment input widget
 */
function ReplyWidget( commentController, commentDetails, config ) {
	config = config || {};

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.pending = false;
	this.isTornDown = false;
	this.commentController = commentController;
	const threadItem = commentController.getThreadItem();
	this.commentDetails = commentDetails;
	this.isNewTopic = !!threadItem.isNewTopic;
	this.pageName = commentDetails.pageName;
	this.oldId = commentDetails.oldId;
	// pageExists can only be false for the new comment tool, so we
	// don't need to worry about transcluded replies.
	this.pageExists = mw.config.get( 'wgRelevantArticleId', 0 ) !== 0;
	const contextNode = utils.closestElement( threadItem.range.endContainer, [ 'dl', 'ul', 'ol' ] );
	this.context = contextNode ? contextNode.tagName.toLowerCase() : 'dl';
	this.storage = commentController.storage;
	// eslint-disable-next-line no-jquery/no-global-selector
	this.contentDir = $( '#mw-content-text' ).css( 'direction' );
	this.hideNewCommentsWarning = false;
	// Floating position for scroll back buttons: 'top', 'bottom', or null
	this.floating = null;

	this.$window = $( this.getElementWindow() );
	this.onWindowScrollThrottled = OO.ui.throttle( this.onWindowScroll.bind( this ), 100 );

	const inputConfig = Object.assign(
		{
			placeholder: this.isNewTopic ?
				mw.msg( 'discussiontools-replywidget-placeholder-newtopic' ) :
				mw.msg( 'discussiontools-replywidget-placeholder-reply', threadItem.author ),
			authors: this.isNewTopic ?
				// No suggestions in new topic tool yet (T277357)
				[] :
				// threadItem is a CommentItem when replying
				threadItem.getHeading().getAuthorsBelow()
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
		title: this.replyButtonLabel + ' [' +
			new ve.ui.Trigger( ve.ui.commandHelpRegistry.lookup( 'dialogConfirm' ).shortcuts[ 0 ] ).getMessage() +
			']',
		accessKey: mw.msg( 'discussiontools-replywidget-publish-accesskey' )
	} );
	this.cancelButton = new OO.ui.ButtonWidget( {
		flags: [ 'destructive' ],
		label: mw.msg( 'discussiontools-replywidget-cancel' ),
		framed: false,
		title: mw.msg( 'discussiontools-replywidget-cancel' ) + ' [' +
			new ve.ui.Trigger( ve.ui.commandHelpRegistry.lookup( 'dialogCancel' ).shortcuts[ 0 ] ).getMessage() +
			']'
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

	this.$bodyWrapper = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-bodyWrapper' ).append(
		this.replyBodyWidget.$element
	);

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

	this.enterWarning = new OO.ui.MessageWidget( {
		classes: [ 'ext-discussiontools-ui-replyWidget-enterWarning' ],
		type: 'warning',
		label: mw.msg(
			'discussiontools-replywidget-keyboard-shortcut-submit',
			new ve.ui.Trigger( ve.ui.commandHelpRegistry.lookup( 'dialogConfirm' ).shortcuts[ 0 ] ).getMessage()
		)
	} ).toggle( false );

	this.$footer = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-footer' );
	if ( this.pageName !== mw.config.get( 'wgRelevantPageName' ) ) {
		this.$footer.append( $( '<p>' ).append(
			mw.message( 'discussiontools-replywidget-transcluded', this.pageName ).parseDom()
		) );
	}
	const $footerLinks = $( '<ul>' ).addClass( 'ext-discussiontools-ui-replyWidget-footer-links' );
	if ( mw.user.isNamed() ) {
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
	if ( dtConf.showFeedbackLinks ) {
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
	}
	this.$footer.append(
		$( '<p>' ).addClass( 'plainlinks' ).html(
			this.isNewTopic ? licenseMessages.newtopic : licenseMessages.reply
		)
	);
	if ( $footerLinks.children().length ) {
		this.$footer.append( $footerLinks );
	}
	this.$actionsWrapper.append( this.$footer, this.$actions );

	this.viewportScrollContainer = OO.ui.Element.static.getClosestScrollableContainer( document.body );
	this.scrollBackTopButton = new OO.ui.ButtonWidget( {
		classes: [ 'ext-discussiontools-ui-replyWidget-scrollback-top mw-sticky-header-element' ],
		icon: 'collapse',
		label: mw.msg(
			this.isNewTopic ?
				'discussiontools-replywidget-return-to-newtopic' :
				'discussiontools-replywidget-return-to-reply'
		),
		flags: [ 'progressive' ]
	} );
	this.scrollBackBottomButton = new OO.ui.ButtonWidget( {
		classes: [ 'ext-discussiontools-ui-replyWidget-scrollback-bottom' ],
		icon: 'expand',
		label: mw.msg(
			this.isNewTopic ?
				'discussiontools-replywidget-return-to-newtopic' :
				'discussiontools-replywidget-return-to-reply'
		),
		flags: [ 'progressive' ]
	} );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: 'tryTeardown' } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this ) );
	this.beforeUnloadHandler = this.onBeforeUnload.bind( this );
	this.unloadHandler = this.onUnload.bind( this );
	this.onWatchToggleHandler = this.onWatchToggle.bind( this );
	this.advancedToggle.connect( this, { click: 'onAdvancedToggleClick' } );
	this.editSummaryInput.connect( this, { change: 'onEditSummaryChange' } );
	this.editSummaryInput.$input.on( 'keydown', this.onKeyDown.bind( this ) );
	if ( this.isNewTopic ) {
		this.commentController.sectionTitle.$input.on( 'keydown', this.onKeyDown.bind( this ) );
	}
	this.scrollBackTopButton.connect( this, { click: 'onScrollBackButtonClick' } );
	this.scrollBackBottomButton.connect( this, { click: 'onScrollBackButtonClick' } );

	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// Initialization
	this.$element.addClass( 'ext-discussiontools-ui-replyWidget' ).append(
		this.$headerWrapper,
		this.$bodyWrapper,
		this.$preview,
		this.advancedToggle.$element,
		this.advanced.$element,
		this.enterWarning.$element,
		this.$actionsWrapper,
		this.scrollBackTopButton.$element,
		this.scrollBackBottomButton.$element
	);
	// Set direction to interface direction
	this.$element.attr( 'dir', $( document.body ).css( 'direction' ) );
	if ( this.isNewTopic ) {
		this.$element.addClass( 'ext-discussiontools-ui-replyWidget-newTopic' );
	}

	if ( mw.user.isAnon() ) {
		const msg = this.commentDetails.wouldAutoCreate ?
			'discussiontools-replywidget-autocreate-warning' :
			'discussiontools-replywidget-anon-warning';
		const returnTo = {
			returntoquery: window.location.search.slice( 1 ),
			returnto: mw.config.get( 'wgPageName' )
		};
		this.anonWarning = new OO.ui.MessageWidget( {
			classes: [ 'ext-discussiontools-ui-replyWidget-anonWarning' ],
			type: 'warning',
			// eslint-disable-next-line mediawiki/msg-doc
			label: mw.message( msg )
				.params( [
					mw.util.getUrl( 'Special:Userlogin', returnTo ),
					mw.util.getUrl( 'Special:Userlogin/signup', returnTo ),
					contLangMessages[ 'tempuser-helppage' ]
				] )
				.parseDom()
		} );
		this.anonWarning.$element.append( this.$actions );
		this.anonWarning.$label.addClass( 'plainlinks' );
		this.$element.append( this.anonWarning.$element, this.$footer );
		this.$actionsWrapper.detach();
	}

	function trackCheckbox( n ) {
		mw.track( 'visualEditorFeatureUse', {
			feature: 'dtReply',
			action: 'checkbox-' + n
		} );
	}

	this.checkboxesPromise = controller.getCheckboxesPromise( this.pageName, this.oldId );
	this.checkboxesPromise.then( ( checkboxes ) => {
		if ( checkboxes.checkboxFields ) {
			this.$checkboxes = $( '<div>' ).addClass( 'ext-discussiontools-ui-replyWidget-checkboxes' );
			checkboxes.checkboxFields.forEach( ( field ) => {
				this.$checkboxes.append( field.$element );
			} );
			this.editSummaryField.$body.append( this.$checkboxes );

			// bind logging:
			for ( const name in checkboxes.checkboxesByName ) {
				checkboxes.checkboxesByName[ name ].$element.off( '.dtReply' ).on( 'click.dtReply', trackCheckbox.bind( this, name ) );
			}
		}
	} );
}

/* Inheritance */

OO.inheritClass( ReplyWidget, OO.ui.Widget );

/* Events */

/**
 * The widget has been torn down
 *
 * @event teardown
 * @param string mode Teardown mode. See #teardown.
 */

/**
 * The widget has had contents cleared
 *
 * @event clear
 */

/**
 * Auto save storage has been cleared for the widget
 *
 * @event clearStorage
 */

/**
 * The 'Reload page' button in the widget was clicked
 *
 * @event reloadPage
 */

/**
 * The reply widget is submitted
 *
 * @event submit
 */

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
 * Clear the save error message
 */
ReplyWidget.prototype.clearSaveErrorMessage = function () {
	if ( this.saveErrorMessage ) {
		this.saveErrorMessage.$element.remove();
		this.saveErrorMessage = null;
	}
};

/**
 * Restore the widget to its original state
 *
 * Clear any widget values, reset UI states, and clear
 * any (optional) auto-save values.
 *
 * @param {boolean} [preserveStorage] Preserve auto-save storage
 */
ReplyWidget.prototype.clear = function ( preserveStorage ) {
	this.clearSaveErrorMessage();

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}
	this.$preview.empty();
	this.previewWikitext = null;
	this.previewTitle = null;
	this.toggleAdvanced( false );

	if ( !preserveStorage ) {
		this.clearStorage();
	} else {
		this.storage.set( 'saveable', '1' );
	}

	this.emit( 'clear' );
};

/**
 * Remove any storage that the widget is using
 */
ReplyWidget.prototype.clearStorage = function () {
	this.storage.clear();
	this.emit( 'clearStorage' );
};

/**
 * Handle window scroll events
 */
ReplyWidget.prototype.onWindowScroll = function () {
	const rect = this.$element[ 0 ].getBoundingClientRect();
	const viewportHeight = window.visualViewport ? visualViewport.height : this.viewportScrollContainer.clientHeight;
	const floating = rect.bottom < 0 ? 'top' :
		( rect.top > viewportHeight ? 'bottom' : null );

	if ( floating !== this.floating ) {
		this.floating = floating;
		// Always remove classes as we have switched directly from top to bottom with a fast scroll
		this.$element
			.removeClass( 'ext-discussiontools-ui-replyWidget-floating-top ext-discussiontools-ui-replyWidget-floating-bottom' );

		if ( this.floating ) {
			// The following classes are used here:
			// * ext-discussiontools-ui-replyWidget-floating-top
			// * ext-discussiontools-ui-replyWidget-floating-bottom
			this.$element.addClass( 'ext-discussiontools-ui-replyWidget-floating-' + this.floating );
		}
	}
};

ReplyWidget.prototype.setPending = function ( pending ) {
	this.pending = pending;
	if ( pending ) {
		this.cancelButton.setDisabled( true );
		this.replyBodyWidget.setReadOnly( true );
		this.replyBodyWidget.pushPending();
	} else {
		this.cancelButton.setDisabled( false );
		this.replyBodyWidget.setReadOnly( false );
		this.replyBodyWidget.popPending();
	}
	this.updateButtons();
};

/**
 * Display an error and prevent this reply from being saved.
 *
 * @param {string} code Error code
 * @param {Object} data Error data
 */
ReplyWidget.prototype.setLoadingError = function ( code, data ) {
	this.setSaveErrorMessage( code, data );
	this.loadingFailed = true;
	this.updateButtons();
	// Hide mode switcher - not using setDisabled() because it has weird styles that make both buttons look selected
	this.modeTabSelect.toggle( false );
};

ReplyWidget.prototype.saveEditMode = function ( mode ) {
	controller.getApi().saveOption( 'discussiontools-editmode', mode ).then( () => {
		mw.user.options.set( 'discussiontools-editmode', mode );
	} );
};

ReplyWidget.prototype.onAdvancedToggleClick = function () {
	const showAdvanced = !this.showAdvanced;
	mw.track( 'visualEditorFeatureUse', {
		feature: 'dtReply',
		action: 'advanced-' + ( showAdvanced ? 'show' : 'hide' )
	} );
	controller.getApi().saveOption( 'discussiontools-showadvanced', +showAdvanced ).then( () => {
		mw.user.options.set( 'discussiontools-showadvanced', +showAdvanced );
	} );
	this.toggleAdvanced( showAdvanced );

	if ( showAdvanced ) {
		const summary = this.editSummaryInput.getValue();

		// If the current summary has not been edited yet, select the text following the autocomment to
		// make it easier to change. Otherwise, move cursor to end.
		let selectFromIndex = summary.length;
		if ( this.isNewTopic ) {
			const titleText = this.commentController.sectionTitle.getValue();
			if ( summary === this.commentController.generateSummary( titleText ) ) {
				selectFromIndex = titleText.length + '/* '.length + ' */ '.length;
			}
		} else {
			const defaultReply = mw.msg( 'discussiontools-defaultsummary-reply' );
			const defaultReplyTrail = '*/ ' + defaultReply;
			if ( summary.endsWith( defaultReplyTrail ) ) {
				selectFromIndex = summary.length - defaultReply.length;
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

	this.storage.set( 'showAdvanced', this.showAdvanced ? '1' : '' );
};

ReplyWidget.prototype.showEnterWarning = function () {
	this.enterWarning.toggle( true );
};

ReplyWidget.prototype.onEditSummaryChange = function () {
	this.commentController.storeEditSummary();
};

ReplyWidget.prototype.getEditSummary = function () {
	return this.editSummaryInput.getValue();
};

ReplyWidget.prototype.onModeTabSelectChoose = function ( option ) {
	const mode = option.getData();

	if ( mode === this.getMode() ) {
		return;
	}

	this.modeTabSelect.setDisabled( true );
	this.switch( mode ).then(
		null,
		() => {
			// Switch failed, clear the tab selection
			this.modeTabSelect.selectItem( null );
		}
	).always( () => {
		this.modeTabSelect.setDisabled( false );
	} );
};

ReplyWidget.prototype.switch = function ( mode ) {
	if ( mode === this.getMode() ) {
		return $.Deferred().reject().promise();
	}

	let promise;
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
	return promise.then( () => {
		// Switch succeeded
		mw.track( 'visualEditorFeatureUse', {
			feature: 'editor-switch',
			action: (
				mode === 'visual' ?
					'visual' :
					( enable2017Wikitext ? 'source-nwe' : 'source' )
			) + '-desktop'
		} );
	} ).always( () => {
		this.setPending( false );
	} );
};

/**
 * Setup the widget
 *
 * @param {Object} [data] Initial data
 * @param {any} [data.value] Initial value
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

	let summary = this.storage.get( 'summary' ) || data.editSummary;

	if ( !summary ) {
		if ( this.isNewTopic ) {
			// Edit summary is filled in when the user inputs the topic title,
			// in NewTopicController#onSectionTitleChange
			summary = '';
		} else {
			const title = this.commentController.getThreadItem().getHeading().getLinkableTitle();
			summary = ( title ? '/* ' + title + ' */ ' : '' ) +
				mw.msg( 'discussiontools-defaultsummary-reply' );
		}
	}

	this.toggleAdvanced(
		!!this.storage.get( 'showAdvanced' ) ||
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

	this.$window[ 0 ].addEventListener( 'scroll', this.onWindowScrollThrottled, { passive: true } );

	return this;
};

/**
 * Perform additional actions once the widget has been setup and is ready for input
 */
ReplyWidget.prototype.afterSetup = function () {
	// Init preview and button state
	this.onInputChange();
	// Autosave
	this.storage.set( 'mode', this.getMode() );
};

/**
 * Get a random token that is unique to this reply instance
 *
 * @return {string} Form token
 */
ReplyWidget.prototype.getFormToken = function () {
	let formToken = this.storage.get( 'formToken' );
	if ( !formToken ) {
		// See ApiBase::PARAM_MAX_CHARS in ApiDiscussionToolsEdit.php
		const maxLength = 16;
		formToken = Math.random().toString( 36 ).slice( 2, maxLength + 2 );
		this.storage.set( 'formToken', formToken );
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
	let promise;

	if ( !this.isEmpty() || ( this.isNewTopic && this.commentController.sectionTitle.getValue() ) ) {
		promise = OO.ui.getWindowManager().openWindow( this.isNewTopic ? 'abandontopic' : 'abandoncomment' )
			.closed.then( ( data ) => {
				if ( !( data && data.action === 'discard' ) ) {
					return $.Deferred().reject().promise();
				}
				mw.track( 'editAttemptStep', {
					action: 'abort',
					mechanism: 'cancel',
					type: 'abandon'
				} );
			} );
	} else {
		promise = $.Deferred().resolve().promise();
		mw.track( 'editAttemptStep', {
			action: 'abort',
			mechanism: 'cancel',
			type: 'nochange'
		} );
	}
	promise = promise.then( () => {
		this.teardown( 'abandoned' );
	} );
	return promise;
};

/**
 * Teardown the widget
 *
 * @param {string} [mode] Teardown mode:
 *  - 'default': The reply was saved and can be discarded
 *  - 'abandoned': The reply was abandoned and discarded
 *  - 'refresh': The page is being refreshed, preserve auto-save
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.teardown = function ( mode ) {
	// Call the change handler to save the current value in auto-save
	this.onInputChange();

	if ( this.isNewTopic ) {
		this.commentController.sectionTitle.disconnect( this );
	}
	// Make sure that the selector is blurred before it gets removed from the document, otherwise
	// event handlers for arrow keys are not removed, and it keeps trying to switch modes (T274423)
	if ( this.modeTabSelect ) {
		this.modeTabSelect.blur();
	}
	this.unbindBeforeUnloadHandler();
	this.$window[ 0 ].removeEventListener( 'scroll', this.onWindowScrollThrottled );
	mw.hook( 'wikipage.watchlistChange' ).remove( this.onWatchToggleHandler );

	this.isTornDown = true;
	this.clear( mode === 'refresh' );
	this.emit( 'teardown', mode );
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
	if ( this.pageName === mw.config.get( 'wgRelevantPageName' ) ) {
		this.checkboxesPromise.then( ( checkboxes ) => {
			if ( checkboxes.checkboxesByName.wpWatchthis ) {
				checkboxes.checkboxesByName.wpWatchthis.setSelected(
					!!mw.user.options.get( 'watchdefault' ) ||
					( !!mw.user.options.get( 'watchcreations' ) && !this.pageExists ) ||
					isWatched
				);
			}
		} );
	}
};

/**
 * Handle key down events anywhere in the reply widget
 *
 * @param {jQuery.Event} e Key down event
 * @return {boolean|undefined} Return false to prevent default event
 */
ReplyWidget.prototype.onKeyDown = function ( e ) {
	if ( e.which === OO.ui.Keys.ESCAPE ) {
		this.tryTeardown();
		return false;
	}

	if ( e.which === OO.ui.Keys.ENTER ) {
		if ( e.ctrlKey || e.metaKey ) {
			// VE surfaces already handle CTRL+Enter, but this will catch
			// the plain surface, and the edit summary input.
			// Check we are in one of the form inputs, as the user can focus a link and
			// press CTRL+Enter to open it in a new tab (T382401)
			if ( this.$bodyWrapper[ 0 ].contains( e.target ) || e.target.tagName === 'INPUT' ) {
				this.onReplyClick();
				return false;
			}
		} else if (
			// Require CTRL+Enter even on single line inputs per T326500.
			e.target.tagName === 'INPUT' && !this.replyButton.isDisabled() &&
			// Ignore the body wrapper as it can contain VE UI widgets that you may need to press enter within
			!this.$bodyWrapper[ 0 ].contains( e.target )
		) {
			this.showEnterWarning();
			return false;
		}
	}
};

/**
 * Handle input change events anywhere in the reply widget
 */
ReplyWidget.prototype.onInputChange = function () {
	if ( this.isTornDown ) {
		// Ignore calls after teardown, which would clear the auto-save or crash
		return;
	}

	this.updateButtons();
	this.storage.set( 'saveable', this.isEmpty() ? '' : '1' );
	this.preparePreview();
};

/**
 * Update the interface with the preview of the given wikitext.
 *
 * @param {string} [wikitext] Wikitext to preview, defaults to current value
 * @return {jQuery.Promise} Promise resolved when we're done
 */
ReplyWidget.prototype.preparePreview = function ( wikitext ) {
	if ( this.getMode() !== 'source' ) {
		return $.Deferred().resolve().promise();
	}

	wikitext = wikitext !== undefined ? wikitext : this.getValue();
	wikitext = utils.htmlTrim( wikitext );
	const title = this.isNewTopic && this.commentController.sectionTitle.getValue();

	if ( this.previewWikitext === wikitext && this.previewTitle === title ) {
		return $.Deferred().resolve().promise();
	}
	this.previewWikitext = wikitext;
	this.previewTitle = title;

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}

	let parsePromise;
	if ( !wikitext ) {
		parsePromise = $.Deferred().resolve( null ).promise();
	} else {
		// Acquire a temporary user username before previewing, so that signatures and
		// user-related magic words display the temp user instead of IP user in the preview. (T331397)
		parsePromise = mw.user.acquireTempUserName().then( () => {
			this.previewRequest = controller.getApi().post( {
				action: 'discussiontoolspreview',
				type: this.isNewTopic ? 'topic' : 'reply',
				page: this.pageName,
				wikitext: wikitext,
				sectiontitle: title,
				useskin: mw.config.get( 'skin' ),
				mobileformat: OO.ui.isMobile()
			} );
			return this.previewRequest;
		} );
	}

	return parsePromise.then( ( response ) => {
		this.$preview.html( response ? response.discussiontoolspreview.parse.text : '' );

		if ( response ) {
			mw.config.set( response.discussiontoolspreview.parse.jsconfigvars );
			mw.loader.load( response.discussiontoolspreview.parse.modulestyles );
			mw.loader.load( response.discussiontoolspreview.parse.modules );
		}

		mw.hook( 'wikipage.content' ).fire( this.$preview );
	} );
};

/**
 * Update buttons when widget state has changed
 */
ReplyWidget.prototype.updateButtons = function () {
	this.replyButton.setDisabled( this.pending || this.isEmpty() || this.loadingFailed );
};

/**
 * Handle the first change in the reply widget
 *
 * Currently only the first change in the body, used for logging.
 */
ReplyWidget.prototype.onFirstChange = function () {
	mw.track( 'editAttemptStep', { action: 'firstChange' } );
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
	mw.track( 'editAttemptStep', {
		action: 'abort',
		type: this.isEmpty() ? 'nochange' : 'abandon',
		mechanism: 'navigate'
	} );
};

ReplyWidget.prototype.updateParentRemovedError = function ( parentRemoved ) {
	if ( !parentRemoved ) {
		if ( this.parentRemovedErrorMessage ) {
			this.parentRemovedErrorMessage.$element.remove();
			this.parentRemovedErrorMessage = null;
		}
		return;
	}
	if ( !this.parentRemovedErrorMessage ) {
		this.parentRemovedErrorMessage = this.createErrorMessage( mw.msg( 'discussiontools-error-comment-disappeared' ) );
	}
	// Don't show the reload prompt if there is nothing to reply to
	this.updateNewCommentsWarning( [] );
};

/**
 * Update "new comments" warning based on list of new comments found
 *
 * @param {Object[]} comments Array of JSON-serialized CommentItem's
 */
ReplyWidget.prototype.updateNewCommentsWarning = function ( comments ) {
	if ( !comments.length ) {
		if ( this.newCommentsWarning ) {
			this.newCommentsWarning.toggle( false );
		}
		return;
	}
	// Don't show the reload prompt if there is nothing to reply to
	if ( this.parentRemovedErrorMessage ) {
		return;
	}
	if ( !this.newCommentsWarning ) {
		this.newCommentsShow = new OO.ui.ButtonWidget( {
			flags: [ 'progressive' ]
		} );
		this.newCommentsClose = new OO.ui.ButtonWidget( {
			icon: 'close',
			label: mw.msg( 'ooui-popup-widget-close-button-aria-label' ),
			invisibleLabel: true
		} );
		this.newCommentsWarning = new OO.ui.ButtonGroupWidget( {
			classes: [ 'ext-discussiontools-ui-replyWidget-newComments' ],
			items: [
				this.newCommentsShow,
				this.newCommentsClose
			]
		} );
		this.newCommentsShow.connect( this, { click: 'onNewCommentsShowClick' } );
		this.newCommentsClose.connect( this, { click: 'onNewCommentsCloseClick' } );
		this.$bodyWrapper.append( this.newCommentsWarning.$element );
	}

	this.newCommentsShow.setLabel(
		mw.msg( 'discussiontools-replywidget-newcomments-button', mw.language.convertNumber( comments.length ) )
	);
	if ( !this.hideNewCommentsWarning ) {
		this.newCommentsWarning.toggle( true );
		setTimeout( () => {
			this.newCommentsWarning.$element.addClass( 'ext-discussiontools-ui-replyWidget-newComments-open' );
		} );
		mw.track( 'visualEditorFeatureUse', {
			feature: 'notificationNewComments',
			action: 'show'
		} );
	}
};

/**
 * Handle click events on the new comments show button
 */
ReplyWidget.prototype.onNewCommentsShowClick = function () {
	this.emit( 'reloadPage' );
	mw.track( 'visualEditorFeatureUse', {
		feature: 'notificationNewComments',
		action: 'page-update'
	} );
	mw.track( 'editAttemptStep', {
		action: 'abort',
		mechanism: 'navigate',
		type: 'pageupdate'
	} );
};

/**
 * Handle click events on the new comments close button
 */
ReplyWidget.prototype.onNewCommentsCloseClick = function () {
	this.newCommentsWarning.toggle( false );
	// Hide the warning for the rest of the lifetime of the widget
	this.hideNewCommentsWarning = true;
	this.focus();
	mw.track( 'visualEditorFeatureUse', {
		feature: 'notificationNewComments',
		action: 'close'
	} );
};

/**
 * Create an error message widget and attach it to the DOM
 *
 * @param {string} message Message string
 * @return {OO.ui.MessageWidget} Message widget
 */
ReplyWidget.prototype.createErrorMessage = function ( message ) {
	const errorMessage = new OO.ui.MessageWidget( {
		type: 'error',
		label: message,
		classes: [ 'ext-discussiontools-ui-replyWidget-error' ]
	} );
	errorMessage.$element.insertBefore( this.replyBodyWidget.$element );
	errorMessage.scrollElementIntoView();
	return errorMessage;
};

/**
 * Handle clicks on the reply button
 *
 * @fires submit
 */
ReplyWidget.prototype.onReplyClick = function () {
	if ( this.pending || this.isEmpty() || this.loadingFailed ) {
		return;
	}

	this.emit( 'submit' );
};

/**
 * Set the save error message
 *
 * @param {string} code Error code
 * @param {Object} data Error data
 */
ReplyWidget.prototype.setSaveErrorMessage = function ( code, data ) {
	if ( !(
		// Don't duplicate the parentRemovedErrorMessage
		code === 'discussiontools-commentname-notfound' && this.parentRemovedErrorMessage
	) ) {
		this.saveErrorMessage = this.createErrorMessage(
			code instanceof Error ? code.toString() : controller.getApi().getErrorMessage( data )
		);
	}
};

/**
 * Clear the captcha input
 */
ReplyWidget.prototype.clearCaptcha = function () {
	if ( this.captchaMessage ) {
		this.captchaMessage.$element.detach();
	}
	this.captchaInput = undefined;
};

/**
 * Set the captcha input
 *
 * @param {Object} captchaData Captcha data
 */
ReplyWidget.prototype.setCaptcha = function ( captchaData ) {
	this.captchaInput = new mw.libs.confirmEdit.CaptchaInputWidget( captchaData );
	// Save when pressing 'Enter' in captcha field as it is single line.
	this.captchaInput.on( 'enter', () => {
		this.emit( 'reply' );
	} );

	this.captchaMessage = new OO.ui.MessageWidget( {
		type: 'notice',
		label: this.captchaInput.$element,
		classes: [ 'ext-discussiontools-ui-replyWidget-captcha' ]
	} );
	this.captchaMessage.$element.insertAfter( this.$preview );

	this.captchaInput.focus();
	this.captchaInput.scrollElementIntoView();
};

/**
 * Handle click events on one of the scroll back buttons
 */
ReplyWidget.prototype.onScrollBackButtonClick = function () {
	this.commentController.showAndFocus();
};

module.exports = ReplyWidget;
