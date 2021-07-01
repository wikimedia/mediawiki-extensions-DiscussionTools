/**
 * More information about a comment obtained from various APIs, rather than parsed from the page.
 *
 * @class CommentDetails
 * @constructor
 * @param {string} pageName Page name the reply is being saved to
 * @param {number} oldId Revision ID of page at time of editing
 */
function CommentDetails( pageName, oldId ) {
	this.pageName = pageName;
	this.oldId = oldId;
}

OO.initClass( CommentDetails );

module.exports = CommentDetails;
