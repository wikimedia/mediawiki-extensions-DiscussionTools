'use strict';
/* global $:off */

/**
 * @external CommentItem
 */

var
	utils = require( './utils.js' );

/**
 * Add an attribute to a list item to remove pre-whitespace in Parsoid
 *
 * @param {HTMLElement} listItem List item element
 */
function whitespaceParsoidHack( listItem ) {
	// HACK: Setting data-parsoid removes the whitespace after the list item,
	// which makes nested lists work.
	// This is undocumented behaviour and probably very fragile.
	listItem.setAttribute( 'data-parsoid', '{}' );
}

/**
 * Auto-sign a wikitext string
 *
 * @param {string} wikitext Wikitext
 * @return {string}
 */
function autoSignWikitext( wikitext ) {
	var matches;
	wikitext = wikitext.trim();
	if ( ( matches = wikitext.match( /~{3,5}$/ ) ) ) {
		// Sig detected, check it has the correct number of tildes
		if ( matches[ 0 ].length !== 4 ) {
			wikitext = wikitext.slice( 0, -matches[ 0 ].length ) + '~~~~';
		}
		// Otherwise 4 tilde signature is left alone,
		// with any adjacent characters
	} else {
		// No sig, append separator and sig
		wikitext += mw.msg( 'discussiontools-signature-prefix' ) + '~~~~';
	}
	return wikitext;
}

/**
 * Remove extra linebreaks from a wikitext string
 *
 * @param {string} wikitext Wikitext
 * @return {string}
 */
function sanitizeWikitextLinebreaks( wikitext ) {
	return wikitext
		.replace( /\r/g, '\n' )
		.replace( /\n+/g, '\n' );
}

/**
 * Given a comment and a reply link, add the reply link to its document's DOM tree, at the end of
 * the comment.
 *
 * @param {CommentItem} comment Comment item
 * @param {HTMLElement} linkNode Reply link
 */
function addReplyLink( comment, linkNode ) {
	var target = comment.range.endContainer;

	// Skip to the end of the "paragraph". This only looks at tag names and can be fooled by CSS, but
	// avoiding that would be more difficult and slower.
	while ( target.nextSibling && !ve.isBlockElement( target.nextSibling ) ) {
		target = target.nextSibling;
	}

	// Insert the link before trailing whitespace.
	// In the MediaWiki parser output, <ul>/<dl> nodes are preceded by a newline. Normally it isn't
	// visible on the page. But if we insert an inline element (the reply link) after it, it becomes
	// meaningful and gets rendered, which results in additional spacing before some reply links.
	// Split the text node, so that we can insert the link before the trailing whitespace.
	if ( target.nodeType === Node.TEXT_NODE ) {
		target.splitText( target.textContent.match( /\s*$/ ).index );
	}

	target.parentNode.insertBefore( linkNode, target.nextSibling );
}

/**
 * Given a comment, add a list item to its document's DOM tree, inside of which a reply to said
 * comment can be added.
 *
 * The DOM tree is suitably rearranged to ensure correct indentation level of the reply (wrapper
 * nodes are added, and other nodes may be moved around).
 *
 * @param {CommentItem} comment Comment item
 * @return {HTMLElement}
 */
