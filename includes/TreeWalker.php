<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMNode;
use Exception;

/**
 * Partial implementation of W3 DOM4 TreeWalker interface.
 *
 * See also:
 * - https://dom.spec.whatwg.org/#interface-treewalker
 *
 * Adapted from https://github.com/Krinkle/dom-TreeWalker-polyfill/blob/master/src/TreeWalker-polyfill.js
 */
class TreeWalker {

	public $root;
	public $whatToShow;
	public $currentNode;
	public $filter;

	/**
	 * See https://dom.spec.whatwg.org/#concept-node-filter
	 *
	 * @param TreeWalker $tw
	 * @param DOMNode $node
	 * @return int Constant NodeFilter::FILTER_ACCEPT,
	 *  NodeFilter::FILTER_REJECT or NodeFilter::FILTER_SKIP.
	 */
	private function nodeFilter( TreeWalker $tw, DOMNode $node ) {
		// Maps nodeType to whatToShow
		if ( !( ( ( 1 << ( $node->nodeType - 1 ) ) & $tw->whatToShow ) ) ) {
			return NodeFilter::FILTER_SKIP;
		}

		if ( $tw->filter === null ) {
			return NodeFilter::FILTER_ACCEPT;
		}

		return $tw->filter->acceptNode( $node );
	}

	/**
	 * Based on WebKit's NodeTraversal::nextSkippingChildren
	 * https://trac.webkit.org/browser/trunk/Source/WebCore/dom/NodeTraversal.h?rev=137221#L103
	 *
	 * @param DOMNode $node
	 * @param DOMNode $stayWithin
	 * @return DOMNode|null
	 */
	private function nextSkippingChildren( DOMNode $node, DOMNode $stayWithin ) : ?DOMNode {
		if ( $node === $stayWithin ) {
			return null;
		}
		if ( $node->nextSibling !== null ) {
			return $node->nextSibling;
		}

		/**
		 * Based on WebKit's NodeTraversal::nextAncestorSibling
		 * https://trac.webkit.org/browser/trunk/Source/WebCore/dom/NodeTraversal.cpp?rev=137221#L43
		 */
		while ( $node->parentNode !== null ) {
			$node = $node->parentNode;
			if ( $node === $stayWithin ) {
				return null;
			}
			if ( $node->nextSibling !== null ) {
				return $node->nextSibling;
			}
		}
		return null;
	}

	/**
	 * See https://dom.spec.whatwg.org/#interface-treewalker
	 *
	 * @param DOMNode $root
	 * @param int|null $whatToShow
	 * @param callable|null $filter
	 * @throws Exception
	 */
	public function __construct( DOMNode $root, $whatToShow = null, callable $filter = null ) {
		if ( !$root->nodeType ) {
			throw new Exception( 'DOMException: NOT_SUPPORTED_ERR' );
		}

		$this->root = $root;
		$this->whatToShow = (int)$whatToShow ?: 0;

		$this->currentNode = $root;

		if ( !$filter ) {
			$this->filter = null;
		} else {
			$this->filter = new NodeFilter();
			$this->filter->filter = $filter;
		}
	}

	/**
	 * See https://dom.spec.whatwg.org/#dom-treewalker-nextnode
	 *
	 * @return DOMNode|null The current node
	 */
	public function nextNode() : ?DOMNode {
		$node = $this->currentNode;
		$result = NodeFilter::FILTER_ACCEPT;

		while ( true ) {
			while ( $result !== NodeFilter::FILTER_REJECT && $node->firstChild !== null ) {
				$node = $node->firstChild;
				$result = $this->nodeFilter( $this, $node );
				if ( $result === NodeFilter::FILTER_ACCEPT ) {
					$this->currentNode = $node;
					return $node;
				}
			}
			$following = $this->nextSkippingChildren( $node, $this->root );
			if ( $following !== null ) {
				$node = $following;
			} else {
				return null;
			}
			$result = $this->nodeFilter( $this, $node );
			if ( $result === NodeFilter::FILTER_ACCEPT ) {
				$this->currentNode = $node;
				return $node;
			}
		}
	}
}
