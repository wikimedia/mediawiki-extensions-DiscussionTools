'use strict';

/**
 * Return a native Range object corresponding to our comment's range.
 *
 * @param {Object} comment
 * @return {Range}
 */
function getNativeRange( comment ) {
	var
		doc = comment.range.startContainer.ownerDocument,
		nativeRange = doc.createRange();
	nativeRange.setStart( comment.range.startContainer, comment.range.startOffset );
	nativeRange.setEnd( comment.range.endContainer, comment.range.endOffset );
	return nativeRange;
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
 * Trim ASCII whitespace, as defined in the HTML spec.
 *
 * @param {string} str
 * @return {string}
 */
function htmlTrim( str ) {
	// https://infra.spec.whatwg.org/#ascii-whitespace
	return str.replace( /^[\t\n\f\r ]+/, '' ).replace( /[\t\n\f\r ]+$/, '' );
}

module.exports = {
	getNativeRange: getNativeRange,
	closestElement: closestElement,
	htmlTrim: htmlTrim
};
