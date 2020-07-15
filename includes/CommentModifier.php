<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Wikimedia\Parsoid\Utils\DOMCompat;

class CommentModifier {

	private function __construct() {
	}

	/**
	 * Add an attribute to a list item to remove pre-whitespace in Parsoid
	 *
	 * @param DOMElement $listItem List item element
	 */
	private static function whitespaceParsoidHack( DOMElement $listItem ) : void {
		// HACK: Setting data-parsoid removes the whitespace after the list item,
		// which makes nested lists work.
		// This is undocumented behaviour and probably very fragile.
		$listItem->setAttribute( 'data-parsoid', '{}' );
	}

	private static $blockElementTypes = [
		'div', 'p',
		// Tables
		'table', 'tbody', 'thead', 'tfoot', 'caption', 'th', 'tr', 'td',
		// Lists
		'ul', 'ol', 'li', 'dl', 'dt', 'dd',
		// HTML5 heading content
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup',
		// HTML5 sectioning content
		'article', 'aside', 'body', 'nav', 'section', 'footer', 'header', 'figure',
		'figcaption', 'fieldset', 'details', 'blockquote',
		// Other
		'hr', 'button', 'canvas', 'center', 'col', 'colgroup', 'embed',
		'map', 'object', 'pre', 'progress', 'video'
	];

	/**
	 * @param DOMNode $node Node
	 * @return bool Node is a block element
	 */
	private static function isBlockElement( DOMNode $node ) : bool {
		return $node instanceof DOMElement &&
			in_array( strtolower( $node->tagName ), self::$blockElementTypes );
	}

	/**
	 * Remove extra linebreaks from a wikitext string
	 *
	 * @param string $wikitext Wikitext
	 * @return string
	 */
	public static function sanitizeWikitextLinebreaks( string $wikitext ) : string {
		$wikitext = CommentUtils::htmlTrim( $wikitext );
		$wikitext = preg_replace( "/\r/", "\n", $wikitext );
		$wikitext = preg_replace( "/\n+/", "\n", $wikitext );
		return $wikitext;
	}

	/**
	 * Given a comment and a reply link, add the reply link to its document's DOM tree, at the end of
	 * the comment.
	 *
	 * @param CommentItem $comment Comment data returned by parser#groupThreads
	 * @param DOMElement $linkNode Reply link
	 */
	public static function addReplyLink( CommentItem $comment, DOMElement $linkNode ) : void {
		$target = $comment->getRange()->endContainer;

		// Skip to the end of the "paragraph". This only looks at tag names and can be fooled by CSS, but
		// avoiding that would be more difficult and slower.
		while ( $target->nextSibling && !self::isBlockElement( $target->nextSibling ) ) {
			$target = $target->nextSibling;
		}

		// Insert the link before trailing whitespace.
		// In the MediaWiki parser output, <ul>/<dl> nodes are preceded by a newline. Normally it isn't
		// visible on the page. But if we insert an inline element (the reply link) after it, it becomes
		// meaningful and gets rendered, which results in additional spacing before some reply links.
		// Split the text node, so that we can insert the link before the trailing whitespace.
		if ( $target->nodeType === XML_TEXT_NODE ) {
			preg_match( '/\s*$/', $target->nodeValue, $matches, PREG_OFFSET_CAPTURE );
			$byteOffset = $matches[0][1];
			$charOffset = mb_strlen(
				substr( $target->nodeValue, 0, $byteOffset )
			);
			$target->splitText( $charOffset );
		}

		$target->parentNode->insertBefore( $linkNode, $target->nextSibling );
	}

