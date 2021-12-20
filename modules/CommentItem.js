var ThreadItem = require( './ThreadItem.js' );

/**
 * A comment item
 *
 * @class CommentItem
 * @extends ThreadItem
 * @constructor
 * @param {number} level
 * @param {Object} range
 * @param {Object[]} [signatureRanges] Objects describing the extent of signatures (plus
 *  timestamps) for this comment. There is always at least one signature, but there may be
 *  multiple. The author and timestamp of the comment is determined from the first signature.
 *  The last node in every signature range is a node containing the timestamp.
 * @param {moment} [timestamp] Timestamp (Moment object)
 * @param {string} [author] Comment author's username
 */
function CommentItem( level, range, signatureRanges, timestamp, author ) {
	// Parent constructor
	CommentItem.super.call( this, 'comment', level, range );

	this.signatureRanges = signatureRanges || [];
	this.timestamp = timestamp || null;
	this.author = author || null;

	/**
	 * @member {ThreadItem} Parent thread item
	 */
	this.parent = null;
}

OO.inheritClass( CommentItem, ThreadItem );

/**
 * @return {HeadingItem} Closest ancestor which is a HeadingItem
 */
CommentItem.prototype.getHeading = function () {
	var parent = this;
	while ( parent && parent.type !== 'heading' ) {
		parent = parent.parent;
	}
	return parent;
};

/**
 * @return {HeadingItem|null} losest heading that can be used for topic subscriptions
 */
CommentItem.prototype.getSubscribableHeading = function () {
	var heading = this.getHeading();
	while ( heading && heading.type === 'heading' && !heading.isSubscribable() ) {
		heading = heading.parent;
	}
	return ( heading && heading.type === 'heading' ) ? heading : null;
};

// TODO: Implement getBodyRange/getBodyHTML/getBodyText/getMentions if required

module.exports = CommentItem;