function addListItem( comment ) {
	var
		curComment, curLevel, desiredLevel,
		target, parent, covered, listType, itemType, list, item, newNode,
		listTypeMap = {
			li: 'ul',
			dd: 'dl'
		};

	// 1. Start at given comment
	// 2. Skip past all comments with level greater than the given
	//    (or in other words, all replies, and replies to replies, and so on)
	// 3. Add comment with level of the given comment plus 1

	curComment = comment;
	while ( curComment.replies.length ) {
		curComment = curComment.replies[ curComment.replies.length - 1 ];
	}

	desiredLevel = comment.level + 1;
	curLevel = curComment.level;
	target = curComment.range.endContainer;

	// Skip to the end of the "paragraph". This only looks at tag names and can be fooled by CSS, but
	// avoiding that would be more difficult and slower.
	while ( target.nextSibling && !ve.isBlockElement( target.nextSibling ) ) {
		target = target.nextSibling;
	}

	// target is a text node or an inline element at the end of a "paragraph" (not necessarily paragraph node).
	// First, we need to find a block-level parent that we can mess with.
	// If we can't find a surrounding list item or paragraph (e.g. maybe we're inside a table cell
	// or something), take the parent node and hope for the best.
	parent = utils.closestElement( target, [ 'li', 'dd', 'p' ] ) || target.parentNode;
	while ( target.parentNode !== parent ) {
		target = target.parentNode;
	}
	// parent is a list item or paragraph (hopefully)
	// target is an inline node within it

	if ( curLevel < desiredLevel ) {
		// Insert more lists after the target to increase nesting.

		// If the comment is fully covered by some wrapper element, insert replies outside that wrapper.
		// This will often just be a paragraph node (<p>), but it can be a <div> or <table> that serves
		// as some kind of a fancy frame, which are often used for barnstars and announcements.
		covered = utils.getFullyCoveredSiblings( curComment );
		if ( curLevel === 1 && covered ) {
			target = covered[ covered.length - 1 ];
			parent = target.parentNode;
		}

		// If we can't insert a list directly inside this element, insert after it.
		// TODO Figure out if this is still needed, the wrapper check above should handle all cases
		if ( parent.tagName.toLowerCase() === 'p' || parent.tagName.toLowerCase() === 'pre' ) {
			parent = parent.parentNode;
			target = target.parentNode;
		}

		// Decide on tag names for lists and items
		itemType = parent.tagName.toLowerCase();
		itemType = listTypeMap[ itemType ] ? itemType : 'dd';
		listType = listTypeMap[ itemType ];

		// Insert required number of wrappers
		while ( curLevel < desiredLevel ) {
			list = target.ownerDocument.createElement( listType );
			list.discussionToolsModified = 'new';
			item = target.ownerDocument.createElement( itemType );
			item.discussionToolsModified = 'new';
			whitespaceParsoidHack( item );

			parent.insertBefore( list, target.nextSibling );
			list.appendChild( item );

			target = item;
			parent = list;
			curLevel++;
		}
	} else {
		// Split the ancestor nodes after the target to decrease nesting.

		do {
			// If target is the last child of its parent, no need to split it
			if ( target.nextSibling ) {
				// Create new identical node after the parent
				newNode = parent.cloneNode( false );
				parent.discussionToolsModified = 'split';
				parent.parentNode.insertBefore( newNode, parent.nextSibling );

				// Move nodes following target to the new node
				while ( target.nextSibling ) {
					newNode.appendChild( target.nextSibling );
				}
			}

			target = parent;
			parent = parent.parentNode;

			// Decrease nesting level if we escaped outside of a list
			if ( listTypeMap[ target.tagName.toLowerCase() ] ) {
				curLevel--;
			}
		} while ( curLevel >= desiredLevel );

		// parent is now a list, target is a list item
		item = target.ownerDocument.createElement( target.tagName );
		item.discussionToolsModified = 'new';
		whitespaceParsoidHack( item );
		parent.insertBefore( item, target.nextSibling );
	}

	return item;
}

/**
 * Undo the effects of #addListItem, also removing or merging any affected parent nodes.
 *
 * @param {HTMLElement} node
 */
function removeAddedListItem( node ) {
	var nextNode;

	while ( node && node.discussionToolsModified ) {
		if ( node.discussionToolsModified === 'new' ) {
			nextNode = node.previousSibling || node.parentNode;

			// Remove this node
			delete node.discussionToolsModified;
			node.parentNode.removeChild( node );

		} else if ( node.discussionToolsModified === 'split' ) {
			// Children might be split too, if so, descend into them afterwards
			if ( node.lastChild && node.lastChild.discussionToolsModified === 'split' ) {
				node.discussionToolsModified = 'done';
				nextNode = node.lastChild;
			} else {
				delete node.discussionToolsModified;
				nextNode = node.parentNode;
			}
			// Merge the following sibling node back into this one
			while ( node.nextSibling.firstChild ) {
				node.appendChild( node.nextSibling.firstChild );
			}
			node.parentNode.removeChild( node.nextSibling );

		} else {
			nextNode = node.parentNode;
		}

		node = nextNode;
	}
}

/**
 * Unwrap a top level list, converting list item text to paragraphs
 *
 * Assumes that the list has a parent node.
 *
 * @param {Node} list DOM node, will be wrapepd if it is a list element (dl/ol/ul)
 */
function unwrapList( list ) {
	var p, insertBefore,
		doc = list.ownerDocument,
		container = list.parentNode,
		referenceNode = list;

	if ( !(
		list.nodeType === Node.ELEMENT_NODE && (
			list.tagName.toLowerCase() === 'dl' ||
			list.tagName.toLowerCase() === 'ol' ||
			list.tagName.toLowerCase() === 'ul'
		)
	) ) {
		// Not a list, leave alone (e.g. auto-generated ref block)
		return;
	}

	// If the whole list is a template return it unmodified (T253150)
	if ( utils.getTranscludedFromElement( list ) ) {
		return;
	}

	while ( list.firstChild ) {
		if ( list.firstChild.nodeType === Node.ELEMENT_NODE ) {
			// Move <dd> contents to <p>
			p = doc.createElement( 'p' );
			while ( list.firstChild.firstChild ) {
				// If contents is a block element, place outside the paragraph
				// and start a new paragraph after
				if ( ve.isBlockElement( list.firstChild.firstChild ) ) {
					if ( p.firstChild ) {
						insertBefore = referenceNode.nextSibling;
						referenceNode = p;
						container.insertBefore( p, insertBefore );
					}
					insertBefore = referenceNode.nextSibling;
					referenceNode = list.firstChild.firstChild;
					container.insertBefore( list.firstChild.firstChild, insertBefore );
					p = doc.createElement( 'p' );
				} else {
					p.appendChild( list.firstChild.firstChild );
				}
			}
			if ( p.firstChild ) {
				insertBefore = referenceNode.nextSibling;
				referenceNode = p;
				container.insertBefore( p, insertBefore );
			}
			list.removeChild( list.firstChild );
		} else {
			// Text node / comment node, probably empty
			insertBefore = referenceNode.nextSibling;
			referenceNode = list.firstChild;
			container.insertBefore( list.firstChild, insertBefore );
		}
	}
	container.removeChild( list );
}

