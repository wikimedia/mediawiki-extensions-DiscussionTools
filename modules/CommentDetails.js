/**
 * More information about a comment obtained from various APIs, rather than parsed from the page.
 *
 * @class CommentDetails
 * @constructor
 * @param {string} pageName Page name the reply is being saved to
 * @param {number} oldId Revision ID of page at time of editing
 * @param {Object.<string,string>} notices Edit notices for the page where the reply is being saved.
 *     Keys are message names; values are HTML to display.
 */
function CommentDetails( pageName, oldId, notices ) {
	this.pageName = pageName;
	this.oldId = oldId;
	this.notices = notices;
}

OO.initClass( CommentDetails );

module.exports = CommentDetails;
