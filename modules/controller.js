'use strict';

/* global moment */
var
	$pageContainer, linksController, lastHighlightComment,
	pageThreads,
	featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {},
	seenAutoTopicSubPopup = !!+mw.user.options.get( 'discussiontools-seenautotopicsubpopup' ),
	MemoryStorage = require( './MemoryStorage.js' ),
	storage = new MemoryStorage( mw.storage.session.store ),
	Parser = require( './Parser.js' ),
	ThreadItemSet = require( './ThreadItemSet.js' ),
	CommentItem = require( './CommentItem.js' ),
	CommentDetails = require( './CommentDetails.js' ),
	ReplyLinksController = require( './ReplyLinksController.js' ),
	logger = require( './logger.js' ),
	utils = require( './utils.js' ),
	highlighter = require( './highlighter.js' ),
	STATE_UNSUBSCRIBED = 0,
	STATE_SUBSCRIBED = 1,
	STATE_AUTOSUBSCRIBED = 2,
	pageHandlersSetup = false,
	pageDataCache = {};

mw.messages.set( require( './controller/contLangMessages.json' ) );

/**
 * Get an MW API instance
 *
 * @return {mw.Api} API instance
 */
function getApi() {
	return new mw.Api( {
		parameters: {
			formatversion: 2,
			uselang: mw.config.get( 'wgUserLanguage' )
		}
	} );
}

/**
 * Get various pieces of page metadata.
 *
 * This method caches responses. If you call it again with the same parameters, you'll get the exact
 * same Promise object, and no API request will be made.
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @param {boolean} [isNewTopic=false]
 * @return {jQuery.Promise}
 */
function getPageData( pageName, oldId, isNewTopic ) {
	var api = getApi();

	pageDataCache[ pageName ] = pageDataCache[ pageName ] || {};
	if ( pageDataCache[ pageName ][ oldId ] ) {
		return pageDataCache[ pageName ][ oldId ];
	}

	var lintPromise, transcludedFromPromise;
	if ( oldId && !isNewTopic ) {
		lintPromise = api.get( {
			action: 'query',
			list: 'linterrors',
			lntcategories: 'fostered',
			lntlimit: 1,
			lnttitle: pageName
		} ).then( function ( response ) {
			return OO.getProp( response, 'query', 'linterrors' ) || [];
		} );

		transcludedFromPromise = api.get( {
			action: 'discussiontoolspageinfo',
			page: pageName,
			oldid: oldId
		} ).then( function ( response ) {
			return OO.getProp( response, 'discussiontoolspageinfo', 'transcludedfrom' ) || {};
		} );
	} else {
		lintPromise = $.Deferred().resolve( [] ).promise();
		transcludedFromPromise = $.Deferred().resolve( {} ).promise();
	}

	var veMetadataPromise = api.get( {
		action: 'visualeditor',
		paction: 'metadata',
		page: pageName
	} ).then( function ( response ) {
		return OO.getProp( response, 'visualeditor' ) || [];
	} );

	pageDataCache[ pageName ][ oldId ] = $.when( lintPromise, transcludedFromPromise, veMetadataPromise )
		.then( function ( linterrors, transcludedfrom, metadata ) {
			return {
				linterrors: linterrors,
				transcludedfrom: transcludedfrom,
				metadata: metadata
			};
		}, function () {
			// Clear on failure
			pageDataCache[ pageName ][ oldId ] = null;
			// Let caller handle the error
			return $.Deferred().rejectWith( this, arguments );
		} );
	return pageDataCache[ pageName ][ oldId ];
}

/**
 * Check if a given thread item on a page can be replied to
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @param {ThreadItem} threadItem Thread item
 * @return {jQuery.Promise} Resolved with a CommentDetails object if the comment appears on the page.
 *  Rejects with error data if the comment is transcluded, or there are lint errors on the page.
 */
