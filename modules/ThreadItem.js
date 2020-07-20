/**
 * @external CommentItem
 */

/**
 * A thread item, either a heading or a comment
 *
 * @class ThreadItem
 * @constructor
 * @param {string} type `heading` or `comment`
 * @param {number} level Item level in the thread tree
 * @param {Object} range Object describing the extent of the comment, including the
 *  signature and timestamp. It has the same properties as a Range object: `startContainer`,
 *  `startOffset`, `endContainer`, `endOffset` (we don't use a real Range because they change
 *  magically when the DOM structure changes).
 */
function ThreadItem( type, level, range ) {
	this.type = type;
	this.level = level;
	this.range = range;

	/**
	 * @member {string} Unique ID (within the page) for this comment, intended to be used to
	 *  find this comment in other revisions of the same page
	 */
	this.id = null;
	/**
	 * @member {CommentItem[]} Replies to this thread item
	 */
	this.replies = [];
}

OO.initClass( ThreadItem );

/**
 * Get the list of authors in the comment tree below this thread item.
 *
 * Usually called on a HeadingItem to find all authors in a thread.
 *
 * @return {string[]} Author usernames
 */
ThreadItem.prototype.getAuthorsBelow = function () {
	var authors = {};
	function getAuthorSet( comment ) {
		authors[ comment.author ] = true;
		// Get the set of authors in the same format from each reply
		comment.replies.map( getAuthorSet );
	}

	this.replies.map( getAuthorSet );

	return Object.keys( authors ).sort();
};

module.exports = ThreadItem;
