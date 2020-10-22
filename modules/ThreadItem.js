/* global moment */
/**
 * @external CommentItem
 */

var utils = require( './utils.js' );

/**
 * A thread item, either a heading or a comment
 *
 * @class ThreadItem
 * @constructor
 * @param {string} type `heading` or `comment`
 * @param {number} level Indentation level
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

	this.rootNode = null;
}

OO.initClass( ThreadItem );

/**
 * Create a new ThreadItem from a JSON serialization
 *
 * @param {string|Object} json JSON serialization or hash object
 * @param {Object} commentsById Collection of comments by ID for building replies/parent pointers
 * @param {Node} placeholderNode Placeholder node in the DOM which contained this JSON
 * @return {ThreadItem}
 * @throws {Error} Unknown ThreadItem type
 */
ThreadItem.static.newFromJSON = function ( json, commentsById, placeholderNode ) {
	// The page can be served from the HTTP cache (Varnish), and the JSON may be generated
	// by an older version of our PHP code. Code below must be able to handle that.
	// See ThreadItem::jsonSerialize() in PHP.

	var CommentItem, HeadingItem, item, idEscaped,
		hash = typeof json === 'string' ? JSON.parse( json ) : json;
	switch ( hash.type ) {
		case 'comment':
			// Late require to avoid circular dependency
			CommentItem = require( './CommentItem.js' );
			item = new CommentItem(
				hash.level,
				hash.range,
				hash.signatureRanges,
				moment( hash.timestamp ),
				hash.author
			);
			break;
		case 'heading':
			HeadingItem = require( './HeadingItem.js' );
			item = new HeadingItem(
				hash.range,
				hash.headingLevel,
				hash.placeholderHeading
			);
			break;
		default:
			throw new Error( 'Unknown ThreadItem type ' + hash.name );
	}

	item.id = hash.id;

	if ( hash.type === 'comment' ) {
		idEscaped = $.escapeSelector( item.id );
		item.range = {
			startContainer: document.querySelector( '[data-mw-comment-start="' + idEscaped + '"]' ),
			startOffset: 0,
			endContainer: document.querySelector( '[data-mw-comment-end="' + idEscaped + '"]' ),
			endOffset: 0
		};
	} else {
		item.range = {
			startContainer: placeholderNode,
			startOffset: 0,
			endContainer: placeholderNode,
			endOffset: 0
		};
	}

	// Setup replies/parent pointers
	item.replies = hash.replies.map( function ( id ) {
		commentsById[ id ].parent = item;
		return commentsById[ id ];
	} );

	return item;
};

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

/**
 * Get the name of the page from which this thread item is transcluded (if any).
 *
 * @return {string|boolean} `false` if this item is not transcluded. A string if it's transcluded
 *   from a single page (the page title, in text form with spaces). `true` if it's transcluded, but
 *   we can't determine the source.
 */
ThreadItem.prototype.getTranscludedFrom = function () {
	var coveredNodes, i, node, dataMw;

	// If some template is used within the comment (e.g. {{ping|…}} or {{tl|…}}, or a
	// non-substituted signature template), that *does not* mean the comment is transcluded.
	// We only want to consider comments to be transcluded if all wrapper elements (usually
	// <li> or <p>) are marked as part of a single transclusion.

	// If we can't find "exact" wrappers, using only the end container works out well
	// (because the main purpose of this method is to decide on which page we should post
	// replies to the given comment, and they'll go after the comment).

	coveredNodes = utils.getFullyCoveredSiblings( this ) ||
		[ this.range.endContainer ];

	node = utils.getTranscludedFromElement( coveredNodes[ 0 ] );
	for ( i = 1; i < coveredNodes.length; i++ ) {
		if ( node !== utils.getTranscludedFromElement( coveredNodes[ i ] ) ) {
			// Comment is only partially transcluded, that should be fine
			return false;
		}
	}

	if ( !node ) {
		// No mw:Transclusion node found, this item is not transcluded
		return false;
	}

	dataMw = JSON.parse( node.getAttribute( 'data-mw' ) );

	// Only return a page name if this is a simple single-template transclusion.
	if (
		dataMw &&
		dataMw.parts &&
		dataMw.parts.length === 1 &&
		dataMw.parts[ 0 ].template &&
		dataMw.parts[ 0 ].template.target.href
	) {
		// Slice off the './' prefix and convert to text form (underscores to spaces, URL-decoded)
		return mw.libs.ve.normalizeParsoidResourceName( dataMw.parts[ 0 ].template.target.href );
	}

	// Multi-template transclusion, or a parser function call, or template-affected wikitext outside
	// of a template call, or a mix of the above
	return true;
};

/**
 * Return a native Range object corresponding to the item's range.
 *
 * @return {Range}
 */
ThreadItem.prototype.getNativeRange = function () {
	var
		doc = this.range.startContainer.ownerDocument,
		nativeRange = doc.createRange();
	nativeRange.setStart( this.range.startContainer, this.range.startOffset );
	nativeRange.setEnd( this.range.endContainer, this.range.endOffset );
	return nativeRange;
};

// TODO: Implement getHTML/getText if required

module.exports = ThreadItem;