function checkThreadItemOnPage( pageName, oldId, threadItem ) {
	var isNewTopic = threadItem.id === utils.NEW_TOPIC_COMMENT_ID;

	return getPageData( pageName, oldId, isNewTopic )
		.then( function ( response ) {
			var metadata = response.metadata,
				lintErrors = response.linterrors,
				transcludedFrom = response.transcludedfrom;

			if ( !isNewTopic ) {
				// First look for data by the thread item's ID. If not found, also look by name.
				// Data by ID may not be found due to differences in headings (e.g. T273413, T275821),
				// or if a thread item's parent changes.
				// Data by name might be combined from two or more thread items, which would only allow us to
				// treat them both as transcluded from unknown source, unless we check ID first.
				var isTranscludedFrom = transcludedFrom[ threadItem.id ];
				if ( isTranscludedFrom === undefined ) {
					isTranscludedFrom = transcludedFrom[ threadItem.name ];
				}
				if ( isTranscludedFrom === undefined ) {
					// The thread item wasn't found when generating the "transcludedfrom" data,
					// so we don't know where the reply should be posted. Just give up.
					return $.Deferred().reject( 'discussiontools-commentid-notfound-transcludedfrom', { errors: [ {
						code: 'discussiontools-commentid-notfound-transcludedfrom',
						html: mw.message( 'discussiontools-error-comment-disappeared' ).parse() +
							'<br>' +
							mw.message( 'discussiontools-error-comment-disappeared-reload' ).parse()
					} ] } ).promise();
				} else if ( isTranscludedFrom ) {
					var mwTitle = isTranscludedFrom === true ? null : mw.Title.newFromText( isTranscludedFrom );
					// If this refers to a template rather than a subpage, we never want to edit it
					var follow = mwTitle && mwTitle.getNamespaceId() !== mw.config.get( 'wgNamespaceIds' ).template;

					var transcludedErrMsg;
					if ( follow ) {
						transcludedErrMsg = mw.message(
							'discussiontools-error-comment-is-transcluded-title',
							mwTitle.getPrefixedText()
						).parse();
					} else {
						transcludedErrMsg = mw.message(
							'discussiontools-error-comment-is-transcluded',
							// eslint-disable-next-line no-jquery/no-global-selector
							$( '#ca-edit' ).text()
						).parse();
					}

					return $.Deferred().reject( 'comment-is-transcluded', { errors: [ {
						data: {
							transcludedFrom: isTranscludedFrom,
							follow: follow
						},
						code: 'comment-is-transcluded',
						html: transcludedErrMsg
					} ] } ).promise();
				}

				if ( lintErrors.length ) {
					// We currently only request the first error
					var lintType = lintErrors[ 0 ].category;

					return $.Deferred().reject( 'lint', { errors: [ {
						code: 'lint',
						html: mw.message( 'discussiontools-error-lint',
							'https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Lint_errors/' + lintType,
							'https://www.mediawiki.org/wiki/Special:MyLanguage/Help_talk:Lint_errors/' + lintType,
							mw.util.getUrl( pageName, { action: 'edit', lintid: lintErrors[ 0 ].lintId } ) ).parse()
					} ] } ).promise();
				}
			}

			if ( !metadata.canEdit ) {
				return $.Deferred().reject( 'permissions-error', { errors: [ {
					code: 'permissions-error',
					html: metadata.notices[ 'permissions-error' ]
				} ] } ).promise();
			}

			return new CommentDetails( pageName, oldId, metadata.notices );
		} );
}

/**
 * Get a promise which resolves with editor checkbox data
 *
 * @param {string} pageName Page title
 * @param {number} oldId Revision ID
 * @return {jQuery.Promise} See ve.init.mw.ArticleTargetLoader#createCheckboxFields
 */
function getCheckboxesPromise( pageName, oldId ) {
	return getPageData(
		pageName,
		oldId
	).then( function ( pageData ) {
		var data = pageData.metadata,
			checkboxesDef = {};

		mw.messages.set( data.checkboxesMessages );

		// Only show the watch checkbox for now
		if ( 'wpWatchthis' in data.checkboxesDef ) {
			checkboxesDef.wpWatchthis = data.checkboxesDef.wpWatchthis;
			// Override the label with a more verbose one to distinguish this from topic subscriptions (T290712)
			checkboxesDef.wpWatchthis[ 'label-message' ] = 'discussiontools-replywidget-watchthis';
		}
		return mw.loader.using( 'ext.visualEditor.targetLoader' ).then( function () {
			return mw.libs.ve.targetLoader.createCheckboxFields( checkboxesDef );
		} );
		// TODO: createCheckboxField doesn't make links in the label open in a new
		// window as that method currently lives in ve.utils
	} );
}