	/**
	 * Given a comment, add a list item to its document's DOM tree, inside of which a reply to said
	 * comment can be added.
	 *
	 * The DOM tree is suitably rearranged to ensure correct indentation level of the reply (wrapper
	 * nodes are added, and other nodes may be moved around).
	 *
	 * @param CommentItem $comment Comment data returned by parser#groupThreads
	 * @return DOMElement
	 */
	public static function addListItem( CommentItem $comment ) : DOMElement {
		$listTypeMap = [
			'li' => 'ul',
			'dd' => 'dl'
		];

		// 1. Start at given comment
		// 2. Skip past all comments with level greater than the given
		//    (or in other words, all replies, and replies to replies, and so on)
		// 3. Add comment with level of the given comment plus 1

		$curComment = $comment;
		while ( count( $curComment->getReplies() ) ) {
			$replies = $curComment->getReplies();
			$curComment = end( $replies );
		}

		$desiredLevel = $comment->getLevel() + 1;
		$curLevel = $curComment->getLevel();
		$target = $curComment->getRange()->endContainer;

		// Skip to the end of the "paragraph". This only looks at tag names and can be fooled by CSS, but
		// avoiding that would be more difficult and slower.
		while ( $target->nextSibling && !self::isBlockElement( $target->nextSibling ) ) {
			$target = $target->nextSibling;
		}

		// target is a text node or an inline element at the end of a "paragraph"
		// (not necessarily paragraph node).
		// First, we need to find a block-level parent that we can mess with.
		// If we can't find a surrounding list item or paragraph (e.g. maybe we're inside a table cell
		// or something), take the parent node and hope for the best.
		$parent = CommentUtils::closestElement( $target, [ 'li', 'dd', 'p' ] ) ??
			$target->parentNode;
		while ( $target->parentNode !== $parent ) {
			$target = $target->parentNode;
		}
		// parent is a list item or paragraph (hopefully)
		// target is an inline node within it

		$item = null;
		if ( $curLevel < $desiredLevel ) {
			// Insert more lists after the target to increase nesting.

			// If the comment is fully covered by some wrapper element, insert replies outside that wrapper.
			// This will often just be a paragraph node (<p>), but it can be a <div> or <table> that serves
			// as some kind of a fancy frame, which are often used for barnstars and announcements.
			if ( $curLevel === 1 && ( $wrapper = CommentUtils::getFullyCoveredWrapper( $curComment ) ) ) {
				$target = $wrapper;
				$parent = $target->parentNode;
			}

			// If we can't insert a list directly inside this element, insert after it.
			// The wrapper check above handles most cases, but this special case is still needed for comments
			// consisting of multiple paragraphs with no fancy frames.
			// TODO Improve this check
			if ( strtolower( $parent->tagName ) === 'p' || strtolower( $parent->tagName ) === 'pre' ) {
				$parent = $parent->parentNode;
				$target = $target->parentNode;
			}

			// Decide on tag names for lists and items
			$itemType = strtolower( $parent->tagName );
			$itemType = isset( $listTypeMap[ $itemType ] ) ? $itemType : 'dd';
			$listType = $listTypeMap[ $itemType ];

			// Insert required number of wrappers
			while ( $curLevel < $desiredLevel ) {
				$list = $target->ownerDocument->createElement( $listType );
				// Setting modified would only be needed for removeAddedListItem,
				// which isn't needed on the server
				// $list->setAttribute( 'dt-modified', 'new' );
				$item = $target->ownerDocument->createElement( $itemType );
				// $item->setAttribute( 'dt-modified', 'new' );
				self::whitespaceParsoidHack( $item );

				$parent->insertBefore( $list, $target->nextSibling );
				$list->appendChild( $item );

				$target = $item;
				$parent = $list;
				$curLevel++;
			}
		} else {
			// Split the ancestor nodes after the target to decrease nesting.

			do {
				// If target is the last child of its parent, no need to split it
				if ( $target->nextSibling ) {
					// Create new identical node after the parent
					$newNode = $parent->cloneNode( false );
					// $parent->setAttribute( 'dt-modified', 'split' );
					$parent->parentNode->insertBefore( $newNode, $parent->nextSibling );

					// Move nodes following target to the new node
					while ( $target->nextSibling ) {
						$newNode->appendChild( $target->nextSibling );
					}
				}

				$target = $parent;
				$parent = $parent->parentNode;

				// Decrease nesting level if we escaped outside of a list
				if ( isset( $listTypeMap[ strtolower( $target->tagName ) ] ) ) {
					$curLevel--;
				}
			} while ( $curLevel >= $desiredLevel );

			// parent is now a list, target is a list item
			$item = $target->ownerDocument->createElement( $target->tagName );
			// $item->setAttribute( 'dt-modified', 'new' );
			self::whitespaceParsoidHack( $item );
			$parent->insertBefore( $item, $target->nextSibling );
		}

		if ( $item === null ) {
			throw new \LogicException( __METHOD__ . ' no item found' );
		}

		return $item;
	}

