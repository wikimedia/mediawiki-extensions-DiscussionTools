<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMElement;
use DOMNode;
use DOMXPath;
use MediaWiki\MediaWikiServices;
use Title;

class CommentUtils {
	private function __construct() {
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
	public static function isBlockElement( DOMNode $node ) : bool {
		return $node instanceof DOMElement &&
			in_array( strtolower( $node->tagName ), self::$blockElementTypes );
	}

	/**
	 * Get the index of $child in its parent
	 *
	 * @param DOMNode $child
	 * @return int
	 */
	public static function childIndexOf( DOMNode $child ) : int {
		$i = 0;
		while ( ( $child = $child->previousSibling ) ) {
			$i++;
		}
		return $i;
	}

	/**
	 * Check whether a DOMNode contains (is an ancestor of) another DOMNode (or is the same node)
	 *
	 * @param DOMNode $ancestor
	 * @param DOMNode $descendant
	 * @return bool
	 */
	public static function contains( DOMNode $ancestor, DOMNode $descendant ) : bool {
		// TODO can we use DOMNode->compareDocumentPosition() here maybe?
		$node = $descendant;
		while ( $node && $node !== $ancestor ) {
			$node = $node->parentNode;
		}
		return $node === $ancestor;
	}

	/**
	 * Find closest ancestor element using one of the given tag names.
	 *
	 * @param DOMNode $node
	 * @param string[] $tagNames
	 * @return DOMElement|null
	 */
	public static function closestElement( DOMNode $node, array $tagNames ) : ?DOMElement {
		do {
			if (
				$node->nodeType === XML_ELEMENT_NODE &&
				in_array( strtolower( $node->nodeName ), $tagNames )
			) {
				return $node;
			}
			$node = $node->parentNode;
		} while ( $node );
		return null;
	}

	/**
	 * Find the transclusion node which rendered the current node, if it exists.
	 *
	 * 1. Find the closest ancestor with an 'about' attribute
	 * 2. Find the main node of the about-group (first sibling with the same 'about' attribute)
	 * 3. If this is an mw:Transclusion node, return it; otherwise, go to step 1
	 *
	 * @param DOMNode $node
	 * @return DOMElement|null Translcusion node, null if not found
	 */
	public static function getTranscludedFromElement( DOMNode $node ) : ?DOMElement {
		while ( $node ) {
			// 1.
			if (
				$node instanceof DOMElement &&
				$node->getAttribute( 'about' ) &&
				preg_match( '/^#mwt\d+$/', $node->getAttribute( 'about' ) )
			) {
				$about = $node->getAttribute( 'about' );

				// 2.
				while (
					( $previousSibling = $node->previousSibling ) &&
					$previousSibling instanceof DOMElement &&
					$previousSibling->getAttribute( 'about' ) === $about
				) {
					$node = $previousSibling;
				}

				// 3.
				if (
					$node->getAttribute( 'typeof' ) &&
					in_array( 'mw:Transclusion', explode( ' ', $node->getAttribute( 'typeof' ) ) )
				) {
					break;
				}
			}

			$node = $node->parentNode;
		}
		return $node;
	}

	/**
	 * Trim ASCII whitespace, as defined in the HTML spec.
	 *
	 * @param string $str
	 * @return string
	 */
	public static function htmlTrim( string $str ) : string {
		// https://infra.spec.whatwg.org/#ascii-whitespace
		return trim( $str, "\t\n\f\r " );
	}

	/**
	 * Get the indent level of $node, relative to $rootNode.
	 *
	 * The indent level is the number of lists inside of which it is nested.
	 *
	 * @param DOMNode $node
	 * @param DOMNode $rootNode
	 * @return int
	 */
	public static function getIndentLevel( DOMNode $node, DOMNode $rootNode ) : int {
		$indent = 0;
		while ( $node ) {
			if ( $node === $rootNode ) {
				break;
			}
			$nodeName = strtolower( $node->nodeName );
			if ( $nodeName === 'li' || $nodeName === 'dd' ) {
				$indent++;
			}
			$node = $node->parentNode;
		}
		return $indent;
	}

	/**
	 * Get an array of sibling nodes that contain parts of the given thread item.
	 *
	 * @param ThreadItem $item Thread item
	 * @return DOMElement[]
	 */
	private static function getCoveredSiblings( ThreadItem $item ) : array {
		$range = $item->getRange();
		$ancestor = $range->commonAncestorContainer;

		if ( $ancestor === $range->startContainer || $ancestor === $range->endContainer ) {
			return [ $ancestor ];
		}

		// Convert to array early because apparently DOMNodeList acts like a linked list
		// and accessing items by index is slow
		$siblings = iterator_to_array( $ancestor->childNodes );
		$start = 0;
		$end = count( $siblings ) - 1;

		// Find first of the siblings that contains the item
		while ( !self::contains( $siblings[ $start ], $range->startContainer ) ) {
			$start++;
		}

		// Find last of the siblings that contains the item
		while ( !self::contains( $siblings[ $end ], $range->endContainer ) ) {
			$end--;
		}

		return array_slice( $siblings, $start, $end - $start + 1 );
	}

	/**
	 * Get the nodes (if any) that contain the given thread item, and nothing else.
	 *
	 * @param ThreadItem $item Thread item
	 * @return DOMElement[]|null
	 */
	public static function getFullyCoveredSiblings( ThreadItem $item ) : ?array {
		$siblings = self::getCoveredSiblings( $item );

		$isIgnored = function ( $node ) {
			// Ignore empty text nodes
			return $node->nodeType === XML_TEXT_NODE && CommentUtils::htmlTrim( $node->nodeValue ) === '';
		};

		$firstNonemptyChild = function ( $node ) use ( $isIgnored ) {
			$node = $node->firstChild;
			while ( $node && $isIgnored( $node ) ) {
				$node = $node->nextSibling;
			}
			return $node;
		};

		$lastNonemptyChild = function ( $node ) use ( $isIgnored ) {
			$node = $node->lastChild;
			while ( $node && $isIgnored( $node ) ) {
				$node = $node->previousSibling;
			}
			return $node;
		};

		$startMatches = false;
		$node = $siblings[ 0 ];
		while ( $node ) {
			if ( $item->getRange()->startContainer === $node && $item->getRange()->startOffset === 0 ) {
				$startMatches = true;
				break;
			}
			$node = $firstNonemptyChild( $node );
		}

		$endMatches = false;
		$node = end( $siblings );
		while ( $node ) {
			$length = ( $node->nodeType === XML_TEXT_NODE ) ?
				strlen( rtrim( $node->nodeValue, "\t\n\f\r " ) ) :
				// PHP bug: childNodes can be null for comment nodes
				// (it should always be a DOMNodeList, even if the node can't have children)
				( $node->childNodes ? $node->childNodes->length : 0 );
			if ( $item->getRange()->endContainer === $node && $item->getRange()->endOffset === $length ) {
				$endMatches = true;
				break;
			}
			$node = $lastNonemptyChild( $node );
		}

		if ( $startMatches && $endMatches ) {
			// If these are all of the children (or the only child), go up one more level
			while (
				( $parent = $siblings[ 0 ]->parentNode ) &&
				$firstNonemptyChild( $parent ) === $siblings[ 0 ] &&
				$lastNonemptyChild( $parent ) === end( $siblings )
			) {
				$siblings = [ $parent ];
			}
			return $siblings;
		}
		return null;
	}

	/**
	 * Unwrap Parsoid sections
	 *
	 * @param DOMElement $element Parent element, e.g. document body
	 * @param string|null $keepSection Section to keep
	 */
	public static function unwrapParsoidSections(
		DOMElement $element, string $keepSection = null
	) : void {
		$xpath = new DOMXPath( $element->ownerDocument );
		$sections = $xpath->query( '//section[@data-mw-section-id]', $element );
		foreach ( $sections as $section ) {
			$parent = $section->parentNode;
			$sectionId = $section->getAttribute( 'data-mw-section-id' );
			// Copy section ID to first child (should be a heading)
			if ( $sectionId !== '' && intval( $sectionId ) > 0 ) {
				$section->firstChild->setAttribute( 'data-mw-section-id', $sectionId );
			}
			if ( $keepSection !== null && $sectionId === $keepSection ) {
				return;
			}
			while ( $section->firstChild ) {
				$parent->insertBefore( $section->firstChild, $section );
			}
			$parent->removeChild( $section );
		}
	}

	/**
	 * Get a MediaWiki page title from a URL
	 *
	 * @param string $url
	 * @return Title|null
	 */
	public static function getTitleFromUrl( string $url ) : ?Title {
		$config = MediaWikiServices::getInstance()->getMainConfig();
		// TODO: Set the correct base in the document?
		if ( strpos( $url, './' ) === 0 ) {
			$url = 'https://local' . str_replace( '$1', substr( $url, 2 ), $config->get( 'ArticlePath' ) );
		} elseif ( strpos( $url, '://' ) === false ) {
			$url = 'https://local' . $url;
		}
		$bits = wfParseUrl( $url );
		$query = wfCgiToArray( $bits['query'] ?? '' );
		if ( isset( $query['title'] ) ) {
			return Title::newFromText( $query['title'] );
		}

		$articlePathRegexp = '/' . str_replace(
			preg_quote( '$1', '/' ),
			'(.*)',
			preg_quote( $config->get( 'ArticlePath' ), '/' )
		) . '/';
		$matches = null;
		if ( preg_match( $articlePathRegexp, $url, $matches ) ) {
			return Title::newFromText( urldecode( $matches[1] ) );
		}
		return null;
	}

}