/**
 * Update a subscribe button
 *
 * @param {HTMLElement} element Subscribe button
 * @param {number|null} state State constant (STATE_UNSUBSCRIBED, STATE_SUBSCRIBED or STATE_AUTOSUBSCRIBED)
 */
function updateSubscribeButton( element, state ) {
	if ( state !== null ) {
		element.setAttribute( 'data-mw-subscribed', String( state ) );
	}
	if ( state ) {
		element.textContent = mw.msg( 'discussiontools-topicsubscription-button-unsubscribe' );
		element.setAttribute( 'title', mw.msg( 'discussiontools-topicsubscription-button-unsubscribe-tooltip' ) );
	} else {
		element.textContent = mw.msg( 'discussiontools-topicsubscription-button-subscribe' );
		element.setAttribute( 'title', mw.msg( 'discussiontools-topicsubscription-button-subscribe-tooltip' ) );
	}
}

/**
 * Initialize topic subscriptions feature
 *
 * @param {jQuery} $container Page container
 */
function initTopicSubscriptions( $container ) {
	$container.find( '.ext-discussiontools-init-section-subscribe-link' ).on( 'click keypress', function ( e ) {
		if ( e.type === 'keypress' && e.which !== OO.ui.Keys.ENTER && e.which !== OO.ui.Keys.SPACE ) {
			// Only handle keypresses on the "Enter" or "Space" keys
			return;
		}
		if ( e.type === 'click' && !utils.isUnmodifiedLeftClick( e ) ) {
			// Only handle unmodified left clicks
			return;
		}

		e.preventDefault();

		var commentName = this.getAttribute( 'data-mw-comment-name' );

		if ( !commentName ) {
			// This should never happen
			return;
		}

		var element = this,
			api = getApi(),
			subscribedState = element.hasAttribute( 'data-mw-subscribed' ) ?
				Number( element.getAttribute( 'data-mw-subscribed' ) ) : null,
			heading = $( this ).closest( '.ext-discussiontools-init-section' )[ 0 ],
			section = utils.getHeadlineNodeAndOffset( heading ).node.id,
			title = mw.config.get( 'wgRelevantPageName' ) + '#' + section;

		$( element ).addClass( 'ext-discussiontools-init-section-subscribe-link-pending' );

		api.postWithToken( 'csrf', {
			action: 'discussiontoolssubscribe',
			page: title,
			commentname: commentName,
			subscribe: !subscribedState
		} ).then( function ( response ) {
			return OO.getProp( response, 'discussiontoolssubscribe' ) || {};
		} ).then( function ( result ) {
			$( element ).removeClass( 'ext-discussiontools-init-section-subscribe-link-pending' );
			updateSubscribeButton( element, result.subscribe ? STATE_SUBSCRIBED : STATE_UNSUBSCRIBED );
			mw.notify(
				mw.msg(
					result.subscribe ?
						'discussiontools-topicsubscription-notify-subscribed-body' :
						'discussiontools-topicsubscription-notify-unsubscribed-body'
				),
				{
					title: mw.msg(
						result.subscribe ?
							'discussiontools-topicsubscription-notify-subscribed-title' :
							'discussiontools-topicsubscription-notify-unsubscribed-title'
					)
				}
			);
		}, function ( code, data ) {
			mw.notify( api.getErrorMessage( data ), { type: 'error' } );
			$( element ).removeClass( 'ext-discussiontools-init-section-subscribe-link-pending' );
		} );
	} );
}

/**
 * Show the first time popup for auto topic subscriptions, if required
 */