	// removeAddedListItem is only needed in the client

	/**
	 * Unwrap a top level list, converting list item text to paragraphs
	 *
	 * Assumes that the list has a parent node.
	 *
	 * @param DOMnode $list DOM node, will be wrapepd if it is a list element (dl/ol/ul)
	 */
	public static function unwrapList( DOMnode $list ) : void {
		$doc = $list->ownerDocument;
		$container = $list->parentNode;
		$referenceNode = $list;

		if ( !(
			$list instanceof DOMElement && (
				strtolower( $list->tagName ) === 'dl' ||
				strtolower( $list->tagName ) === 'ol' ||
				strtolower( $list->tagName ) === 'ul'
			)
		) ) {
			// Not a list, leave alone (e.g. auto-generated ref block)
			return;
		}

		// If the whole list is a template return it unmodified (T253150)
		if ( CommentUtils::getTranscludedFromElement( $list ) ) {
			return;
		}

		while ( $list->firstChild ) {
			if ( $list->firstChild->nodeType === XML_ELEMENT_NODE ) {
				// Move <dd> contents to <p>
				$p = $doc->createElement( 'p' );
				while ( $list->firstChild->firstChild ) {
					// If contents is a block element, place outside the paragraph
					// and start a new paragraph after
					if ( self::isBlockElement( $list->firstChild->firstChild ) ) {
						if ( $p->firstChild ) {
							$insertBefore = $referenceNode->nextSibling;
							$referenceNode = $p;
							$container->insertBefore( $p, $insertBefore );
						}
						$insertBefore = $referenceNode->nextSibling;
						$referenceNode = $list->firstChild->firstChild;
						$container->insertBefore( $list->firstChild->firstChild, $insertBefore );
						$p = $doc->createElement( 'p' );
					} else {
						$p->appendChild( $list->firstChild->firstChild );
					}
				}
				if ( $p->firstChild ) {
					$insertBefore = $referenceNode->nextSibling;
					$referenceNode = $p;
					$container->insertBefore( $p, $insertBefore );
				}
				$list->removeChild( $list->firstChild );
			} else {
				// Text node / comment node, probably empty
				$insertBefore = $referenceNode->nextSibling;
				$referenceNode = $list->firstChild;
				$container->insertBefore( $list->firstChild, $insertBefore );
			}
		}
		$container->removeChild( $list );
	}

	/**
	 * Add another list item after the given one.
	 *
	 * @param DOMElement $previousItem
	 * @return DOMElement
	 */
	public static function addSiblingListItem( DOMElement $previousItem ) : DOMElement {
		$listItem = $previousItem->ownerDocument->createElement( $previousItem->tagName );
		self::whitespaceParsoidHack( $listItem );
		$previousItem->parentNode->insertBefore( $listItem, $previousItem->nextSibling );
		return $listItem;
	}

	/**
	 * Create an element that will convert to the provided wikitext
	 *
	 * @param DOMDocument $doc Document
	 * @param string $wt Wikitext
	 * @return DOMElement Element
	 */
	public static function createWikitextNode( DOMDocument $doc, string $wt ) : DOMElement {
		$span = $doc->createElement( 'span' );

		$span->setAttribute( 'typeof', 'mw:Transclusion' );
		$span->setAttribute( 'data-mw', json_encode( [ 'parts' => [ $wt ] ] ) );

		return $span;
	}

	/**
	 * Check whether wikitext contains a user signature.
	 *
	 * @param string $wikitext
	 * @return bool
	 */
	public static function isWikitextSigned( string $wikitext ) : bool {
		$wikitext = CommentUtils::htmlTrim( $wikitext );
		// Contains ~~~~ (four tildes), but not ~~~~~ (five tildes), at the end.
		return (bool)preg_match( '/([^~]|^)~~~~$/', $wikitext );
	}

