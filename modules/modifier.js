/* global $:off */
'use strict';

/**
 * Adapted from MDN polyfill (CC0)
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/closest
 *
 * @param {HTMLElement} el
 * @param {string} selector
 * @return {HTMLElement|null}
 */
function closest( el, selector ) {
	var matches;

	el = el.nodeType === Node.ELEMENT_NODE ? el : el.parentElement;

	if ( Element.prototype.closest ) {
		return el.closest( selector );
	}

	matches = Element.prototype.matches ||
		Element.prototype.msMatchesSelector ||
		Element.prototype.webkitMatchesSelector;
	do {
		if ( matches.call( el, selector ) ) {
			return el;
		}
		el = el.parentElement || el.parentNode;
	} while ( el !== null && el.nodeType === 1 );
	return null;
}

function addListAtComment( comment ) {
	var list, listType, lastReply, listItem, endNodeInAncestor,
		tsNode = comment.range.endContainer;

	if ( comment.replies.length ) {
		lastReply = comment.replies[ comment.replies.length - 1 ];
		list = closest( lastReply.range.endContainer, 'dl, ul, ol' );
	} else {
		listItem = closest( tsNode, 'li, dd' );
		if ( listItem ) {
			listType = closest( listItem, 'dl, ul, ol' ).tagName;
			list = document.createElement( listType );
			listItem.appendChild( list );
		} else {
			endNodeInAncestor = comment.range.endContainer;
			while ( endNodeInAncestor.parentNode !== comment.range.commonAncestorContainer ) {
				endNodeInAncestor = endNodeInAncestor.parentNode;
			}
			list = document.createElement( 'dl' );
			comment.range.commonAncestorContainer.insertBefore(
				list,
				endNodeInAncestor.nextSibling
			);
		}
	}
	return list;
}

function addListItem( list ) {
	var listItem = document.createElement( list.nodeName.toLowerCase() === 'dl' ? 'dd' : 'li' );
	list.appendChild( listItem );
	return listItem;
}

function createWikitextNode( wt ) {
	var span = document.createElement( 'span' );

	span.setAttribute( 'typeof', 'mw:Transclusion' );
	span.setAttribute( 'data-mw', JSON.stringify( { parts: [ wt ] } ) );

	return span;
}

module.exports = {
	addListAtComment: addListAtComment,
	addListItem: addListItem,
	createWikitextNode: createWikitextNode
};
