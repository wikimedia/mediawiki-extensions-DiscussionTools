'use strict';

var
	// DiscussionToolsHooks::getLocalData()
	data = require( './data.json' ),
	parser = require( './parser.js' );

function markTimestamp( node, match ) {
	var
		dfParser = parser.getLocalTimestampParser(),
		newNode, wrapper, date;

	newNode = node.splitText( match.index );
	newNode.splitText( match[ 0 ].length );

	wrapper = document.createElement( 'span' );
	wrapper.className = 'detected-timestamp';
	// Note that this is not supported by all browsers, we should use Moment or something.
	// Moment also requires a plugin to support timezones.
	//
	// We might need to actually port all the date formatting code from MediaWiki's PHP code
	// if we want to support displaying dates in all the formats available in user preferences
	// (which include formats in several non-Gregorian calendars).
	date = dfParser( match );
	wrapper.title = date.toLocaleString( 'en-GB', { timeZone: data.localTimezone } );
	wrapper.appendChild( newNode );
	node.parentNode.insertBefore( wrapper, node.nextSibling );
}

function markSignature( sigNodes ) {
	var
		where = sigNodes[ 0 ],
		wrapper = document.createElement( 'span' );
	wrapper.className = 'detected-signature';
	where.parentNode.insertBefore( wrapper, where );
	while ( sigNodes.length ) {
		wrapper.appendChild( sigNodes.pop() );
	}
}

function markComment( comment ) {
	var
		// eslint-disable-next-line no-jquery/no-global-selector
		rtl = $( 'html' ).attr( 'dir' ) === 'rtl',
		rect = comment.range.getBoundingClientRect(),
		marker = document.createElement( 'div' ),
		marker2 = document.createElement( 'div' ),
		scrollTop = document.documentElement.scrollTop || document.body.scrollTop,
		scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft,
		parentRect, i;

	marker.className = 'detected-comment';
	marker.style.top = ( rect.top + scrollTop ) + 'px';
	marker.style.height = ( rect.height ) + 'px';
	marker.style.left = ( rect.left + scrollLeft ) + 'px';
	marker.style.width = ( rect.width ) + 'px';
	document.body.appendChild( marker );

	if ( comment.parent ) {
		parentRect = comment.parent.range.getBoundingClientRect();
		if ( comment.parent.level === 0 ) {
			// Twiddle so that it looks nice
			parentRect = $.extend( {}, parentRect );
			parentRect.height -= 10;
			if ( rtl ) {
				parentRect.width += 20;
			} else {
				parentRect.left -= 20;
			}
		}

		marker2.className = 'detected-comment-relationship';
		marker2.style.top = ( parentRect.top + parentRect.height + scrollTop ) + 'px';
		marker2.style.height = ( rect.top - ( parentRect.top + parentRect.height ) + 10 ) + 'px';
		if ( rtl ) {
			marker2.style.left = ( rect.left + rect.width + scrollLeft ) + 'px';
			marker2.style.width = ( 10 ) + 'px';
		} else {
			marker2.style.left = ( parentRect.left + 10 + scrollLeft ) + 'px';
			marker2.style.width = ( rect.left - ( parentRect.left + 10 ) ) + 'px';
		}
		document.body.appendChild( marker2 );
	}

	for ( i = 0; i < comment.replies.length; i++ ) {
		markComment( comment.replies[ i ] );
	}
}

function markThreads( threads ) {
	var i;
	for ( i = 0; i < threads.length; i++ ) {
		markComment( threads[ i ] );
	}
	// Reverse order so that box-shadows look right
	// eslint-disable-next-line no-jquery/no-global-selector
	$( 'body' ).append( $( '.detected-comment-relationship' ).get().reverse() );
}

module.exports = {
	markThreads: markThreads,
	markTimestamp: markTimestamp,
	markSignature: markSignature
};
