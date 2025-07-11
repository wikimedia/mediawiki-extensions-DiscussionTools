const
	controller = require( './controller.js' ),
	modifier = require( './modifier.js' ),
	dtConf = require( './config.json' ),
	CommentDetails = require( './CommentDetails.js' ),
	CommentItem = require( './CommentItem.js' ),
	scrollPadding = {
		// eslint-disable-next-line no-jquery/no-class-state
		top: 10 + ( $( document.documentElement ).hasClass( 'vector-feature-sticky-header-enabled' ) ? 50 : 0 ),
		bottom: 10
	},
	defaultVisual = controller.defaultVisual,
	enable2017Wikitext = controller.enable2017Wikitext;
/**
 * Handles setup, save and teardown of commenting widgets
 *
 * @param {jQuery} $pageContainer Page container
 * @param {ThreadItem} threadItem Thread item to attach new comment to
 * @param {ThreadItemSet} threadItemSet
 * @param {MemoryStorage} storage Storage object for autosave
 */
function CommentController( $pageContainer, threadItem, threadItemSet, storage ) {
	// Mixin constructors
	OO.EventEmitter.call( this );

	this.isTornDown = false;
	this.$pageContainer = $pageContainer;
	this.threadItem = threadItem;
	this.threadItemSet = threadItemSet;
	this.storage = storage;
	this.newListItem = null;
	this.replyWidgetPromise = null;
	this.oldReplyWidgetPromise = null;
	this.newComments = [];
	this.parentRemoved = false;
	this.oldId = mw.config.get( 'wgRevisionId' );
	this.pollTimeout = null;
	this.onVisibilityChangeHandler = this.onVisibilityChange.bind( this );
}

OO.initClass( CommentController );
OO.mixinClass( CommentController, OO.EventEmitter );

/* CommentController private utilities */

/**
 * Get the latest revision ID of the page.
 *
 * @param {string} pageName
 * @return {jQuery.Promise}
 */
function getLatestRevId( pageName ) {
	return controller.getApi().get( {
		action: 'query',
		prop: 'revisions',
		rvprop: 'ids',
		rvlimit: 1,
		titles: pageName
	} ).then( ( resp ) => resp.query.pages[ 0 ].revisions[ 0 ].revid );
}

/**
 * Like #checkThreadItemOnPage, but assumes the comment was found on the current page,
 * and then follows transclusions to determine the source page where it is written.
 *
 * @return {jQuery.Promise} Promise which resolves with a CommentDetails object, or rejects with an error
 */
CommentController.prototype.getTranscludedFromSource = function () {
	const pageName = mw.config.get( 'wgRelevantPageName' ),
		oldId = mw.config.get( 'wgCurRevisionId' ),
		threadItem = this.getThreadItem();

	function followTransclusion( recursionLimit, code, data ) {
		let errorData;
		if ( recursionLimit > 0 && code === 'comment-is-transcluded' ) {
			errorData = data.errors[ 0 ].data;
			if ( errorData.follow && typeof errorData.transcludedFrom === 'string' ) {
				return getLatestRevId( errorData.transcludedFrom ).then(
					// Fetch the transcluded page, until we cross the recursion limit
					( latestRevId ) => controller.checkThreadItemOnPage( errorData.transcludedFrom, latestRevId, threadItem )
						.catch( followTransclusion.bind( null, recursionLimit - 1 ) )
				);
			}
		}
		return $.Deferred().reject( code, data );
	}

	// Arbitrary limit of 10 steps, which should be more than anyone could ever need
	// (there are reasonable use cases for at least 2)
	const promise = controller.checkThreadItemOnPage( pageName, oldId, threadItem )
		.catch( followTransclusion.bind( null, 10 ) );

	return promise;
};

/* Static properties */

CommentController.static.initType = 'page';

/* Events */

/**
 * The current widget has been torn down
 *
 * @event teardown
 * @param string mode Teardown mode. See dt.ui.ReplyWidget#teardown.
 */

/* Methods */

