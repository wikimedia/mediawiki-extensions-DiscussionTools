/* global moment */
var
	api,
	seenAutoTopicSubPopup = !!+mw.user.options.get( 'discussiontools-seenautotopicsubpopup' ),
	STATE_UNSUBSCRIBED = 0,
	STATE_SUBSCRIBED = 1,
	STATE_AUTOSUBSCRIBED = 2,
	utils = require( './utils.js' ),
	CommentItem = require( './CommentItem.js' );

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
	// Loads later to avoid circular dependency
	api = require( './controller.js' ).getApi();

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
	var lastHighlightComment = require( './highlighter.js' ).getLastHighlightedPublishedComment();

	if ( !lastHighlightComment || seenAutoTopicSubPopup ) {
		return;
	}

	seenAutoTopicSubPopup = true;
	mw.user.options.set( 'discussiontools-seenautotopicsubpopup', '1' );
	api.saveOption( 'discussiontools-seenautotopicsubpopup', '1' );

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
 * Update subscription state of just-posted new topics
 *
 * @param {jQuery} $container Page container
 * @param {ThreadItemSet} threadItemSet
 * @param {string} [threadItemId] Just-posted comment ID (or NEW_TOPIC_COMMENT_ID)
 */
function updateAutoSubscriptionStates( $container, threadItemSet, threadItemId ) {
	var recentComments = [];
	var headingsToUpdate = {};
	if ( threadItemId ) {
		// Edited by using the reply tool or new topic tool. Only check the edited topic.
		if ( threadItemId === utils.NEW_TOPIC_COMMENT_ID ) {
			recentComments.push( threadItemSet.threadItems[ threadItemSet.threadItems.length - 1 ] );
		} else {
			recentComments.push( threadItemSet.threadItemsById[ threadItemId ] );
		}
	} else if ( mw.config.get( 'wgPostEdit' ) ) {
		// Edited by using wikitext editor. Check topics with their own comments within last minute.
		for ( var i = 0; i < threadItemSet.threadItems.length; i++ ) {
			if (
				threadItemSet.threadItems[ i ] instanceof CommentItem &&
				threadItemSet.threadItems[ i ].author === mw.user.getName() &&
				threadItemSet.threadItems[ i ].timestamp.isSameOrAfter( moment().subtract( 1, 'minute' ), 'minute' )
			) {
				recentComments.push( threadItemSet.threadItems[ i ] );
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

module.exports = {
	initTopicSubscriptions: initTopicSubscriptions,
	updateAutoSubscriptionStates: updateAutoSubscriptionStates
};
