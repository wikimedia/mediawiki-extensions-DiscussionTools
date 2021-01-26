var controller = require( 'ext.discussionTools.init' ).controller,
	modifier = require( 'ext.discussionTools.init' ).modifier,
	utils = require( 'ext.discussionTools.init' ).utils,
	logger = require( 'ext.discussionTools.init' ).logger;

require( './AbandonCommentDialog.js' );
require( './AbandonTopicDialog.js' );

/**
 * @external CommentController
 * @external CommentItem
 */

/**
 * DiscussionTools ReplyWidget class
 *
 * @class mw.dt.ReplyWidget
 * @extends OO.ui.Widget
 * @constructor
 * @param {CommentController} commentController Comment controller
 * @param {CommentItem} comment Comment item
 * @param {string} pageName Page name the reply is being saved to
 * @param {number} oldId Revision ID of page at time of editing
 * @param {Object} [config] Configuration options
 * @param {Object} [config.input] Configuration options for the comment input widget
 */
function ReplyWidget( commentController, comment, pageName, oldId, config ) {
	var returnTo, contextNode, inputConfig,
		widget = this;

	config = config || {};

	// Parent constructor
	ReplyWidget.super.call( this, config );

	this.pending = false;
	this.commentController = commentController;
	this.comment = comment;
	this.isNewTopic = !!comment.isNewTopic;
	this.pageName = pageName;
	this.oldId = oldId;
	contextNode = utils.closestElement( comment.range.endContainer, [ 'dl', 'ul', 'ol' ] );
	this.context = contextNode ? contextNode.nodeName.toLowerCase() : 'dl';
	// TODO: Should storagePrefix include pageName?
	this.storagePrefix = 'reply/' + comment.id;
	this.storage = mw.storage.session;
	// eslint-disable-next-line no-jquery/no-global-selector
	this.contentDir = $( '#mw-content-text' ).css( 'direction' );

	inputConfig = $.extend(
		{
			placeholder: this.isNewTopic ?
				mw.msg( 'discussiontools-replywidget-placeholder-newtopic' ) :
				mw.msg( 'discussiontools-replywidget-placeholder-reply', comment.author ),
			authors: comment.getHeading().getAuthorsBelow()
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

	this.modeTabSelect = new OO.ui.TabSelectWidget( {
		classes: [ 'dt-ui-replyWidget-modeTabs' ],
		items: [
			new OO.ui.TabOptionWidget( {
				label: mw.msg( 'discussiontools-replywidget-mode-visual' ),
				data: 'visual'
			} ),
			new OO.ui.TabOptionWidget( {
				label: mw.msg( 'discussiontools-replywidget-mode-source' ),
				data: 'source'
			} )
		],
		framed: false
	} );
	// Initialize to avoid flicker when switching mode
	this.modeTabSelect.selectItemByData( this.getMode() );

	this.$headerWrapper = $( '<div>' ).addClass( 'dt-ui-replyWidget-headerWrapper' );
	this.$headerWrapper.append(
		// (visual mode toolbar magically appears here)
		this.modeTabSelect.$element
	);

	this.$preview = $( '<div>' )
		.addClass( 'dt-ui-replyWidget-preview' )
		.attr( 'data-label', mw.msg( 'discussiontools-replywidget-preview' ) )
		// Set preview direction to content direction
		.attr( 'dir', this.contentDir );
	this.$actionsWrapper = $( '<div>' ).addClass( 'dt-ui-replyWidget-actionsWrapper' );
	this.$actions = $( '<div>' ).addClass( 'dt-ui-replyWidget-actions' ).append(
		this.cancelButton.$element,
		this.replyButton.$element
	);

	this.editSummaryInput = new OO.ui.TextInputWidget( {
		classes: [ 'dt-ui-replyWidget-editSummary' ]
	} );
	mw.widgets.visibleCodePointLimit( this.editSummaryInput, mw.config.get( 'wgCommentCodePointLimit' ) );

	this.editSummaryField = new OO.ui.FieldLayout(
		this.editSummaryInput,
		{
			align: 'top',
			classes: [ 'dt-ui-replyWidget-editSummaryField' ],
			label: mw.msg( 'discussiontools-replywidget-summary' )
		}
	);

	this.advancedToggle = new OO.ui.ButtonWidget( {
		label: mw.msg( 'discussiontools-replywidget-advanced' ),
		indicator: 'down',
		framed: false,
		flags: [ 'progressive' ],
		classes: [ 'dt-ui-replyWidget-advancedToggle' ]
	} );
	this.advanced = new OO.ui.MessageWidget( {
		type: 'message',
		$content: this.editSummaryField.$element,
		classes: [ 'dt-ui-replyWidget-advanced' ]
	} ).toggle( false ).setIcon( '' );

	this.$footer = $( '<div>' ).addClass( 'dt-ui-replyWidget-footer' );
	if ( this.pageName !== mw.config.get( 'wgRelevantPageName' ) ) {
		this.$footer.append( $( '<p>' ).append(
			mw.message( 'discussiontools-replywidget-transcluded', this.pageName ).parseDom()
		) );
	}
	this.$footer.append(
		$( '<p>' ).addClass( 'plainlinks' ).append(
			mw.message( 'discussiontools-replywidget-terms-click', this.replyButtonLabel ).parseDom()
		),
		$( '<p>' ).append(
			$( '<a>' )
				.attr( {
					href: mw.msg( 'discussiontools-replywidget-feedback-link' ),
					target: '_blank',
					rel: 'noopener'
				} )
				.text( mw.msg( 'discussiontools-replywidget-feedback' ) )
		)
	);
	this.$actionsWrapper.append( this.$footer, this.$actions );

	// Events
	this.replyButton.connect( this, { click: 'onReplyClick' } );
	this.cancelButton.connect( this, { click: 'tryTeardown' } );
	this.$element.on( 'keydown', this.onKeyDown.bind( this, true ) );
	this.beforeUnloadHandler = this.onBeforeUnload.bind( this );
	this.unloadHandler = this.onUnload.bind( this );
	this.modeTabSelect.connect( this, {
		choose: 'onModeTabSelectChoose'
	} );
	this.advancedToggle.connect( this, { click: 'onAdvancedToggleClick' } );
	this.editSummaryInput.connect( this, { change: 'onEditSummaryChange' } );
	this.editSummaryInput.$input.on( 'keydown', this.onKeyDown.bind( this, false ) );
	if ( this.isNewTopic ) {
		this.commentController.sectionTitle.$input.on( 'keydown', this.onKeyDown.bind( this, false ) );
	}

	this.onInputChangeThrottled = OO.ui.throttle( this.onInputChange.bind( this ), 1000 );

	// Initialization
	this.$element.addClass( 'dt-ui-replyWidget' ).append(
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
		this.$element.addClass( 'dt-ui-replyWidget-newTopic' );
	}

	if ( mw.user.isAnon() ) {
		returnTo = {
			returntoquery: encodeURIComponent( window.location.search ),
			returnto: mw.config.get( 'wgPageName' )
		};
		this.anonWarning = new OO.ui.MessageWidget( {
			classes: [ 'dt-ui-replyWidget-anonWarning' ],
			type: 'warning',
			label: mw.message( 'discussiontools-replywidget-anon-warning' )
				.params( [
					mw.util.getUrl( 'Special:Userlogin', returnTo ),
					mw.util.getUrl( 'Special:Userlogin/signup', returnTo )
				] )
				.parseDom()
		} );
		this.anonWarning.$element.append( this.$actions );
		this.$element.append( this.anonWarning.$element, this.$footer );
		this.$actionsWrapper.detach();
	}

	this.checkboxesPromise = controller.getCheckboxesPromise( this.pageName, this.oldId );
	this.checkboxesPromise.then( function ( checkboxes ) {
		var name;
		function trackCheckbox( n ) {
			mw.track( 'dt.schemaVisualEditorFeatureUse', {
				feature: 'dtReply',
				action: 'checkbox-' + n
			} );
		}
		if ( checkboxes.checkboxFields ) {
			widget.$checkboxes = $( '<div>' ).addClass( 'dt-ui-replyWidget-checkboxes' );
			checkboxes.checkboxFields.forEach( function ( field ) {
				widget.$checkboxes.append( field.$element );
			} );
			widget.advanced.$element.prepend( widget.$checkboxes );

			// bind logging:
			for ( name in checkboxes.checkboxesByName ) {
				checkboxes.checkboxesByName[ name ].$element.off( '.dtReply' ).on( 'click.dtReply', trackCheckbox.bind( this, name ) );
			}
		}
	} );
}

/* Inheritance */

OO.inheritClass( ReplyWidget, OO.ui.Widget );

/* Methods */

ReplyWidget.prototype.createReplyBodyWidget = null;

/**
 * Focus the widget
 *
 * @method
 * @chainable
 * @return {ReplyWidget}
 */
ReplyWidget.prototype.focus = null;

ReplyWidget.prototype.getValue = null;

ReplyWidget.prototype.isEmpty = null;

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
	if ( this.isNewTopic ) {
		this.commentController.sectionTitleField.setWarnings( [] );
		this.warnedAboutMissingTitle = false;
	}
	this.$preview.empty();
	this.previewWikitext = null;
	this.previewTitle = null;
	this.toggleAdvanced( false );

	this.storage.remove( this.storagePrefix + '/mode' );
	this.storage.remove( this.storagePrefix + '/saveable' );
	this.storage.remove( this.storagePrefix + '/summary' );
	this.storage.remove( this.storagePrefix + '/showAdvanced' );
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
	var
		summary, selectFromIndex, titleText, defaultReplyTrail, endCommentIndex,
		showAdvanced = !this.showAdvanced;
	mw.track( 'dt.schemaVisualEditorFeatureUse', {
		feature: 'dtReply',
		action: 'advanced-' + ( showAdvanced ? 'show' : 'hide' )
	} );
	controller.getApi().saveOption( 'discussiontools-showadvanced', +showAdvanced ).then( function () {
		mw.user.options.set( 'discussiontools-showadvanced', +showAdvanced );
	} );
	this.toggleAdvanced( showAdvanced );

	if ( showAdvanced ) {
		summary = this.editSummaryInput.getValue();

		// If the current summary has not been edited yet, select the text following the autocomment to
		// make it easier to change. Otherwise, move cursor to end.
		selectFromIndex = summary.length;
		if ( this.isNewTopic ) {
			titleText = this.commentController.sectionTitle.getValue();
			if ( summary === this.commentController.generateSummary( titleText ) ) {
				selectFromIndex = titleText.length + '/* '.length + ' */ '.length;
			}
		} else {
			// Same as summary.endsWith( defaultReplyTrail )
			defaultReplyTrail = '*/ ' + mw.msg( 'discussiontools-defaultsummary-reply' );
			endCommentIndex = summary.indexOf( defaultReplyTrail );
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
	var promise,
		mode = option.getData(),
		widget = this;

	if ( mode === this.getMode() ) {
		return;
	}

	this.setPending( true );
	this.modeTabSelect.setDisabled( true );
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
	promise.then( function () {
		// Switch succeeded
		mw.track( 'dt.schemaVisualEditorFeatureUse', {
			feature: 'editor-switch',
			// TODO: Log as `source-nwe-desktop` when enable2017Wikitext is set
			action: ( mode === 'visual' ? 'visual' : 'source' ) + '-desktop'
		} );
	}, function () {
		// Switch failed, restore previous tab selection
		widget.modeTabSelect.selectItemByData( mode === 'source' ? 'visual' : 'source' );
	} ).always( function () {
		widget.setPending( false );
		widget.modeTabSelect.setDisabled( false );
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
	var title, summary;

	data = data || {};

	this.bindBeforeUnloadHandler();
	if ( this.modeTabSelect ) {
		this.modeTabSelect.selectItemByData( this.getMode() );
		this.saveEditMode( this.getMode() );
	}

	summary = this.storage.get( this.storagePrefix + '/summary' ) || data.editSummary;

	if ( !summary ) {
		if ( this.isNewTopic ) {
			// Edit summary is filled in when the user inputs the topic title,
			// in NewTopicController#onSectionTitleChange
			summary = '';
		} else {
			title = this.comment.getHeading().getLinkableTitle();
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
	}

	return this;
};

ReplyWidget.prototype.afterSetup = function () {
	// Init preview and button state
	this.onInputChange();
	// Autosave
	this.storage.set( this.storagePrefix + '/mode', this.getMode() );
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
	this.unbindBeforeUnloadHandler();
	this.clear();
	this.emit( 'teardown', abandoned );
	return this;
};

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
	var parsePromise, widget, title, indent;

	if ( this.getMode() !== 'source' ) {
		return $.Deferred().resolve().promise();
	}

	widget = this;
	// For now, indentation is always ':'. If we need context-aware
	// indentation we would use the following:
	// indent = {
	//   dl: ':',
	//   ul: '*',
	//   ol: '#'
	// }[ this.context ];
	indent = ':';
	wikitext = wikitext || this.getValue();
	title = this.isNewTopic && this.commentController.sectionTitle.getValue();

	if ( this.previewWikitext === wikitext && this.previewTitle === title ) {
		return $.Deferred().resolve().promise();
	}
	this.previewWikitext = wikitext;
	this.previewTitle = title;

	if ( this.previewRequest ) {
		this.previewRequest.abort();
		this.previewRequest = null;
	}

	if ( !wikitext.trim() ) {
		parsePromise = $.Deferred().resolve( null ).promise();
	} else {
		wikitext = this.commentController.doCrazyIndentReplacements( wikitext, indent );

		if ( !modifier.isWikitextSigned( wikitext ) ) {
			// Add signature.
			// Drop opacity of signature in preview to make message body preview clearer.
			wikitext = wikitext + '<span style="opacity: 0.6;">' + mw.msg( 'discussiontools-signature-prefix' ) + '~~~~</span>';
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
	} );
};

ReplyWidget.prototype.updateButtons = function () {
	this.replyButton.setDisabled( this.isEmpty() );
};

ReplyWidget.prototype.onFirstTransaction = function () {
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

ReplyWidget.prototype.onReplyClick = function () {
	var widget = this,
		pageName = this.pageName,
		comment = this.comment;

	if ( this.pending || this.isEmpty() ) {
		return;
	}

	if ( this.isNewTopic ) {
		if ( !this.commentController.sectionTitle.getValue() ) {
			// Show warning about missing title
			this.commentController.sectionTitleField.setWarnings( [
				mw.msg( 'discussiontools-newtopic-missing-title' )
			] );
			this.commentController.sectionTitle.focus();

			// Prevent submitting once, then allow if the warning was already shown
			if ( !this.warnedAboutMissingTitle ) {
				this.warnedAboutMissingTitle = true;
				return;
			}
		} else {
			this.commentController.sectionTitleField.setWarnings( [] );
			this.warnedAboutMissingTitle = false;
		}
	}

	if ( this.errorMessage ) {
		this.errorMessage.$element.remove();
	}

	this.setPending( true );

	logger( { action: 'saveIntent' } );

	// TODO: When editing a transcluded page, VE API returning the page HTML is a waste, since we won't use it
	logger( { action: 'saveAttempt' } );
	widget.commentController.save( comment, pageName ).fail( function ( code, data ) {
		var typeMap = {
			// Compare to ve.init.mw.ArticleTargetEvents.js in VisualEditor.
			editconflict: 'editConflict',
			wasdeleted: 'editPageDeleted',
			abusefilter: 'extensionAbuseFilter',
			'abusefilter-disallowed': 'extensionAbuseFilter',
			captcha: 'extensionCaptcha',
			spamprotectiontext: 'extensionSpamBlacklist',
			titleblacklist: 'extensionTitleBlacklist',
			'titleblacklist-forbidden-edit': 'extensionTitleBlacklist',
			badtoken: 'userBadToken',
			newuser: 'userNewUser',
			spamblacklist: 'extensionSpamBlacklist',
			empty: 'responseEmpty',
			unknown: 'responseUnknown',
			pagedeleted: 'editPageDeleted'
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
				classes: [ 'dt-ui-replyWidget-captcha' ]
			} );
			widget.captchaMessage.$element.insertAfter( widget.$preview );

			widget.captchaInput.focus();
			widget.captchaInput.scrollElementIntoView();

		} else {
			widget.errorMessage = new OO.ui.MessageWidget( {
				type: 'error',
				label: code instanceof Error ? code.toString() : controller.getApi().getErrorMessage( data ),
				classes: [ 'dt-ui-replyWidget-error' ]
			} );
			widget.errorMessage.$element.insertBefore( widget.replyBodyWidget.$element );
		}

		logger( {
			action: 'saveFailure',
			message: code,
			type: typeMap[ code ] || 'responseUnknown'
		} );
	} ).always( function () {
		widget.setPending( false );
	} );
};

module.exports = ReplyWidget;
