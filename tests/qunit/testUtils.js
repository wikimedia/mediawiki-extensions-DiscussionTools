/**
 * @external CommentItem
 */

var
	utils = require( 'ext.discussionTools.init' ).utils;

module.exports = {};

/* eslint-disable qunit/no-commented-tests */
/**
 * Create a QUnit environment that will automatically restore the parser data and config at the end
 * of every test (so that we can use #overrideParserData and #overrideMwConfig without thinking
 * about cleaning it up).
 *
 * @return {Object}
 */
module.exports.newEnvironment = function () {
	var originalParserData = $.extend(
		{},
		mw.loader.moduleRegistry[ 'ext.discussionTools.init' ].packageExports[ 'parser/data.json' ]
	);

	return QUnit.newMwEnvironment( {
		afterEach: function () {
			module.exports.overrideParserData( originalParserData );
			// mw.config is restored by QUnit.newMwEnvironment already
		}
	} );
};

/**
 * Override the parser data with the given data. Used for testing different languages etc.
 *
 * @param {Object} data
 */
module.exports.overrideParserData = function ( data ) {
	$.extend(
		mw.loader.moduleRegistry[ 'ext.discussionTools.init' ].packageExports[ 'parser/data.json' ],
		data
	);
};

/**
 * Override mw.config with the given data. Used for testing different languages etc.
 *
 * @param {Object} config
 */
module.exports.overrideMwConfig = function ( config ) {
	$.extend(
		mw.config.values,
		config
	);
};

/**
 * Get the offset path from ancestor to offset in descendant
 *
 * @copyright 2011-2019 VisualEditor Team and others; see http://ve.mit-license.org
 *
 * @param {Node} ancestor The ancestor node
 * @param {Node} node The descendant node
 * @param {number} nodeOffset The offset in the descendant node
 * @return {number[]} The offset path
 */
function getOffsetPath( ancestor, node, nodeOffset ) {
	var path = [ nodeOffset ];
	while ( node !== ancestor ) {
		if ( node.parentNode === null ) {
			// eslint-disable-next-line no-console
			console.log( node, 'is not a descendant of', ancestor );
			throw new Error( 'Not a descendant' );
		}
		path.unshift( utils.childIndexOf( node ) );
		node = node.parentNode;
	}
	return path;
}

/**
 * Massage comment data to make it serializable as JSON.
 *
 * @param {CommentItem} parent Comment item; modified in-place
 * @param {Node} root Ancestor node of all comments
 */
module.exports.serializeComments = function ( parent, root ) {
	if ( !parent.range.startContainer ) {
		// Already done as part of a different thread
		return;
	}

	// Can't serialize circular structures to JSON
	delete parent.parent;

	// Can't serialize the DOM nodes involved in the range,
	// instead use their offsets within their parent nodes
	parent.range = [
		getOffsetPath( root, parent.range.startContainer, parent.range.startOffset ).join( '/' ),
		getOffsetPath( root, parent.range.endContainer, parent.range.endOffset ).join( '/' )
	];
	if ( parent.signatureRanges ) {
		parent.signatureRanges = parent.signatureRanges.map( function ( range ) {
			return [
				getOffsetPath( root, range.startContainer, range.startOffset ).join( '/' ),
				getOffsetPath( root, range.endContainer, range.endOffset ).join( '/' )
			];
		} );
	}

	// Unimportant
	delete parent.rootNode;

	parent.replies.forEach( function ( comment ) {
		module.exports.serializeComments( comment, root );
	} );
};