function maybeShowFirstTimeAutoTopicSubPopup() {
	if ( !lastHighlightComment || seenAutoTopicSubPopup ) {
		return;
	}

	seenAutoTopicSubPopup = true;
	mw.user.options.set( 'discussiontools-seenautotopicsubpopup', '1' );
	getApi().saveOption( 'discussiontools-seenautotopicsubpopup', '1' );

	var $popupContent, popup;

	function close() {
		popup.$element.removeClass( 'ext-discussiontools-autotopicsubpopup-fadein' );
		setTimeout( function () {
			popup.$element.detach();
		}, 1000 );
	}

	$popupContent = $( '<div>' )
		.append(
			$( '<strong>' )
				.addClass( 'ext-discussiontools-autotopicsubpopup-title' )
				.text( mw.msg( 'discussiontools-autotopicsubpopup-title' ) ),
			$( '<div>' )
				.addClass( 'ext-discussiontools-autotopicsubpopup-image' ),
			$( '<div>' )
				.addClass( 'ext-discussiontools-autotopicsubpopup-body' )
				.text( mw.msg( 'discussiontools-autotopicsubpopup-body' ) ),
			$( '<div>' )
				.addClass( 'ext-discussiontools-autotopicsubpopup-actions' )
				.append( new OO.ui.ButtonWidget( {
					label: mw.msg( 'discussiontools-autotopicsubpopup-dismiss' ),
					flags: [ 'primary', 'progressive' ]
				} ).on( 'click', close ).$element )
				.append( new OO.ui.ButtonWidget( {
					label: mw.msg( 'discussiontools-autotopicsubpopup-preferences' ),
					href: mw.util.getUrl( 'Special:Preferences#mw-prefsection-editing-discussion' ),
					flags: [ 'progressive' ],
					framed: false
				} ).$element )
		);

	popup = new OO.ui.PopupWidget( {
		// Styles and dimensions
		width: '',
		height: '',
		anchor: false,
		autoClose: false,
		head: false,
		padded: false,
		classes: [ 'ext-discussiontools-autotopicsubpopup' ],
		hideWhenOutOfView: false,
		// Content
		$content: $popupContent.contents()
	} );

	// Like in highlight()
	lastHighlightComment.getNativeRange().insertNode( popup.$element[ 0 ] );
	// Pull it outside of headings to avoid silly fonts
	if ( popup.$element.closest( 'h1, h2, h3, h4, h5, h6' ).length ) {
		popup.$element.closest( 'h1, h2, h3, h4, h5, h6' ).after( popup.$element );
	}

	// Disable positioning, the popup is positioned in CSS, above the highlight
	popup.toggle( true ).toggleClipping( false ).togglePositioning( false );

	// If the page is very short, there might not be enough space above the highlight,
	// causing the popup to overlap the skin navigation or even be off-screen.
	// Position it on top of the highlight in that case...
	// eslint-disable-next-line no-jquery/no-global-selector
	if ( popup.$popup[ 0 ].getBoundingClientRect().top < $( '.mw-body' )[ 0 ].getBoundingClientRect().top ) {
		popup.$popup.addClass( 'ext-discussiontools-autotopicsubpopup-overlap' );
	}

	// Scroll into view, leave some space above to avoid overlapping .postedit-container
	OO.ui.Element.static.scrollIntoView(
		popup.$popup[ 0 ],
		{
			padding: {
				// Add padding to avoid overlapping the post-edit notification (above on desktop, below on mobile)
				top: OO.ui.isMobile() ? 10 : 60,
				bottom: OO.ui.isMobile() ? 85 : 10
			},
			// Specify scrollContainer for compatibility with MobileFrontend.
			// Apparently it makes `<dd>` elements scrollable and OOUI tried to scroll them instead of body.
			scrollContainer: OO.ui.Element.static.getRootScrollableElement( popup.$popup[ 0 ] )
		}
	);

	popup.$element.addClass( 'ext-discussiontools-autotopicsubpopup-fadein' );
}

/**
 * Update the subscription state of various topics
 *
 * @param {jQuery} $container Page container
 * @param {Object.<string, HeadingItem>} headingsToUpdate Headings of topics where subscription state has changed
 */
