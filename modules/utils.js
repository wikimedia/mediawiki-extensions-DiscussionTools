'use strict';
/* global $:off */

/**
 * Return a native Range object corresponding to our comment's range.
 *
 * @param {Object} comment
 * @return {Range}
 */
function getNativeRange( comment ) {
	var endContainer, endOffset,
		doc = comment.range.startContainer.ownerDocument,
		nativeRange = doc.createRange();
	nativeRange.setStart( comment.range.startContainer, comment.range.startOffset );
	// HACK: When the offset is outside the container, assume this is because of
	// the 'mw:Entity' hack in parser#findTimestamp and adjust accordingly.
	// TODO: The parser should produce valid ranges!
	endContainer = comment.range.endContainer;
	endOffset = comment.range.endOffset;
	while ( endOffset > ( endContainer.length || endContainer.childNodes.length ) ) {
		endOffset -= ( endContainer.length || endContainer.childNodes.length );
		endContainer = endContainer.nextSibling;
	}
	nativeRange.setEnd( endContainer, endOffset );
	return nativeRange;
}

/**
 * Get the index of a node in its parentNode's childNode list
 *
 * @param {Node} child
 * @return {number} Index in parentNode's childNode list
 */
function childIndexOf( child ) {
	var i = 0;
	while ( ( child = child.previousSibling ) ) {
		i++;
	}
	return i;
}

/**
 * Find closest ancestor element using one of the given tag names.
 *
 * @param {Node} node
 * @param {string[]} tagNames
 * @return {HTMLElement|null}
 */
function closestElement( node, tagNames ) {
	do {
		if (
			node.nodeType === Node.ELEMENT_NODE &&
			tagNames.indexOf( node.tagName.toLowerCase() ) !== -1
		) {
			return node;
		}
		node = node.parentNode;
	} while ( node );
	return null;
}

/**
 * Find the transclusion node which rendered the current node, if it exists.
 *
 * 1. Find the closest ancestor with an 'about' attribute
 * 2. Find the main node of the about-group (first sibling with the same 'about' attribute)
 * 3. If this is an mw:Transclusion node, return it; otherwise, go to step 1
 *
 * @param {Node} node
 * @return {HTMLElement|null} Translcusion node, null if not found
 */
function getTranscludedFromElement( node ) {
	var about;
	while ( node ) {
		// 1.
		if (
			node.nodeType === Node.ELEMENT_NODE &&
			node.getAttribute( 'about' ) &&
			/^#mwt\d+$/.test( node.getAttribute( 'about' ) )
		) {
			about = node.getAttribute( 'about' );

			// 2.
			while (
				node.previousSibling &&
				node.previousSibling.nodeType === Node.ELEMENT_NODE &&
				node.previousSibling.getAttribute( 'about' ) === about
			) {
				node = node.previousSibling;
			}

			// 3.
			if (
				node.getAttribute( 'typeof' ) &&
				node.getAttribute( 'typeof' ).split( ' ' ).indexOf( 'mw:Transclusion' ) !== -1
			) {
				break;
			}
		}

		node = node.parentNode;
	}
	return node;
}

/**
 * Trim ASCII whitespace, as defined in the HTML spec.
 *
 * @param {string} str
 * @return {string}
 */
function htmlTrim( str ) {
	// https://infra.spec.whatwg.org/#ascii-whitespace
	return str.replace( /^[\t\n\f\r ]+/, '' ).replace( /[\t\n\f\r ]+$/, '' );
}

/**
 * Get a node (if any) that contains the given comment, and nothing else.
 *
 * @param {Object} comment Comment data returned by parser#groupThreads
 * @return {HTMLElement|null}
 */
function getFullyCoveredWrapper( comment ) {
	var nativeRange, ancestor, node, startMatches, endMatches, length;

	nativeRange = getNativeRange( comment );
	ancestor = nativeRange.commonAncestorContainer;

	function isIgnored( node ) {
		// Ignore empty text nodes, and our own reply buttons
		return ( node.nodeType === Node.TEXT_NODE && htmlTrim( node.textContent ) === '' ) ||
			( node.className && node.className.indexOf( 'dt-init-replylink-buttons' ) !== -1 );
	}

	function firstNonemptyChild( node ) {
		node = node.firstChild;
		while ( node && isIgnored( node ) ) {
			node = node.nextSibling;
		}
		return node;
	}

	function lastNonemptyChild( node ) {
		node = node.lastChild;
		while ( node && isIgnored( node ) ) {
			node = node.previousSibling;
		}
		return node;
	}

	startMatches = false;
	node = ancestor;
	while ( node ) {
		if ( comment.range.startContainer === node && comment.range.startOffset === 0 ) {
			startMatches = true;
			break;
		}
		node = firstNonemptyChild( node );
	}

	endMatches = false;
	node = ancestor;
	while ( node ) {
		length = node.nodeType === Node.TEXT_NODE ?
			node.textContent.replace( /[\t\n\f\r ]+$/, '' ).length :
			node.childNodes.length;
		if ( comment.range.endContainer === node && comment.range.endOffset === length ) {
			endMatches = true;
			break;
		}
		node = lastNonemptyChild( node );
	}

	if ( startMatches && endMatches ) {
		// If this is the only child, go up one more level
		while (
			ancestor.parentNode &&
			firstNonemptyChild( ancestor.parentNode ) === lastNonemptyChild( ancestor.parentNode )
		) {
			ancestor = ancestor.parentNode;
		}
		return ancestor;
	}
	return null;
}

module.exports = {
	getNativeRange: getNativeRange,
	childIndexOf: childIndexOf,
	closestElement: closestElement,
	getFullyCoveredWrapper: getFullyCoveredWrapper,
	getTranscludedFromElement: getTranscludedFromElement,
	htmlTrim: htmlTrim
};
