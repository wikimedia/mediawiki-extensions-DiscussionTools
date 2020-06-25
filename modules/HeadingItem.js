var ThreadItem = require( './ThreadItem.js' );

/**
 * A heading item
 *
 * @class HeadingItem
 * @extends {ThreadItem}
 * @constructor
 * @param {Object} range
 * @param {boolean} [placeholderHeading] Item doesn't correspond to a real heading (e.g. 0th section)
 */
function HeadingItem( range, placeholderHeading ) {
	// Parent constructor
	HeadingItem.super.call( this, 'heading', 0, range );

	// TODO: Should probably always initialise, but our tests assert it is unset
	if ( placeholderHeading ) {
		this.placeholderHeading = true;
	}
}

OO.inheritClass( HeadingItem, ThreadItem );

module.exports = HeadingItem;