/**
 * Create and setup the reply widget
 *
 * @param {Object} [options]
 * @param {string} [options.mode] Optionally force a mode, 'visual' or 'source'
 * @param {boolean} [options.fromAutoSave] The comment has been restored from auto-save. Open the
 *   reply widget even if there are loading errors, to allow user to backup or discard it (T345986).
 * @param {boolean} [options.suppressNotifications] Don't notify the user if recovering auto-save
 */
CommentController.prototype.setup = function ( options ) {
	const threadItem = this.getThreadItem();

	options = options || {};

	if ( options.mode === undefined ) {
		options.mode = mw.user.options.get( 'discussiontools-editmode' ) ||
			( defaultVisual ? 'visual' : 'source' );
	}

	mw.track( 'editAttemptStep', {
		action: 'init',
		type: this.constructor.static.initType || 'page',
		mechanism: 'click',
		integration: 'discussiontools',
		// eslint-disable-next-line camelcase
		editor_interface: options.mode === 'visual' ? 'visualeditor' :
			( enable2017Wikitext ? 'wikitext-2017' : 'wikitext' )
	} );

	if ( !this.replyWidgetPromise ) {
		this.replyWidgetPromise = this.getTranscludedFromSource().then(
			( commentDetails ) => this.createReplyWidget( commentDetails, { mode: options.mode } ),
			( code, data ) => {
				if ( options.fromAutoSave ) {
					// There was an error that would normally prevent this reply widget from being opened, but
					// the user has an autosaved draft comment that we must restore. Make up a CommentDetails
					// object to allow the reply widget to open. Using setLoadingError() will prevent it from
					// being saved (otherwise it could go to the wrong page or cause content corruption).
					const commentDetails = new CommentDetails(
						mw.config.get( 'wgRelevantPageName' ),
						mw.config.get( 'wgCurRevisionId' ),
						{}, false, '', options.mode
					);
					const replyWidgetPromise = this.createReplyWidget( commentDetails, { mode: options.mode } );
					replyWidgetPromise.then( ( replyWidget ) => {
						replyWidget.setLoadingError( code, data );
					} );
					return $.Deferred().resolve( replyWidgetPromise );
				}

				this.onReplyWidgetTeardown();
				OO.ui.alert(
					code instanceof Error ? code.toString() : controller.getApi().getErrorMessage( data ),
					{ size: 'medium' }
				);
				mw.track( 'dt.commentSetupError', code );

				mw.track( 'editAttemptStep', {
					action: 'abort',
					type: 'preinit'
				} );

				return $.Deferred().reject();
			}
		);

		// On first load, add a placeholder list item
		this.newListItem = modifier.addListItem( threadItem, dtConf.replyIndentation );
		if ( this.newListItem.tagName.toLowerCase() === 'li' ) {
			// When using bullet syntax, hide the marker. (T259864#7634107)
			$( this.newListItem ).addClass( 'ext-discussiontools-init-noMarker' );
		}
		$( this.newListItem ).append(
			// Microsoft Edge's built-in translation feature replaces the entire element when it finishes
			// translating it, which often happens after our interface has loaded, clobbering it, unless
			// we wrap this loading message in another element.
			$( '<span>' ).text( mw.msg( 'discussiontools-replywidget-loading' ) )
		);
		const scrollPaddingCollapsed = OO.copy( scrollPadding );
		// We don't know exactly how tall the widge will be, but leave room for one line
		// of preview in source mode (~270px). Visual mode is ~250px.
		scrollPaddingCollapsed.bottom += 270;
		OO.ui.Element.static.scrollIntoView( this.newListItem, {
			padding: scrollPaddingCollapsed
		} );

		// Disable section collapsing on mobile. If the section were collapsed it would be hard to
		// find your comment again. The "Return to reply" tool is broken by section collapsing as
		// the reply widget is hidden and therefore not measureable. It's also possible the page is
		// not long enough to trigger the "Return to reply" tool.
		$( this.newListItem ).parents( '.collapsible-block' ).prev().addClass( 'collapsible-heading-disabled' );
	}

	if (
		this.threadItem instanceof CommentItem &&
		this.threadItem.getSubscribableHeading()
	) {
		// Use the revision ID of the content on the page, not wgCurRevisionId
		// This means you will more likely get a refresh warning when deliberately
		// viewing old revisions, which is helpful.
		this.startPoll();
		$( document ).on( 'visibilitychange', this.onVisibilityChangeHandler );
	}

	this.replyWidgetPromise.then( ( replyWidget ) => {
		if ( !this.newListItem ) {
			// On subsequent loads, there's no list item yet, so create one now
			this.newListItem = modifier.addListItem( threadItem, dtConf.replyIndentation );
			if ( this.newListItem.tagName.toLowerCase() === 'li' ) {
				// When using bullet syntax, hide the marker. (T259864#7634107)
				$( this.newListItem ).addClass( 'ext-discussiontools-init-noMarker' );
			}
		}
		$( this.newListItem ).empty().append( replyWidget.$element );

		this.setupReplyWidget( replyWidget, {}, options.suppressNotifications );

		this.showAndFocus();

		mw.track( 'editAttemptStep', { action: 'ready' } );
		mw.track( 'editAttemptStep', { action: 'loaded' } );
	} );
};