function updateSubscriptionStates( $container, headingsToUpdate ) {
	// This method is called when we recently edited this page, and auto-subscriptions might have been
	// added for some topics. It updates the [subscribe] buttons to reflect the new subscriptions.

	var $links = $container.find( '.ext-discussiontools-init-section-subscribe-link' );
	var linksByName = {};
	$links.each( function () {
		linksByName[ this.getAttribute( 'data-mw-comment-name' ) ] = this;
	} );

	// If the topic is already marked as auto-subscribed, there's nothing to do.
	// (Except maybe show the first-time popup.)
	// If the topic is marked as having never been subscribed, check if they are auto-subscribed now.
	var topicsToCheck = [];
	var pending = [];
	for ( var headingName in headingsToUpdate ) {
		var el = linksByName[ headingName ];
		var subscribedState = el.hasAttribute( 'data-mw-subscribed' ) ?
			Number( el.getAttribute( 'data-mw-subscribed' ) ) : null;

		if ( subscribedState === STATE_AUTOSUBSCRIBED ) {
			maybeShowFirstTimeAutoTopicSubPopup();
		} else if ( subscribedState === null || subscribedState === STATE_UNSUBSCRIBED ) {
			topicsToCheck.push( headingName );
			pending.push( el );
		}
	}
	$( pending ).addClass( 'ext-discussiontools-init-section-subscribe-link-pending' );

	if ( !topicsToCheck.length ) {
		return;
	}

	var api = getApi();
	api.get( {
		action: 'discussiontoolsgetsubscriptions',
		commentname: topicsToCheck
	} ).then( function ( response ) {
		if ( $.isEmptyObject( response.subscriptions ) ) {
			// If none of the topics has an auto-subscription yet, wait a moment and check again.
			// updateSubscriptionStates() method is only called if we're really expecting one to be there.
			// (There are certainly neater ways to implement this, involving push notifications or at
			// least long-polling or something. But this is the simplest one!)
			var wait = $.Deferred();
			setTimeout( wait.resolve, 5000 );
			return wait.then( function () {
				return api.get( {
					action: 'discussiontoolsgetsubscriptions',
					commentname: topicsToCheck
				} );
			} );
		}
		return response;
	} ).then( function ( response ) {
		// Update state of each topic for which there is a subscription
		for ( var subItemName in response.subscriptions ) {
			var state = response.subscriptions[ subItemName ];
			updateSubscribeButton( linksByName[ subItemName ], state );
			if ( state === STATE_AUTOSUBSCRIBED ) {
				maybeShowFirstTimeAutoTopicSubPopup();
			}
		}
		$( pending ).removeClass( 'ext-discussiontools-init-section-subscribe-link-pending' );
	}, function () {
		$( pending ).removeClass( 'ext-discussiontools-init-section-subscribe-link-pending' );
	} );
}

/**
 * Initialize Discussion Tools features
 *
 * @param {jQuery} $container Page container
 * @param {Object<string,Mixed>} [state] Page state data object
 * @param {string} [state.repliedTo] The comment ID that was just replied to
 */
