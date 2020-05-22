var ThreadItem = require( './ThreadItem.js' );

function HeadingItem( range, placeholderHeading ) {
	// Parent constructor
	HeadingItem.super.call( this, 'heading', 0, range );

	if ( placeholderHeading ) {
		this.placeholderHeading = true;
	}
}

OO.inheritClass( HeadingItem, ThreadItem );

module.exports = HeadingItem;