/**
 * Add another list item after the given one.
 *
 * @param {HTMLElement} previousItem
 * @return {HTMLElement}
 */
function addSiblingListItem( previousItem ) {
	var listItem = previousItem.ownerDocument.createElement( previousItem.tagName );
	whitespaceParsoidHack( listItem );
	previousItem.parentNode.insertBefore( listItem, previousItem.nextSibling );
	return listItem;
}

function createWikitextNode( doc, wt ) {
	var span = doc.createElement( 'span' );

	span.setAttribute( 'typeof', 'mw:Transclusion' );
	span.setAttribute( 'data-mw', JSON.stringify( { parts: [ wt ] } ) );

	return span;
}

/**
 * Add a reply to a specific comment
 *
 * @param {CommentItem} comment Comment being replied to
 * @param {HTMLElement} container Container of comment DOM nodes
 */
function addReply( comment, container ) {
	var newParsoidItem;

	// Transfer comment DOM to Parsoid DOM
	// Wrap every root node of the document in a new list item (dd/li).
	// In wikitext mode every root node is a paragraph.
	// In visual mode the editor takes care of preventing problematic nodes
	// like <table> or <h2> from ever occurring in the comment.
	while ( container.childNodes.length ) {
		if ( !newParsoidItem ) {
			newParsoidItem = addListItem( comment );
		} else {
			newParsoidItem = addSiblingListItem( newParsoidItem );
		}
		newParsoidItem.appendChild( container.firstChild );
	}
}

/**
 * Create a container of comment DOM nodes from wikitext
 *
 * @param {CommentItem} comment Comment being replied to
 * @param {string} wikitext Wikitext
 */
function addWikitextReply( comment, wikitext ) {
	var doc = comment.range.endContainer.ownerDocument,
		container = doc.createElement( 'div' );

	// Use autoSign to avoid double signing
	wikitext = sanitizeWikitextLinebreaks(
		autoSignWikitext(
			wikitext
		)
	);

	wikitext.split( '\n' ).forEach( function ( line ) {
		var p = doc.createElement( 'p' );
		p.appendChild( createWikitextNode( doc, line ) );
		container.appendChild( p );
	} );
	addReply( comment, container );
}

/**
 * Create a container of comment DOM nodes from HTML
 *
 * @param {CommentItem} comment Comment being replied to
 * @param {string} html HTML
 */
function addHtmlReply( comment, html ) {
	var doc = comment.range.endContainer.ownerDocument,
		childNodeList,
		container = doc.createElement( 'div' );

	container.innerHTML = html;
	// Remove empty lines
	// This should really be anything that serializes to empty string in wikitext,
	// (e.g. <h2></h2>) but this will catch most cases
	// Create a non-live child node list, so we don't have to worry about it changing
	// as nodes are removed.
	childNodeList = Array.prototype.slice.call( container.childNodes );
	childNodeList.forEach( function ( node ) {
		if ( node.nodeName.toLowerCase() === 'p' && !utils.htmlTrim( node.innerHTML ) ) {
			container.removeChild( node );
		}
	} );
	// If the last node isn't a paragraph (e.g. it's a list), then
	// add another paragraph to contain the signature.
	if ( container.lastChild.nodeName.toLowerCase() !== 'p' ) {
		container.appendChild( doc.createElement( 'p' ) );
	}
	// Sign the last line
	// TODO: Check if the user tried to sign in visual mode by typing wikitext?
	// TODO: When we implement posting new topics, the leading space will create an indent-pre
	container.lastChild.appendChild( createWikitextNode( doc, mw.msg( 'discussiontools-signature-prefix' ) + '~~~~' ) );
	addReply( comment, container );
}

module.exports = {
	addReplyLink: addReplyLink,
	addListItem: addListItem,
	removeAddedListItem: removeAddedListItem,
	addSiblingListItem: addSiblingListItem,
	unwrapList: unwrapList,
	createWikitextNode: createWikitextNode,
	addWikitextReply: addWikitextReply,
	addHtmlReply: addHtmlReply,
	autoSignWikitext: autoSignWikitext,
	sanitizeWikitextLinebreaks: sanitizeWikitextLinebreaks
};