function init( $container, state ) {
	var
		activeCommentId = null,
		activeController = null,
		// Loads later to avoid circular dependency
		CommentController = require( './CommentController.js' ),
		NewTopicController = require( './NewTopicController.js' );

	// Lazy-load postEdit module, may be required later (on desktop)
	mw.loader.using( 'mediawiki.action.view.postEdit' );

	$pageContainer = $container;
	linksController = new ReplyLinksController( $pageContainer );
	var parser = new Parser( require( './parser/data.json' ) );

	var commentNodes = $pageContainer[ 0 ].querySelectorAll( '[data-mw-comment]' );
	pageThreads = ThreadItemSet.static.newFromAnnotatedNodes( commentNodes, parser );

	if ( featuresEnabled.topicsubscription ) {
		initTopicSubscriptions( $container );
	}

	/**
	 * Setup comment controllers for each comment, and the new topic controller
	 *
	 * @param {string} commentId Comment ID, or NEW_TOPIC_COMMENT_ID constant
	 * @param {jQuery} $link Add section link for new topic controller
	 * @param {string} [mode] Optionally force a mode, 'visual' or 'source'
	 * @param {boolean} [hideErrors] Suppress errors, e.g. when restoring auto-save
	 */
	function setupController( commentId, $link, mode, hideErrors ) {
		var commentController, $addSectionLink;
		if ( commentId === utils.NEW_TOPIC_COMMENT_ID ) {
			// eslint-disable-next-line no-jquery/no-global-selector
			$addSectionLink = $( '#ca-addsection a' );
			// When opening new topic tool using any link, always activate the link in page tabs too
			$link = $link.add( $addSectionLink );
			commentController = new NewTopicController( $pageContainer, pageThreads );
		} else {
			commentController = new CommentController( $pageContainer, pageThreads.findCommentById( commentId ), pageThreads );
		}

		activeCommentId = commentId;
		activeController = commentController;
		linksController.setActiveLink( $link );

		commentController.on( 'teardown', function ( teardownMode ) {
			activeCommentId = null;
			activeController = null;
			linksController.clearActiveLink();

			if ( teardownMode === 'abandoned' ) {
				linksController.focusLink( $link );
			}
		} );

		commentController.setup( mode, hideErrors );
	}

	// Hook up each link to open a reply widget
	//
	// TODO: Allow users to use multiple reply widgets simultaneously.
	// Currently submitting a reply from one widget would also destroy the other ones.
	linksController.on( 'link-click', function ( commentId, $link ) {
		// If the reply widget is already open, activate it.
		// Reply links are also made unclickable using 'pointer-events' in CSS, but that doesn't happen
		// for new section links, because we don't have a good way of visually disabling them.
		// (And it also doesn't work on IE 11.)
		if ( activeCommentId === commentId ) {
			activeController.showAndFocus();
			return;
		}

		// If this is a new topic link, and a reply widget is open, attempt to close it first.
		var teardownPromise;
		if ( activeController && commentId === utils.NEW_TOPIC_COMMENT_ID ) {
			teardownPromise = activeController.replyWidget.tryTeardown();
		} else {
			teardownPromise = $.Deferred().resolve();
		}

		teardownPromise.then( function () {
			// If another reply widget is open (or opening), do nothing.
			if ( activeController ) {
				return;
			}
			setupController( commentId, $link );
		} );
	} );

	// Restore autosave
	( function () {
		var mode, $link;
		for ( var i = 0; i < pageThreads.threadItems.length; i++ ) {
			var comment = pageThreads.threadItems[ i ];
			if ( storage.get( 'reply/' + comment.id + '/saveable' ) ) {
				mode = storage.get( 'reply/' + comment.id + '/mode' );
				$link = $( commentNodes[ i ] );
				setupController( comment.id, $link, mode, true );
				break;
			}
		}
		if ( storage.get( 'reply/' + utils.NEW_TOPIC_COMMENT_ID + '/saveable' ) ) {
			mode = storage.get( 'reply/' + utils.NEW_TOPIC_COMMENT_ID + '/mode' );
			setupController( utils.NEW_TOPIC_COMMENT_ID, $( [] ), mode, true );
		} else if ( mw.config.get( 'wgDiscussionToolsStartNewTopicTool' ) ) {
			setupController( utils.NEW_TOPIC_COMMENT_ID, $( [] ) );
		}
	}() );

	// For debugging (now unused in the code)
	mw.dt.pageThreads = pageThreads;

	var promise = OO.ui.isMobile() && mw.loader.getState( 'mobile.init' ) ?
		mw.loader.using( 'mobile.init' ) :
		$.Deferred().resolve().promise();

	promise.then( function () {
		if ( state.repliedTo ) {
			lastHighlightComment = highlighter.highlightPublishedComment( pageThreads, state.repliedTo );

			if ( state.repliedTo === utils.NEW_TOPIC_COMMENT_ID ) {
				mw.hook( 'postEdit' ).fire( {
					message: mw.msg( 'discussiontools-postedit-confirmation-topicadded', mw.user )
				} );
			} else {
				if ( OO.ui.isMobile() ) {
					mw.notify( mw.msg( 'discussiontools-postedit-confirmation-published', mw.user ) );
				} else {
					// postEdit is currently desktop only
					mw.hook( 'postEdit' ).fire( {
						message: mw.msg( 'discussiontools-postedit-confirmation-published', mw.user )
					} );
				}
			}
		}

		// Check topic subscription states if the user has automatic subscriptions enabled
		// and has recently edited this page.
		if ( featuresEnabled.autotopicsub && mw.user.options.get( 'discussiontools-autotopicsub' ) ) {
			var recentComments = [];
			var headingsToUpdate = {};
			if ( state.repliedTo ) {
				// Edited by using the reply tool or new topic tool. Only check the edited topic.
				if ( state.repliedTo === utils.NEW_TOPIC_COMMENT_ID ) {
					recentComments.push( pageThreads.threadItems[ pageThreads.threadItems.length - 1 ] );
				} else {
					recentComments.push( pageThreads.threadItemsById[ state.repliedTo ] );
				}
			} else if ( mw.config.get( 'wgPostEdit' ) ) {
				// Edited by using wikitext editor. Check topics with their own comments within last minute.
				for ( var i = 0; i < pageThreads.threadItems.length; i++ ) {
					if (
						pageThreads.threadItems[ i ] instanceof CommentItem &&
						pageThreads.threadItems[ i ].author === mw.user.getName() &&
						pageThreads.threadItems[ i ].timestamp.isSameOrAfter( moment().subtract( 1, 'minute' ), 'minute' )
					) {
						recentComments.push( pageThreads.threadItems[ i ] );
					}
				}
			}
			recentComments.forEach( function ( recentComment ) {
				var headingItem = recentComment.getSubscribableHeading();
				if ( headingItem ) {
					// Use names as object keys to deduplicate if there are multiple comments in a topic.
					headingsToUpdate[ headingItem.name ] = headingItem;
				}
			} );
			updateSubscriptionStates( $container, headingsToUpdate );
		}
	} );

	// Preload page metadata.
	// TODO: Isn't this too early to load it? We will only need it if the user tries replying...
	getPageData(
		mw.config.get( 'wgRelevantPageName' ),
		mw.config.get( 'wgCurRevisionId' )
	);

	// Page-level handlers only need to be setup once
	if ( !pageHandlersSetup ) {
		$( window ).on( 'popstate', function () {
			highlighter.highlightTargetComment( pageThreads, true );
		} );
		// eslint-disable-next-line no-jquery/no-global-selector
		$( 'body' ).on( 'click', function ( e ) {
			if ( utils.isUnmodifiedLeftClick( e ) ) {
				highlighter.clearHighlightTargetComment( pageThreads );
			}
		} );
		pageHandlersSetup = true;
	}
	highlighter.highlightTargetComment( pageThreads );
}