/**
 * Handle document visibilitychange events
 *
 * This allows us to pause polling when the user switches to another tab
 */
CommentController.prototype.onVisibilityChange = function () {
	if ( document.hidden ) {
		this.stopPoll();
	} else if ( !this.pollTimeout ) {
		this.pollTimeout = setTimeout( this.startPoll.bind( this ), 5000 );
	}
};

CommentController.prototype.startPoll = function ( nextDelay ) {
	nextDelay = nextDelay || 5000;

	if ( !(
		this.threadItem instanceof CommentItem &&
		this.threadItem.getSubscribableHeading()
	) ) {
		return;
	}

	const threadItemId = this.threadItem.id;
	const subscribableHeadingId = this.threadItem.getSubscribableHeading().id;
	let aborted = false;

	this.pollApiRequest = controller.getApi().get( {
		action: 'discussiontoolscompare',
		fromrev: this.oldId,
		totitle: mw.config.get( 'wgRelevantPageName' )
	} );
	this.pollApiRequest.then( ( response ) => {
		function relevantCommentFilter( cmt ) {
			return cmt.subscribableHeadingId === subscribableHeadingId &&
				// Ignore posts by yourself, if logged in
				cmt.author !== mw.user.getName();
		}

		const result = OO.getProp( response, 'discussiontoolscompare' ) || {};
		const addedComments = result.addedcomments.filter( relevantCommentFilter );
		const removedComments = result.removedcomments.filter( relevantCommentFilter );

		if ( addedComments.length || removedComments.length ) {
			this.updateNewCommentsWarning( addedComments, removedComments );
		}

		// Parent comment was deleted
		const isParentRemoved = result.removedcomments.some( ( cmt ) => cmt.id === threadItemId );
		// Parent comment was deleted then added back (e.g. reverted vandalism)
		const isParentAdded = result.addedcomments.some( ( cmt ) => cmt.id === threadItemId );

		if ( isParentAdded ) {
			this.setParentRemoved( false );
		} else if ( isParentRemoved ) {
			this.setParentRemoved( true );
		}

		this.oldId = result.torevid;
		nextDelay = 5000;
	}, ( code, data ) => {
		if ( code === 'http' && data.textStatus === 'abort' ) {
			aborted = true;
		} else {
			// Wait longer next time in case of error
			nextDelay = nextDelay * 1.5;
		}
	} ).always( () => {
		if ( this.isTornDown || aborted ) {
			return;
		}
		// Stop polling after too many errors
		if ( nextDelay < 1000 * 60 * 60 ) {
			this.pollTimeout = setTimeout( this.startPoll.bind( this, nextDelay ), nextDelay );
		}
	} );
};

CommentController.prototype.stopPoll = function () {
	if ( this.pollTimeout ) {
		clearTimeout( this.pollTimeout );
		this.pollTimeout = null;
	}
	if ( this.pollApiRequest ) {
		this.pollApiRequest.abort();
		this.pollApiRequest = null;
	}
};

/**
 * Get thread item this controller is attached to
 *
 * @return {ThreadItem} Thread item
 */
