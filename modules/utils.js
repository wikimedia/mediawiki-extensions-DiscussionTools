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
 * @param {Node} el
 * @param {string[]} tagNames
 * @return {HTMLElement|null}
 */
function closestElement( el, tagNames ) {
	do {
		if ( el.nodeType === Node.ELEMENT_NODE && tagNames.indexOf( el.tagName.toLowerCase() ) !== -1 ) {
			return el;
		}
		el = el.parentNode;
	} while ( el );
	return null;
}

module.exports = {
	getNativeRange: getNativeRange,
	closestElement: closestElement
};
