var ThreadItem = require( './ThreadItem.js' ),
	utils = require( './utils.js' );

/**
 * A heading item
 *
 * @class HeadingItem
 * @extends ThreadItem
 * @constructor
 * @param {Object} range
 * @param {number} headingLevel Heading level (1-6)
 * @param {boolean} [placeholderHeading] Item doesn't correspond to a real heading (e.g. 0th section)
 */
function HeadingItem( range, headingLevel, placeholderHeading ) {
	// Parent constructor
	HeadingItem.super.call( this, 'heading', 0, range );

	this.headingLevel = headingLevel;
	this.placeholderHeading = !!placeholderHeading;
}

OO.inheritClass( HeadingItem, ThreadItem );

HeadingItem.prototype.getLinkableTitle = function () {
	var title = '';
	// If this comment is in 0th section, there's no section title for the edit summary
	if ( !this.placeholderHeading ) {
		var headingNode = utils.getHeadlineNodeAndOffset( this.range.startContainer ).node;
		var id = headingNode.getAttribute( 'id' );
		if ( id ) {
			// Replace underscores with spaces to undo Sanitizer::escapeIdInternal().
			// This assumes that $wgFragmentMode is [ 'html5', 'legacy' ] or [ 'html5' ],
			// otherwise the escaped IDs are super garbled and can't be unescaped reliably.
			title = id.replace( /_/g, ' ' );
		}
		// else: Not a real section, probably just HTML markup in wikitext
	}
	return title;
};

/**
 * @return {HeadingItem} Closest ancestor which is a HeadingItem
 */
HeadingItem.prototype.getHeading = function () {
	return this;
};

module.exports = HeadingItem;