CommentController.prototype.getThreadItem = function () {
	return this.threadItem;
};

/**
 * Get the reply widget class to use in this controller
 *
 * @param {boolean} visual Prefer the VE-based class
 * @return {jQuery.Promise} Promise which resolves with a Function: the reply widget class
 */
CommentController.prototype.getReplyWidgetClass = function ( visual ) {
	// If 2017WTE mode is enabled, always use ReplyWidgetVisual.
	visual = visual || enable2017Wikitext;

	return mw.loader.using( controller.getReplyWidgetModules() )
		.then( () => require( 'ext.discussionTools.ReplyWidget' )[ visual ? 'ReplyWidgetVisual' : 'ReplyWidgetPlain' ] );
};

/**
 * Create a reply widget
 *
 * @param {CommentDetails} commentDetails
 * @param {Object} config
 * @return {jQuery.Promise} Promise resolved with a ReplyWidget
 */
CommentController.prototype.createReplyWidget = function ( commentDetails, config ) {
	return this.getReplyWidgetClass( config.mode === 'visual' )
		.then( ( ReplyWidget ) => new ReplyWidget( this, commentDetails, config ) );
};

CommentController.prototype.setupReplyWidget = function ( replyWidget, data, suppressNotifications ) {
	replyWidget.connect( this, {
		teardown: 'onReplyWidgetTeardown',
		reloadPage: this.emit.bind( this, 'reloadPage' )
	} );

	replyWidget.setup( data, suppressNotifications );
	replyWidget.updateNewCommentsWarning( this.newComments );
	replyWidget.updateParentRemovedError( this.parentRemoved );
	replyWidget.connect( this, { submit: [ 'onReplySubmit', replyWidget ] } );
};

CommentController.prototype.storeEditSummary = function () {
	this.replyWidgetPromise.then( ( replyWidget ) => {
		replyWidget.storage.set( 'summary', replyWidget.getEditSummary() );
	} );
};

/**
 * Focus the first input field inside the controller.
 */
CommentController.prototype.focus = function () {
	this.replyWidgetPromise.then( ( replyWidget ) => {
		replyWidget.focus();
	} );
};

/**
 * Scroll the widget into view and focus it
 */
CommentController.prototype.showAndFocus = function () {
	this.replyWidgetPromise.then( ( replyWidget ) => {
		replyWidget.scrollElementIntoView( { padding: scrollPadding } )
			.then( () => {
				this.focus();
			} );
	} );
};

/**
 * Try to tear down the reply widget, if it is setup
 *
 * @return {jQuery.Promise} Resolves when the widget is torn down, rejects if it fails.
 */
CommentController.prototype.tryTeardown = function () {
	return this.replyWidgetPromise.then( ( replyWidget ) => replyWidget.tryTeardown() );
};

/**
 * Handle teardown events from the reply widget
 *
 * @param {string} mode Teardown mode. See dt.ui.ReplyWidget#teardown
 */
CommentController.prototype.onReplyWidgetTeardown = function ( mode ) {
	$( this.newListItem ).parents( '.collapsible-block' ).prev().removeClass( 'collapsible-heading-disabled' );

	if ( mode === 'refresh' ) {
		$( this.newListItem ).empty().append(
			$( '<span>' ).text( mw.msg( 'discussiontools-replywidget-loading' ) )
		);
	} else {
		modifier.removeAddedListItem( this.newListItem );
		this.newListItem = null;
	}

	this.stopPoll();
	$( document ).off( 'visibilitychange', this.onVisibilityChangeHandler );

	this.isTornDown = true;
	this.emit( 'teardown', mode );
};

/**
 * Get the parameters of the API query that can be used to post this comment.
 *
 * @param {ReplyWidget} replyWidget Reply widget
 * @param {string} pageName Title of the page to post on
 * @param {Object} checkboxes Value of the promise returned by controller#getCheckboxesPromise
 * @param {Object} extraParams Extra params to pass to the API
 * @return {Object.<string,string>} API query data
 */
