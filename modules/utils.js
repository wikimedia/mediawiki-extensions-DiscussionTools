'use strict';

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
	// the 'mw:Entity' hack in parser#findTimestamps and adjust accordingly.
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
	childIndexOf: childIndexOf,
	closestElement: closestElement,
	htmlTrim: htmlTrim
};
