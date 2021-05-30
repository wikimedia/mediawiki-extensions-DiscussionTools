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
	 * @member {string} Name for this comment, intended to be used to
	 *  find this comment in other revisions of the same page
	 */
	this.name = null;
	/**
	 * @member {string} Unique ID (within the page) for this comment
	 */
	this.id = null;
	/**
	 * @member {ThreadItem[]} Replies to this thread item
	 */
	this.replies = [];

	/**
	 * @member {string[]} Warnings
	 */
	this.warnings = [];

	this.rootNode = null;
}

OO.initClass( ThreadItem );

/**
 * Create a new ThreadItem from a JSON serialization
 *
 * @param {string|Object} json JSON serialization or hash object
 * @param {Object} commentsById Collection of comments by ID for building replies/parent pointers
 * @return {ThreadItem}
 * @throws {Error} Unknown ThreadItem type
 */
ThreadItem.static.newFromJSON = function ( json, commentsById ) {
	// The page can be served from the HTTP cache (Varnish), and the JSON may be generated
	// by an older version of our PHP code. Code below must be able to handle that.
	// See ThreadItem::jsonSerialize() in PHP.

	var hash = typeof json === 'string' ? JSON.parse( json ) : json;

	var item;
	switch ( hash.type ) {
		case 'comment':
			// Late require to avoid circular dependency
			var CommentItem = require( './CommentItem.js' );
			item = new CommentItem(
				hash.level,
				hash.range,
				hash.signatureRanges,
				moment( hash.timestamp ),
				hash.author
			);
			break;
		case 'heading':
			var HeadingItem = require( './HeadingItem.js' );
			item = new HeadingItem(
				hash.range,
				hash.headingLevel,
				hash.placeholderHeading
			);
			break;
		default:
			throw new Error( 'Unknown ThreadItem type ' + hash.name );
	}
	item.name = hash.name;
	item.id = hash.id;

	var idEscaped = $.escapeSelector( item.id );
	var startMarker = document.getElementById( item.id );
	var endMarker = document.querySelector( '[data-mw-comment-end="' + idEscaped + '"]' );

	item.range = {
		// Start range after startMarker, because it produces funny results from getBoundingClientRect
		startContainer: startMarker.parentNode,
		startOffset: utils.childIndexOf( startMarker ) + 1,
		// End range inside endMarker, because modifier crashes if endContainer is a <p>/<dd>/<li> node
		endContainer: endMarker,
		endOffset: 0
	};

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
	// If some template is used within the comment (e.g. {{ping|…}} or {{tl|…}}, or a
	// non-substituted signature template), that *does not* mean the comment is transcluded.
	// We only want to consider comments to be transcluded if all wrapper elements (usually
	// <li> or <p>) are marked as part of a single transclusion.

	// If we can't find "exact" wrappers, using only the end container works out well
	// (because the main purpose of this method is to decide on which page we should post
	// replies to the given comment, and they'll go after the comment).

	var coveredNodes = utils.getFullyCoveredSiblings( this ) ||
		[ this.range.endContainer ];

	var node = utils.getTranscludedFromElement( coveredNodes[ 0 ] );
	for ( var i = 1; i < coveredNodes.length; i++ ) {
		if ( node !== utils.getTranscludedFromElement( coveredNodes[ i ] ) ) {
			// Comment is only partially transcluded, that should be fine
			return false;
		}
	}

	if ( !node ) {
		// No mw:Transclusion node found, this item is not transcluded
		return false;
	}

	var dataMw = JSON.parse( node.getAttribute( 'data-mw' ) );

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
	var doc = this.range.startContainer.ownerDocument;
	var nativeRange = doc.createRange();
	nativeRange.setStart( this.range.startContainer, this.range.startOffset );
	nativeRange.setEnd( this.range.endContainer, this.range.endOffset );
	return nativeRange;
};

// TODO: Implement getHTML/getText if required

module.exports = ThreadItem;