/**
 * Update the contents of the page with the data from an action=parse API response.
 *
 * @param {jQuery} $container Page container
 * @param {Object} data Data from action=parse API
 */
function updatePageContents( $container, data ) {
	var $content = $( $.parseHTML( data.parse.text ) );
	$container.find( '.mw-parser-output' ).replaceWith( $content );
	mw.config.set( data.parse.jsconfigvars );
	mw.loader.load( data.parse.modulestyles );
	mw.loader.load( data.parse.modules );

	mw.config.set( {
		wgCurRevisionId: data.parse.revid,
		wgRevisionId: data.parse.revid
	} );

	// TODO update categories, displaytitle, lastmodified
	// We may not be able to use prop=displaytitle without making changes in the action=parse API,
	// VE API has some confusing code that changes the HTML escaping on it before returning???

	// We need our init code to run after everyone else's handlers for this hook,
	// so that all changes to the page layout have been completed (e.g. collapsible elements),
	// and we can measure things and display the highlight in the right place.
	mw.hook( 'wikipage.content' ).remove( mw.dt.init );
	mw.hook( 'wikipage.content' ).fire( $container );
	// The hooks have "memory" so calling add() after fire() actually fires the handler,
	// and calling add() before fire() would actually fire it twice.
	mw.hook( 'wikipage.content' ).add( mw.dt.init );
}

/**
 * Load the latest revision of the page and display its contents.
 *
 * @return {jQuery.Promise} Promise which resolves when the refresh is complete
 */
function refreshPageContents() {
	return getApi().get( {
		action: 'parse',
		// HACK: 'useskin' triggers a different code path that runs our OutputPageBeforeHTML hook,
		// adding our reply links in the HTML (T266195)
		useskin: mw.config.get( 'skin' ),
		uselang: mw.config.get( 'wgUserLanguage' ),
		// HACK: Always display reply links afterwards, ignoring preferences etc., in case this was
		// a page view with reply links forced with ?dtenable=1 or otherwise
		dtenable: '1',
		prop: [ 'text', 'modules', 'jsconfigvars', 'revid' ],
		page: mw.config.get( 'wgRelevantPageName' )
	} ).then( function ( parseResp ) {
		updatePageContents( $pageContainer, parseResp );
	} );
}

