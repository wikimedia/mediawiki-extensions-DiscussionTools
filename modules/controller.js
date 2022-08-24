'use strict';

var
	$pageContainer, linksController, $readAsWikiPage,
	pageThreads,
	lastControllerScrollOffset,
	featuresEnabled = mw.config.get( 'wgDiscussionToolsFeaturesEnabled' ) || {},
	createMemoryStorage = require( './createMemoryStorage.js' ),
	storage = createMemoryStorage( mw.storage.session ),
	Parser = require( './Parser.js' ),
	ThreadItemSet = require( './ThreadItemSet.js' ),
	CommentDetails = require( './CommentDetails.js' ),
	ReplyLinksController = require( './ReplyLinksController.js' ),
	logger = require( './logger.js' ),
	utils = require( './utils.js' ),
	highlighter = require( './highlighter.js' ),
	topicSubscriptions = require( './topicsubscriptions.js' ),
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
 * @return {jQuery.Promise}
 */
function getPageData( pageName, oldId ) {
	var api = getApi();

	pageDataCache[ pageName ] = pageDataCache[ pageName ] || {};
	if ( pageDataCache[ pageName ][ oldId ] ) {
		return pageDataCache[ pageName ][ oldId ];
	}

	var lintPromise, transcludedFromPromise;
	if ( oldId ) {
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

	return getPageData( pageName, oldId )
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
					} else if ( metadata.canEdit ) {
						// If the user can edit, advise them to use the edit button
						transcludedErrMsg = mw.message(
							'discussiontools-error-comment-is-transcluded',
							// eslint-disable-next-line no-jquery/no-global-selector
							$( '#ca-edit' ).text()
						).parse();
					} else {
						// Otherwise, tell them why they can't edit
						transcludedErrMsg = metadata.notices[ 'permissions-error' ];
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

	if ( OO.ui.isMobile() && mw.config.get( 'skin' ) === 'minerva' ) {
		// For compatibility with Minerva click tracking (T295490)
		$container.find( '.section-heading' ).attr( 'data-event-name', 'talkpage.section' );
	}

	$pageContainer = $container;
	linksController = new ReplyLinksController( $pageContainer );
	var parser = new Parser( require( './parser/data.json' ) );

	var commentNodes = $pageContainer[ 0 ].querySelectorAll( '[data-mw-comment]' );
	pageThreads = ThreadItemSet.static.newFromAnnotatedNodes( commentNodes, $pageContainer[ 0 ], parser );

	if ( featuresEnabled.topicsubscription ) {
		topicSubscriptions.initTopicSubscriptions( $container, pageThreads );
	}

	if ( mw.config.get( 'skin' ) === 'minerva' ) {
		// Mobile overflow menu
		mw.loader.using( [ 'oojs-ui-widgets', 'oojs-ui.styles.icons-editing-core' ] ).then( function () {
			$container.find( '.ext-discussiontools-init-section-ellipsisButton' ).each( function () {
				var buttonMenu = OO.ui.infuse( this, { menu: {
					horizontalPosition: 'end',
					items: [
						new OO.ui.MenuOptionWidget( {
							data: 'edit',
							icon: 'edit',
							label: mw.msg( 'skin-view-edit' )
						} )
					]
				} } );
				buttonMenu.getMenu().on( 'choose', function ( menuOption ) {
					switch ( menuOption.getData() ) {
						case 'edit':
							// Click the hidden section-edit link
							buttonMenu.$element.closest( '.ext-discussiontools-init-section' ).find( '.mw-editsection > a' ).trigger( 'click' );
							break;
					}
				} );
			} );
			$container.find( '.ext-discussiontools-init-section-bar' ).on( 'click', function ( e ) {
				// Don't toggle section when clicking on bar
				e.stopPropagation();
			} );
		} );
		if ( !$readAsWikiPage ) {
			// Read as wiki page button, copied from renderReadAsWikiPageButton in Minerva
			$readAsWikiPage = $( '<button>' )
				.addClass( 'ext-discussiontools-init-readAsWikiPage' )
				.attr( 'data-event-name', 'talkpage.readAsWiki' )
				.text( mw.message( 'minerva-talk-full-page' ).text() )
				.on( 'click', function () {
					$( document.body ).removeClass( 'ext-discussiontools-visualenhancements-enabled ext-discussiontools-replytool-enabled' );
				} );
		}
		// eslint-disable-next-line no-jquery/no-global-selector
		$( '#content' ).append( $readAsWikiPage );
	}

	/**
	 * Setup comment controllers for each comment, and the new topic controller
	 *
	 * @param {string} commentId Comment ID, or NEW_TOPIC_COMMENT_ID constant
	 * @param {jQuery} $link Add section link for new topic controller
	 * @param {string} [mode] Optionally force a mode, 'visual' or 'source'
	 * @param {boolean} [hideErrors] Suppress errors, e.g. when restoring auto-save
	 * @param {boolean} [suppressNotifications] Don't notify the user if recovering auto-save
	 */
	function setupController( commentId, $link, mode, hideErrors, suppressNotifications ) {
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

			if ( teardownMode !== 'refresh' ) {
				linksController.clearActiveLink();
			}

			if ( teardownMode === 'abandoned' ) {
				linksController.focusLink( $link );
			}
		} );
		commentController.on( 'reloadPage', function () {
			mw.dt.initState.newCommentIds = commentController.newComments.map( function ( cmt ) {
				return cmt.id;
			} );
			// Teardown active reply widget(s)
			commentController.replyWidgetPromise.then( function ( replyWidget ) {
				lastControllerScrollOffset = $( commentController.newListItem ).offset().top;
				replyWidget.teardown( 'refresh' );
				// Only fetch the last now "good" revision, on which we know the parent comment still exists.
				// As we poll frequently, this will almost always be the lastet revision.
				refreshPageContents( commentController.oldId );
			} );
		} );

		commentController.setup( mode, hideErrors, suppressNotifications );
		if ( lastControllerScrollOffset ) {
			$( document.documentElement ).scrollTop(
				$( document.documentElement ).scrollTop() +
				( $( commentController.newListItem ).offset().top - lastControllerScrollOffset )
			);
			lastControllerScrollOffset = null;
		}
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
				setupController( comment.id, $link, mode, true, !state.firstLoad );
				break;
			}
		}
		if ( storage.get( 'reply/' + utils.NEW_TOPIC_COMMENT_ID + '/saveable' ) ) {
			mode = storage.get( 'reply/' + utils.NEW_TOPIC_COMMENT_ID + '/mode' );
			setupController( utils.NEW_TOPIC_COMMENT_ID, $( [] ), mode, true, !state.firstLoad );
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
			highlighter.highlightPublishedComment( pageThreads, state.repliedTo );

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
		} else if ( state.newCommentIds ) {
			highlighter.highlightNewComments( pageThreads, true, state.newCommentIds );
		}

		// Check topic subscription states if the user has automatic subscriptions enabled
		// and has recently edited this page.
		if ( featuresEnabled.autotopicsub && mw.user.options.get( 'discussiontools-autotopicsub' ) ) {
			topicSubscriptions.updateAutoSubscriptionStates( $container, pageThreads, state.repliedTo );
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
			// Delay with setTimeout() because "the Document's target element" (corresponding to the :target
			// selector in CSS) is not yet updated to match the URL when handling a 'popstate' event.
			setTimeout( function () {
				highlighter.highlightTargetComment( pageThreads, true );
			} );
		} );
		// eslint-disable-next-line no-jquery/no-global-selector
		$( 'body' ).on( 'click', function ( e ) {
			if ( utils.isUnmodifiedLeftClick( e ) ) {
				highlighter.clearHighlightTargetComment( pageThreads );
			}
		} );
		pageHandlersSetup = true;
	}
	if ( state.firstLoad ) {
		highlighter.highlightTargetComment( pageThreads );
	}
}

