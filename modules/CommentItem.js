var ThreadItem = require( './ThreadItem.js' );

function CommentItem( level, range, signatureRanges, timestamp, author ) {
	// Parent constructor
	CommentItem.super.call( this, 'comment', level, range );

	this.signatureRanges = signatureRanges || [];
	this.timestamp = timestamp || null;
	this.author = author || null;
}

OO.inheritClass( CommentItem, ThreadItem );

module.exports = CommentItem;