	/**
	 * Check whether HTML node contains a user signature.
	 *
	 * @param DOMElement $container
	 * @return bool
	 */
	public static function isHtmlSigned( DOMElement $container ) : bool {
		$xpath = new DOMXPath( $container->ownerDocument );
		// Good enough?…
		$matches = $xpath->query( './/span[@typeof="mw:Transclusion"][contains(@data-mw,"~~~~")]', $container );
		if ( $matches->length === 0 ) {
			return false;
		}
		$lastSig = $matches->item( $matches->length - 1 );
		// Signature must be at the end of the comment - there must be no sibling following this node, or its parents
		$node = $lastSig;
		while ( $node ) {
			// Skip over whitespace nodes
			while (
				$node->nextSibling &&
				$node->nextSibling->nodeType === XML_TEXT_NODE &&
				CommentUtils::htmlTrim( $node->nextSibling->nodeValue ) === ''
			) {
				$node = $node->nextSibling;
			}
			if ( $node->nextSibling ) {
				return false;
			}
			$node = $node->parentNode;
		}
		return true;
	}

	/**
	 * Append a user signature to the comment in the container.
	 *
	 * @param DOMElement $container
	 */
	private static function appendSignature( DOMElement $container ) : void {
		$doc = $container->ownerDocument;

		// If the last node isn't a paragraph (e.g. it's a list created in visual mode), then
		// add another paragraph to contain the signature.
		if ( strtolower( $container->lastChild->nodeName ) !== 'p' ) {
			$container->appendChild( $doc->createElement( 'p' ) );
		}
		// Sign the last line
		// TODO: When we implement posting new topics, the leading space will create an indent-pre
		$container->lastChild->appendChild(
			self::createWikitextNode(
				$doc,
				wfMessage( 'discussiontools-signature-prefix' )->inContentLanguage()->text() . '~~~~'
			)
		);
	}

	/**
	 * Add a reply to a specific comment
	 *
	 * @param CommentItem $comment Comment being replied to
	 * @param DOMElement $container Container of comment DOM nodes
	 */
	public static function addReply( CommentItem $comment, DOMElement $container ) {
		$newParsoidItem = null;
		// Transfer comment DOM to Parsoid DOM
		// Wrap every root node of the document in a new list item (dd/li).
		// In wikitext mode every root node is a paragraph.
		// In visual mode the editor takes care of preventing problematic nodes
		// like <table> or <h2> from ever occurring in the comment.
		while ( $container->childNodes->length ) {
			if ( !$newParsoidItem ) {
				$newParsoidItem = self::addListItem( $comment );
			} else {
				$newParsoidItem = self::addSiblingListItem( $newParsoidItem );
			}
			$newParsoidItem->appendChild( $container->firstChild );
		}
	}

	/**
	 * Create a container of comment DOM nodes from wikitext
	 *
	 * @param CommentItem $comment Comment being replied to
	 * @param string $wikitext Wikitext
	 */
	public static function addWikitextReply( $comment, $wikitext ) {
		$doc = $comment->getRange()->endContainer->ownerDocument;
		$container = $doc->createElement( 'div' );

		$wikitext = self::sanitizeWikitextLinebreaks( $wikitext );

		$lines = explode( "\n", $wikitext );
		foreach ( $lines as $line ) {
			$p = $doc->createElement( 'p' );
			$p->appendChild( self::createWikitextNode( $doc, $line ) );
			$container->appendChild( $p );
		}

		if ( !self::isWikitextSigned( $wikitext ) ) {
			self::appendSignature( $container );
		}

		self::addReply( $comment, $container );
	}

	/**
	 * Create a container of comment DOM nodes from HTML
	 *
	 * @param CommentItem $comment Comment being replied to
	 * @param string $html HTML
	 */
	public static function addHtmlReply( $comment, $html ) {
		$doc = $comment->getRange()->endContainer->ownerDocument;
		$container = $doc->createElement( 'div' );

		DOMCompat::setInnerHTML( $container, $html );
		// Remove empty lines
		// This should really be anything that serializes to empty string in wikitext,
		// (e.g. <h2></h2>) but this will catch most cases
		// Create a non-live child node list, so we don't have to worry about it changing
		// as nodes are removed.
		$childNodeList = iterator_to_array( $container->childNodes );
		foreach ( $childNodeList as $node ) {
			if (
				strtolower( $node->nodeName ) === 'p' &&
				CommentUtils::htmlTrim( DOMCompat::getInnerHTML( $node ) ) === ''
			) {
				$container->removeChild( $node );
			}
		}

		if ( !self::isHtmlSigned( $container ) ) {
			self::appendSignature( $container );
		}

		self::addReply( $comment, $container );
	}

}
