<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMElement;
use DOMNode;
use DOMXPath;

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
}