/**
 * Update the contents of the page with the data from an action=parse API response.
 *
 * @param {jQuery} $container Page container
 * @param {Object} data Data from action=parse API
 */
function updatePageContents( $container, data ) {
	$container.find( '.mw-parser-output' ).first().html( data.parse.text );

	// eslint-disable-next-line no-jquery/no-global-selector
	$( '#contentSub, .minerva__subtitle' ).html( data.parse.subtitle );

	// eslint-disable-next-line no-jquery/no-global-selector
	if ( $( '#catlinks' ).length ) {
		var $categories = $( $.parseHTML( data.parse.categorieshtml ) );
		mw.hook( 'wikipage.categories' ).fire( $categories );
		// eslint-disable-next-line no-jquery/no-global-selector
		$( '#catlinks' ).replaceWith( $categories );
	}

	mw.config.set( data.parse.jsconfigvars );
	mw.loader.load( data.parse.modulestyles );
	mw.loader.load( data.parse.modules );

	mw.config.set( {
		wgCurRevisionId: data.parse.revid,
		wgRevisionId: data.parse.revid
	} );

	// TODO: update displaytitle, lastmodified
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

	mw.hook( 'wikipage.tableOfContents' ).fire(
		data.parse.showtoc ? data.parse.sections : []
	);

	// Copied from ve.init.mw.DesktopArticleTarget.prototype.saveComplete
	// TODO: Upstream this to core/skins, triggered by a hook (wikipage.content?)
	// eslint-disable-next-line no-jquery/no-global-selector
	$( '#t-permalink a, #coll-download-as-rl a' ).each( function () {
		var url = new URL( this.href );
		url.searchParams.set( 'oldid', data.parse.revid );
		$( this ).attr( 'href', url.toString() );
	} );
}

