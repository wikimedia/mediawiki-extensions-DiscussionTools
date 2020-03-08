'use strict';

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
	closestElement: closestElement
};
