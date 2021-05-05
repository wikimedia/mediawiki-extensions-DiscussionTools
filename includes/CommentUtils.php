<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMComment;
use DOMElement;
use DOMNode;
use DOMXPath;
use MediaWiki\MediaWikiServices;
use Title;
use Wikimedia\Parsoid\Utils\DOMCompat;

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
	 * @param DOMNode $node
	 * @return bool Node is a block element
	 */
	public static function isBlockElement( DOMNode $node ) : bool {
		return $node instanceof DOMElement &&
			in_array( strtolower( $node->tagName ), self::$blockElementTypes );
	}

	private const SOL_TRANSPARENT_LINK_REGEX =
		'/(?:^|\s)mw:PageProp\/(?:Category|redirect|Language)(?=$|\s)/D';

	/**
	 * @param DOMNode $node
	 * @return bool Node is considered a rendering-transparent node in Parsoid
	 */
	public static function isRenderingTransparentNode( DOMNode $node ) : bool {
		return (
			$node instanceof DOMComment ||
			$node instanceof DOMElement && (
				strtolower( $node->tagName ) === 'meta' ||
				(
					strtolower( $node->tagName ) === 'link' &&
					preg_match( self::SOL_TRANSPARENT_LINK_REGEX, $node->getAttribute( 'rel' ) ?? '' )
				) ||
				// Empty inline templates, e.g. tracking templates
				(
					strtolower( $node->tagName ) === 'span' &&
					in_array( 'mw:Transclusion', explode( ' ', $node->getAttribute( 'typeof' ) ?? '' ) ) &&
					!self::htmlTrim( DOMCompat::getInnerHTML( $node ) )
				)
			)
		);
	}

	/**
	 * Elements which can't have element children (but some may have text content).
	 * https://html.spec.whatwg.org/#elements-2
	 * @var string[]
	 */
	private static $noElementChildrenElementTypes = [
		// Void elements
		'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
		'link', 'meta', 'param', 'source', 'track', 'wbr',
		// Raw text elements
		'script', 'style',
		// Escapable raw text elements
		'textarea', 'title',
		// Treated like text when scripting is enabled in the parser
		// https://html.spec.whatwg.org/#the-noscript-element
		'noscript',
	];

	/**
	 * @param DOMNode $node
	 * @return bool If true, node can't have element children. If false, it's complicated.
	 */
	public static function cantHaveElementChildren( DOMNode $node ) : bool {
		return (
			$node instanceof DOMComment ||
			$node instanceof DOMElement &&
				in_array( strtolower( $node->tagName ), self::$noElementChildrenElementTypes )
		);
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
	 * Given a heading node, return the node on which the ID attribute is set.
	 *
	 * Also returns the offset within that node where the heading text starts.
	 *
	 * @param DOMElement $heading Heading node (`<h1>`-`<h6>`)
	 * @return array Array containing a 'node' (DOMElement) and offset (int)
	 */
	public static function getHeadlineNodeAndOffset( DOMElement $heading ) : array {
		// This code assumes that $wgFragmentMode is [ 'html5', 'legacy' ] or [ 'html5' ]
		$headline = $heading;
		$offset = 0;

		if ( $headline->hasAttribute( 'data-mw-comment-start' ) ) {
			$headline = $headline->parentNode;
		}

		if ( !$headline->getAttribute( 'id' ) ) {
			// PHP HTML: Find the child with .mw-headline
			$headline = $headline->firstChild;
			while (
				$headline && !(
					$headline instanceof DOMElement && $headline->getAttribute( 'class' ) === 'mw-headline'
				)
			) {
				$headline = $headline->nextSibling;
			}
			if ( $headline ) {
				if (
					( $firstChild = $headline->firstChild ) instanceof DOMElement &&
					$firstChild->getAttribute( 'class' ) === 'mw-headline-number'
				) {
					$offset = 1;
				}
			} else {
				$headline = $heading;
			}
		}

		return [
			'node' => $headline,
			'offset' => $offset,
		];
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
	 * Get an array of sibling nodes that contain parts of the given range.
	 *
	 * @param ImmutableRange $range
	 * @return DOMElement[]
	 */
	public static function getCoveredSiblings( ImmutableRange $range ) : array {
		$ancestor = $range->commonAncestorContainer;

		// Convert to array early because apparently DOMNodeList acts like a linked list
		// and accessing items by index is slow
		$siblings = iterator_to_array( $ancestor->childNodes );
		$start = 0;
		$end = count( $siblings ) - 1;

		// Find first of the siblings that contains the item
		if ( $ancestor === $range->startContainer ) {
			$start = $range->startOffset;
		} else {
			while ( !self::contains( $siblings[ $start ], $range->startContainer ) ) {
				$start++;
			}
		}

		// Find last of the siblings that contains the item
		if ( $ancestor === $range->endContainer ) {
			$end = $range->endOffset - 1;
		} else {
			while ( !self::contains( $siblings[ $end ], $range->endContainer ) ) {
				$end--;
			}
		}

		return array_slice( $siblings, $start, $end - $start + 1 );
	}

	/**
	 * Get the nodes (if any) that contain the given thread item, and nothing else.
	 *
	 * @param ThreadItem $item
	 * @return DOMElement[]|null
	 */
	public static function getFullyCoveredSiblings( ThreadItem $item ) : ?array {
		$siblings = self::getCoveredSiblings( $item->getRange() );
		$startContainer = $item->getRange()->startContainer;
		$endContainer = $item->getRange()->endContainer;
		$startOffset = $item->getRange()->startOffset;
		$endOffset = $item->getRange()->endOffset;

		$isIgnored = static function ( $node ) {
			// Ignore empty text nodes
			return $node->nodeType === XML_TEXT_NODE && CommentUtils::htmlTrim( $node->nodeValue ) === '';
		};

		$isFirstNonemptyChild = static function ( $node ) use ( $isIgnored ) {
			while ( ( $node = $node->previousSibling ) ) {
				if ( !$isIgnored( $node ) ) {
					return false;
				}
			}
			return true;
		};

		$isLastNonemptyChild = static function ( $node ) use ( $isIgnored ) {
			while ( ( $node = $node->nextSibling ) ) {
				if ( !$isIgnored( $node ) ) {
					return false;
				}
			}
			return true;
		};

		$startMatches = false;
		$node = $siblings[ 0 ] ?? null;
		while ( $node ) {
			if ( $startContainer->childNodes && $startContainer->childNodes[ $startOffset ] === $node ) {
				$startMatches = true;
				break;
			}
			if ( $startContainer === $node && $startOffset === 0 ) {
				$startMatches = true;
				break;
			}
			if ( $isIgnored( $node ) ) {
				$node = $node->nextSibling;
			} else {
				$node = $node->firstChild;
			}
		}

		$endMatches = false;
		$node = end( $siblings );
		while ( $node ) {
			if ( $endContainer->childNodes && $endContainer->childNodes[ $endOffset - 1 ] === $node ) {
				$endMatches = true;
				break;
			}
			$length = ( $node->nodeType === XML_TEXT_NODE ) ?
				strlen( rtrim( $node->nodeValue, "\t\n\f\r " ) ) :
				// PHP bug: childNodes can be null for comment nodes
				// (it should always be a DOMNodeList, even if the node can't have children)
				( $node->childNodes ? $node->childNodes->length : 0 );
			if ( $endContainer === $node && $endOffset === $length ) {
				$endMatches = true;
				break;
			}
			if ( $isIgnored( $node ) ) {
				$node = $node->previousSibling;
			} else {
				$node = $node->lastChild;
			}
		}

		if ( $startMatches && $endMatches ) {
			// If these are all of the children (or the only child), go up one more level
			while (
				( $parent = $siblings[ 0 ]->parentNode ) &&
				$isFirstNonemptyChild( $siblings[ 0 ] ) &&
				$isLastNonemptyChild( end( $siblings ) )
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
		$bits = parse_url( $url );
		$query = wfCgiToArray( $bits['query'] ?? '' );
		if ( isset( $query['title'] ) ) {
			return Title::newFromText( $query['title'] );
		}

		$config = MediaWikiServices::getInstance()->getMainConfig();
		// TODO: Set the correct base in the document?
		if ( strpos( $url, './' ) === 0 ) {
			$url = 'https://local' . str_replace( '$1', substr( $url, 2 ), $config->get( 'ArticlePath' ) );
		} elseif ( strpos( $url, '://' ) === false ) {
			$url = 'https://local' . $url;
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

	/**
	 * Traverse the document in depth-first order, calling the callback whenever entering and leaving
	 * a node. The walk starts before the given node and ends when callback returns a truthy value, or
	 * after reaching the end of the document.
	 *
	 * You might also think about this as processing XML token stream linearly (rather than XML
	 * nodes), as if we were parsing the document.
	 *
	 * @param DOMNode $node Node to start at
	 * @param callable $callback Function accepting two arguments: $event ('enter' or 'leave') and
	 *     $node (DOMNode)
	 * @return mixed Final return value of the callback
	 */
	public static function linearWalk( DOMNode $node, callable $callback ) {
		$result = null;
		[ $withinNode, $beforeNode ] = [ $node->parentNode, $node ];

		while ( $beforeNode || $withinNode ) {
			if ( $beforeNode ) {
				$result = $callback( 'enter', $beforeNode );
				[ $withinNode, $beforeNode ] = [ $beforeNode, $beforeNode->firstChild ];
			} else {
				$result = $callback( 'leave', $withinNode );
				[ $withinNode, $beforeNode ] = [ $withinNode->parentNode, $withinNode->nextSibling ];
			}

			if ( $result ) {
				return $result;
			}
		}
		return $result;
	}

	/**
	 * Like #linearWalk, but it goes backwards.
	 *
	 * @inheritDoc ::linearWalk()
	 */
	public static function linearWalkBackwards( DOMNode $node, callable $callback ) {
		$result = null;
		[ $withinNode, $beforeNode ] = [ $node->parentNode, $node ];

		while ( $beforeNode || $withinNode ) {
			if ( $beforeNode ) {
				$result = $callback( 'enter', $beforeNode );
				[ $withinNode, $beforeNode ] = [ $beforeNode, $beforeNode->lastChild ];
			} else {
				$result = $callback( 'leave', $withinNode );
				[ $withinNode, $beforeNode ] = [ $withinNode->parentNode, $withinNode->previousSibling ];
			}

			if ( $result ) {
				return $result;
			}
		}
		return $result;
	}

}
