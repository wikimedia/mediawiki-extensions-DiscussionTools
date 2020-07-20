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
	 * Check whether a DOMNode contains (is an ancestor of) another DOMNode
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
	 * Get a node (if any) that contains the given item, and nothing else.
	 *
	 * @param ThreadItem $item Thread item
	 * @return DOMElement|null
	 */
	public static function getFullyCoveredWrapper( ThreadItem $item ) : ?DOMElement {
		$ancestor = $item->getRange()->commonAncestorContainer;

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
		$node = $ancestor;
		while ( $node ) {
			if ( $item->getRange()->startContainer === $node && $item->getRange()->startOffset === 0 ) {
				$startMatches = true;
				break;
			}
			$node = $firstNonemptyChild( $node );
		}

		$endMatches = false;
		$node = $ancestor;
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
			// If this is the only child, go up one more level
			while (
				$ancestor->parentNode &&
				$firstNonemptyChild( $ancestor->parentNode ) === $lastNonemptyChild( $ancestor->parentNode )
			) {
				$ancestor = $ancestor->parentNode;
			}
			return $ancestor;
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
