<?php

class DiscussionToolsCommentUtils {
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

}