CommentController.prototype.getApiQuery = function ( replyWidget, pageName, checkboxes, extraParams ) {
	const threadItem = this.getThreadItem();
	const sameNameComments = this.threadItemSet.findCommentsByName( threadItem.name );

	const mode = replyWidget.getMode();
	const tags = [
		'discussiontools',
		'discussiontools-reply',
		'discussiontools-' + mode
	];

	if ( mode === 'source' && enable2017Wikitext ) {
		tags.push( 'discussiontools-source-enhanced' );
	}

	const data = Object.assign( {
		action: 'discussiontoolsedit',
		paction: 'addcomment',
		page: pageName,
		commentname: threadItem.name,
		// Only specify this if necessary to disambiguate, to avoid errors if the parent changes
		commentid: sameNameComments.length > 1 ? threadItem.id : undefined,
		summary: replyWidget.getEditSummary(),
		formtoken: replyWidget.getFormToken(),
		assert: mw.user.isAnon() ? 'anon' : 'user',
		assertuser: mw.user.getName() || undefined,
		uselang: mw.config.get( 'wgUserLanguage' ),
		// Pass through dtenable query string param from original request
		dtenable: new URLSearchParams( location.search ).get( 'dtenable' ) ? '1' : undefined,
		dttags: tags.join( ',' )
	}, extraParams );

	if ( replyWidget.getMode() === 'source' ) {
		data.wikitext = replyWidget.getValue();
	} else {
		data.html = replyWidget.getValue();
	}

	const captchaInput = replyWidget.captchaInput;
	if ( captchaInput ) {
		data.captchaid = captchaInput.getCaptchaId();
		data.captchaword = captchaInput.getCaptchaWord();
	}

	if ( checkboxes.checkboxesByName.wpWatchthis ) {
		data.watchlist = checkboxes.checkboxesByName.wpWatchthis.isSelected() ?
			'watch' :
			'unwatch';
	}

	return data;
};

/**
 * Handle the reply widget being submitted
 *
 * @param {ReplyWidget} replyWidget Reply widget
 * @param {Object} extraParams Extra params to pass to the API
 */
CommentController.prototype.onReplySubmit = function ( replyWidget, extraParams ) {
	replyWidget.clearSaveErrorMessage();

	this.saveInitiated = mw.now();
	replyWidget.setPending( true );

	mw.track( 'editAttemptStep', { action: 'saveIntent' } );
	mw.track( 'editAttemptStep', { action: 'saveAttempt' } );

	// TODO: When editing a transcluded page, VE API returning the page HTML is a waste, since we won't use it
	this.save( replyWidget, replyWidget.pageName, extraParams )
		.then( null, ( code, data ) => {
			this.saveFail( replyWidget, code, data );
		} )
		.always( () => {
			replyWidget.setPending( false );
		} );
};

/**
 * Handle save failures from the API
 *
 * @param {ReplyWidget} replyWidget Reply widget
 * @param {string} code Error code
 * @param {Object} data Error data
 */