/**
 * Load the latest revision of the page and display its contents.
 *
 * @param {number} [oldId] Revision ID to fetch, latest if not specified
 * @return {jQuery.Promise} Promise which resolves when the refresh is complete
 */
function refreshPageContents( oldId ) {
	// This should approximately match the API call in ApiVisualEditorEditor#parseWikitext
	return getApi().get( {
		action: 'parse',
		// HACK: 'useskin' triggers a different code path that runs our OutputPageBeforeHTML hook,
		// adding our reply links in the HTML (T266195)
		useskin: mw.config.get( 'skin' ),
		mobileformat: OO.ui.isMobile(),
		uselang: mw.config.get( 'wgUserLanguage' ),
		// HACK: Always display reply links afterwards, ignoring preferences etc., in case this was
		// a page view with reply links forced with ?dtenable=1 or otherwise
		dtenable: '1',
		prop: [ 'text', 'revid', 'categorieshtml', 'sections', 'displaytitle', 'subtitle', 'modules', 'jsconfigvars' ],
		page: !oldId ? mw.config.get( 'wgRelevantPageName' ) : undefined,
		oldid: oldId || undefined
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
	function logSaveSuccess() {
		logger( {
			action: 'saveSuccess',
			timing: mw.now() - replyWidget.saveInitiated,
			// eslint-disable-next-line camelcase
			revision_id: data.newrevid
		} );
	}

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
		logSaveSuccess();
		return;
	}

	replyWidget.teardown();
	linksController.teardown();
	linksController = null;
	// TODO: Tell controller to teardown all other open widgets

	// Highlight the new reply after re-initializing
	mw.dt.initState.repliedTo = threadItem.id;

	// Update page state
	var pageUpdated = $.Deferred();
	if ( pageName === mw.config.get( 'wgRelevantPageName' ) ) {
		// We can use the result from the VisualEditor API
		updatePageContents( $pageContainer, {
			parse: {
				text: data.content,
				subtitle: data.contentSub,
				categorieshtml: data.categorieshtml,
				jsconfigvars: data.jsconfigvars,
				revid: data.newrevid,
				// Note: VE API merges 'modules' and 'modulestyles'
				modules: data.modules,
				modulestyles: [],
				// Note: VE API drops 'showtoc' and changes 'sections' depending on it
				showtoc: true,
				sections: data.sections
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
			// We're confident the saving portion succeeded, so still log this:
			logSaveSuccess();
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

	pageUpdated.then( logSaveSuccess );
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