/**
 * Update the page after a comment is published/saved
 *
 * @param {Object} data Edit API response data
 * @param {ThreadItem} threadItem Parent thread item
 * @param {string} pageName Page title
 * @param {mw.dt.ReplyWidget} replyWidget ReplyWidget
 */
function update( data, threadItem, pageName, replyWidget ) {
	// We posted a new comment, clear the cache, because wgCurRevisionId will not change if we posted
	// to a transcluded page (T266275)
	pageDataCache[ mw.config.get( 'wgRelevantPageName' ) ][ mw.config.get( 'wgCurRevisionId' ) ] = null;

	var pageExists = !!mw.config.get( 'wgRelevantArticleId' );
	if ( !pageExists ) {
		// The page didn't exist before this update, so reload it. We'd handle
		// setting up the content just fine (assuming there's a
		// mw-parser-output), but fixing up the UI tabs/behavior is outside
		// our scope.
		replyWidget.unbindBeforeUnloadHandler();
		replyWidget.clearStorage();
		replyWidget.setPending( true );
		window.location = mw.util.getUrl( pageName, { dtrepliedto: threadItem.id } );
		return;
	}

	replyWidget.teardown();
	linksController.teardown();
	linksController = null;
	// TODO: Tell controller to teardown all other open widgets

	if ( OO.ui.isMobile() ) {
		// MobileFrontend does not use the 'wikipage.content' hook, and its interface will not
		// re-initialize properly (e.g. page sections won't be collapsible). Reload the whole page.
		window.location = mw.util.getUrl( pageName, { dtrepliedto: threadItem.id } );
		return;
	}

	// Highlight the new reply after re-initializing
	mw.dt.initState.repliedTo = threadItem.id;

	// Update page state
	var pageUpdated = $.Deferred();
	if ( pageName === mw.config.get( 'wgRelevantPageName' ) ) {
		// We can use the result from the VisualEditor API
		updatePageContents( $pageContainer, {
			parse: {
				text: data.content,
				jsconfigvars: data.jsconfigvars,
				revid: data.newrevid,
				// Note: VE API merges 'modules' and 'modulestyles'
				modules: data.modules,
				modulestyles: []
			}
		} );

		mw.config.set( {
			wgCurRevisionId: data.newrevid,
			wgRevisionId: data.newrevid
		} );

		pageUpdated.resolve();

	} else {
		// We saved to another page, we must purge and then fetch the current page
		var api = getApi();
		api.post( {
			action: 'purge',
			titles: mw.config.get( 'wgRelevantPageName' )
		} ).then( function () {
			return refreshPageContents();
		} ).then( function () {
			pageUpdated.resolve();
		} ).catch( function () {
			// We saved the reply, but couldn't purge or fetch the updated page. Seems difficult to
			// explain this problem. Redirect to the page where the user can at least see their reply…
			window.location = mw.util.getUrl( pageName, { dtrepliedto: threadItem.id } );
		} );
	}

	// User logged in if module loaded.
	if ( mw.loader.getState( 'mediawiki.page.watch.ajax' ) === 'ready' ) {
		var watch = require( 'mediawiki.page.watch.ajax' );

		watch.updateWatchLink(
			mw.Title.newFromText( pageName ),
			data.watched ? 'unwatch' : 'watch',
			'idle',
			data.watchlistexpiry
		);
	}

	pageUpdated.then( function () {
		logger( {
			action: 'saveSuccess',
			timing: mw.now() - replyWidget.saveInitiated,
			// eslint-disable-next-line camelcase
			revision_id: data.newrevid
		} );
	} );
}

module.exports = {
	init: init,
	update: update,
	updatePageContents: updatePageContents,
	refreshPageContents: refreshPageContents,
	checkThreadItemOnPage: checkThreadItemOnPage,
	getCheckboxesPromise: getCheckboxesPromise,
	getApi: getApi,
	storage: storage
};