CommentController.prototype.saveFail = function ( replyWidget, code, data ) {
	this.startPoll();

	const captchaData = OO.getProp( data, 'discussiontoolsedit', 'edit', 'captcha' );

	if ( captchaData ) {
		code = 'captcha';
		replyWidget.clearCaptcha();
		replyWidget.setCaptcha( captchaData );
	} else {
		replyWidget.setSaveErrorMessage( code, data );
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

	// Compare to ve.init.mw.ArticleTargetEvents.js in VisualEditor.
	const typeMap = {
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
	mw.track( 'editAttemptStep', {
		action: 'saveFailure',
		timing: mw.now() - this.saveInitiated,
		message: code,
		type: typeMap[ code ] || 'responseUnknown'
	} );
};

/**
 * Save the comment in the comment controller
 *
 * @param {ReplyWidget} replyWidget Reply widget
 * @param {string} pageName Page title
 * @param {Object} extraParams Extra params to pass to the API
 * @return {jQuery.Promise} Promise which resolves when the save is complete
 */
CommentController.prototype.save = function ( replyWidget, pageName, extraParams ) {
	this.stopPoll();

	const threadItem = this.getThreadItem();

	return replyWidget.checkboxesPromise.then( ( checkboxes ) => {
		const data = this.getApiQuery( replyWidget, pageName, checkboxes, extraParams );

		if (
			// We're saving the first comment on a page that previously didn't exist.
			// Don't fetch the new revision's HTML content, because we will reload the whole page.
			!mw.config.get( 'wgRelevantArticleId' ) ||
			// We're saving a comment on a different page than the one being viewed.
			// Don't fetch the new revision's HTML content, because we can't use it anyway.
			pageName !== mw.config.get( 'wgRelevantPageName' )
		) {
			data.nocontent = true;
		}

		if ( replyWidget.commentDetails.wouldAutoCreate ) {
			// This means that we might need to redirect to an opaque URL,
			// so we must set up query parameters we want ahead of time.
			data.returnto = pageName;
			const params = new URLSearchParams();
			params.set( 'dtrepliedto', this.getThreadItem().id );
			params.set( 'dttempusercreated', '1' );
			data.returntoquery = params.toString();
		}

		// No timeout. Huge talk pages can take a long time to save, and falsely reporting an error
		// could result in duplicate messages if the user retries. (T249071)
		const defaults = OO.copy( controller.getApi().defaults );
		defaults.ajax.timeout = 0;
		const noTimeoutApi = new mw.Api( defaults );

		return mw.libs.ve.targetSaver.postContent(
			data, { api: noTimeoutApi }
		).catch( ( code, responseData ) => {
			if ( code === 'assertanonfailed' ) {
				// Reattempt the save when something already created a temporary account (T368263)
				return controller.getApi().get( {
					meta: 'userinfo'
				} ).then( ( resp ) => {
					if ( !resp.query.userinfo.temp ) {
						// Return the original error response
						return $.Deferred().reject( code, responseData ).promise();
					}
					// Set new parameters and retry
					data.assert = 'user';
					data.assertuser = resp.query.userinfo.name;
					return mw.libs.ve.targetSaver.postContent(
						data, { api: noTimeoutApi }
					);
				} );
			}
			return $.Deferred().reject( code, responseData ).promise();
		} ).catch( ( code, responseData ) => {
			// Better user-facing error messages
			if ( code === 'editconflict' ) {
				return $.Deferred().reject( code, { errors: [ {
					code: code,
					html: mw.message( 'discussiontools-error-comment-conflict' ).parse()
				} ] } ).promise();
			}
			if (
				code === 'discussiontools-commentid-notfound' ||
				code === 'discussiontools-commentname-ambiguous' ||
				code === 'discussiontools-commentname-notfound'
			) {
				return $.Deferred().reject( code, { errors: [ {
					code: code,
					html: mw.message( 'discussiontools-error-comment-disappeared' ).parse()
				} ] } ).promise();
			}
			return $.Deferred().reject( code, responseData ).promise();
		} ).then( ( responseData ) => {
			controller.update( responseData, threadItem, pageName, replyWidget );
		} );
	} );
};

/**
 * Add a list of comment objects that are new on the page since it was last refreshed
 *
 * @param {Object[]} addedComments Array of JSON-serialized CommentItem's
 * @param {Object[]} removedComments Array of JSON-serialized CommentItem's
 */
CommentController.prototype.updateNewCommentsWarning = function ( addedComments, removedComments ) {
	// Add new comments
	this.newComments.push( ...addedComments );

	// Delete any comments which have since been deleted (e.g. posted then reverted)
	const removedCommentIds = new Set( removedComments.map( ( cmt ) => cmt.id ) );
	this.newComments = this.newComments.filter(
		// If comment ID is not in removedCommentIds, keep it
		( cmt ) => !removedCommentIds.has( cmt.id )
	);

	this.replyWidgetPromise.then( ( replyWidget ) => {
		replyWidget.updateNewCommentsWarning( this.newComments );
	} );
};

/**
 * Record whether the parent thread item has been removed
 *
 * @param {boolean} parentRemoved
 */
CommentController.prototype.setParentRemoved = function ( parentRemoved ) {
	this.parentRemoved = parentRemoved;

	this.replyWidgetPromise.then( ( replyWidget ) => {
		replyWidget.updateParentRemovedError( this.parentRemoved );
	} );
};

/**
 * Switch reply widget to wikitext input
 *
 * @return {jQuery.Promise} Promise which resolves when switch is complete
 */
CommentController.prototype.switchToWikitext = function () {
	return this.replyWidgetPromise.then( ( oldWidget ) => {
		const target = oldWidget.replyBodyWidget.target,
			oldShowAdvanced = oldWidget.showAdvanced,
			oldEditSummary = oldWidget.getEditSummary(),
			previewDeferred = $.Deferred();

		// TODO: We may need to pass oldid/etag when editing is supported
		const wikitextPromise = target.getWikitextFragment( target.getSurface().getModel().getDocument() );
		this.oldReplyWidgetPromise = this.replyWidgetPromise;
		this.replyWidgetPromise = this.createReplyWidget(
			oldWidget.commentDetails,
			{ mode: 'source' }
		);

		return $.when( wikitextPromise, this.replyWidgetPromise ).then( ( wikitext, newWidget ) => {
			// To prevent the "Reply" / "Cancel" buttons from shifting when the preview loads,
			// wait for the preview (but no longer than 500 ms) before swithing the editors.
			newWidget.preparePreview( wikitext ).then( previewDeferred.resolve );
			setTimeout( previewDeferred.resolve, 500 );

			return previewDeferred.then( () => {
				// Teardown the old widget
				oldWidget.disconnect( this );
				oldWidget.teardown();

				// Swap out the DOM nodes
				oldWidget.$element.replaceWith( newWidget.$element );

				this.setupReplyWidget( newWidget, {
					value: wikitext,
					showAdvanced: oldShowAdvanced,
					editSummary: oldEditSummary
				} );

				// Focus the editor
				newWidget.focus();
			} );
		} ).then( null, this.switchFailed.bind( this ) );
	} );
};

/**
 * Remove empty lines and add indent characters to convert the paragraphs in given wikitext to
 * definition list items, as customary in discussions.
 *
 * @param {string} wikitext
 * @param {string} indent Indent character, ':' or '*'
 * @return {string}
 */
CommentController.prototype.doIndentReplacements = function ( wikitext, indent ) {
	wikitext = modifier.sanitizeWikitextLinebreaks( wikitext );

	wikitext = wikitext.split( '\n' ).map( ( line ) => indent + line ).join( '\n' );

	return wikitext;
};

/**
 * Turn definition list items, customary in discussions, back into normal paragraphs, suitable for
 * the editing interface.
 *
 * @param {Node} rootNode Node potentially containing definition lists (modified in-place)
 */
CommentController.prototype.undoIndentReplacements = function ( rootNode ) {
	const children = Array.prototype.slice.call( rootNode.childNodes );
	// There may be multiple lists when some lines are template generated
	children.forEach( ( child ) => {
		if ( child.nodeType === Node.ELEMENT_NODE ) {
			// Unwrap list
			modifier.unwrapList( child );
		}
	} );
};

/**
 * Get the list of selectors that match nodes that can't be inserted in the comment. (We disallow
 * things that generate wikitext syntax that may conflict with list item syntax.)
 *
 * @return {Object.<string,string>} Map of type used for error messages (string) to CSS selector (string)
 */
CommentController.prototype.getUnsupportedNodeSelectors = function () {
	return {
		// Tables are almost always multi-line
		table: 'table',
		// Headings are converted to plain text before we can detect them:
		// `:==h2==` -> `<p>==h2==</p>`
		// heading: 'h1, h2, h3, h4, h5, h6',
		// Templates can be multiline
		template: '[typeof*="mw:Transclusion"]',
		// Extensions (includes references) can be multiline, could be supported later (T251633)
		extension: '[typeof*="mw:Extension"]'
		// Images are probably fine unless a multi-line caption was used (rare)
		// image: 'figure, figure-inline'
	};
};

/**
 * Switch reply widget to visual input
 *
 * @return {jQuery.Promise} Promise which resolves when switch is complete
 */
CommentController.prototype.switchToVisual = function () {
	return this.replyWidgetPromise.then( ( oldWidget ) => {
		const oldShowAdvanced = oldWidget.showAdvanced,
			oldEditSummary = oldWidget.getEditSummary();
		let wikitext = oldWidget.getValue();

		// Replace wikitext signatures with a special marker recognized by DtDmMWSignatureNode
		// to render them as signature nodes in visual mode.
		wikitext = wikitext.replace(
			// Replace ~~~~ (four tildes), but not ~~~~~ (five tildes)
			/([^~]|^)~~~~([^~]|$)/g,
			'$1<span data-dtsignatureforswitching="1"></span>$2'
		);

		let parsePromise;
		if ( wikitext ) {
			wikitext = this.doIndentReplacements( wikitext, dtConf.replyIndentation === 'invisible' ? ':' : '*' );

			// Based on ve.init.mw.Target#parseWikitextFragment
			parsePromise = controller.getApi().post( {
				action: 'visualeditor',
				paction: 'parsefragment',
				page: oldWidget.pageName,
				wikitext: wikitext,
				pst: true
			} ).then( ( response ) => response && response.visualeditor.content );
		} else {
			parsePromise = $.Deferred().resolve( '' ).promise();
		}
		this.oldReplyWidgetPromise = this.replyWidgetPromise;
		this.replyWidgetPromise = this.createReplyWidget(
			oldWidget.commentDetails,
			{ mode: 'visual' }
		);

		return $.when( parsePromise, this.replyWidgetPromise ).then( ( html, newWidget ) => {
			const unsupportedSelectors = this.getUnsupportedNodeSelectors();

			let doc;
			if ( html ) {
				doc = newWidget.replyBodyWidget.target.parseDocument( html );
				// Remove RESTBase IDs (T253584)
				mw.libs.ve.stripRestbaseIds( doc );
				// Check for tables, headings, images, templates
				for ( const type in unsupportedSelectors ) {
					if ( doc.querySelector( unsupportedSelectors[ type ] ) ) {
						const $msg = $( '<div>' ).html(
							mw.message(
								'discussiontools-error-noswitchtove',
								// The following messages are used here:
								// * discussiontools-error-noswitchtove-extension
								// * discussiontools-error-noswitchtove-table
								// * discussiontools-error-noswitchtove-template
								mw.msg( 'discussiontools-error-noswitchtove-' + type )
							).parse()
						);
						$msg.find( 'a' ).attr( {
							target: '_blank',
							rel: 'noopener'
						} );
						OO.ui.alert(
							$msg.contents(),
							{
								title: mw.msg( 'discussiontools-error-noswitchtove-title' ),
								size: 'medium'
							}
						);
						mw.track( 'visualEditorFeatureUse', {
							feature: 'editor-switch',
							action: 'dialog-prevent-show'
						} );

						return $.Deferred().reject().promise();
					}
				}
				this.undoIndentReplacements( doc.body );
			}

			// Teardown the old widget
			oldWidget.disconnect( this );
			oldWidget.teardown();

			// Swap out the DOM nodes
			oldWidget.$element.replaceWith( newWidget.$element );

			this.setupReplyWidget( newWidget, {
				value: doc,
				showAdvanced: oldShowAdvanced,
				editSummary: oldEditSummary
			} );

			// Focus the editor
			newWidget.focus();
		} ).then( null, this.switchFailed.bind( this ) );
	} );
};

/**
 * Switching mode failed. Restore some state variables and UI.
 */
CommentController.prototype.switchFailed = function () {
	this.oldReplyWidgetPromise.then( ( oldWidget ) => {
		// Restore the ve.init.target global if the oldWidget was a ReplyWidgetVisual
		if ( oldWidget.replyBodyWidget.target ) {
			ve.init.target = oldWidget.replyBodyWidget.target;
		}
	} );
	// Restore the replyWidgetPromise
	this.replyWidgetPromise = this.oldReplyWidgetPromise;
	this.replyWidgetPromise.then( ( replyWidget ) => {
		// Reset the appearance of the modeTabSelect
		replyWidget.modeTabSelect.selectItemByData( replyWidget.getMode() ).highlightItem( null );
	} );
};

module.exports = CommentController;
