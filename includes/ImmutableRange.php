<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMComment;
use DOMDocumentFragment;
use DOMDocumentType;
use DOMNode;
use DOMProcessingInstruction;
use DOMText;
use Error;
use Exception;

/**
 * ImmutableRange has a similar API to the DOM Range class.
 *
 * start/endContainer and offsets can be accessed, as can commonAncestorContainer
 * which is lazy evaluated.
 *
 * setStart and setEnd are still available but return a cloned range.
 */
class ImmutableRange {
	private $mCollapsed;
	private $mCommonAncestorContainer;
	private $mEndContainer;
	private $mEndOffset;
	private $mStartContainer;
	private $mStartOffset;

	/**
	 * Find the common ancestor container of two nodes
	 *
	 * @param DOMNode $a
	 * @param DOMNode $b
	 * @return DOMNode Common ancestor container
	 */
	private static function findCommonAncestorContainer( DOMNode $a, DOMNode $b ): DOMNode {
		$ancestorsA = [];
		$ancestorsB = [];

		do {
			$ancestorsA[] = $a;
		} while ( ( $a = $a->parentNode ) );
		do {
			$ancestorsB[] = $b;
		} while ( ( $b = $b->parentNode ) );

		$node = null;
		while ( end( $ancestorsA ) && end( $ancestorsA ) === end( $ancestorsB ) ) {
			$node = end( $ancestorsA );
			array_pop( $ancestorsA );
			array_pop( $ancestorsB );
		}
		if ( !$node ) {
			throw new Error( 'Nodes are not in the same document' );
		}

		return $node;
	}

	/**
	 * Get the root ancestor of a node
	 *
	 * @param DOMNode $node
	 * @return DOMNode
	 */
	private static function getRootNode( DOMNode $node ): DOMNode {
		while ( $node->parentNode ) {
			$node = $node->parentNode;
		}

		return $node;
	}

	/**
	 * @param DOMNode $startNode
	 * @param int $startOffset
	 * @param DOMNode $endNode
	 * @param int $endOffset
	 */
	public function __construct(
		DOMNode $startNode, int $startOffset, DOMNode $endNode, int $endOffset
	) {
		$this->mStartContainer = $startNode;
		$this->mStartOffset = $startOffset;
		$this->mEndContainer = $endNode;
		$this->mEndOffset = $endOffset;
	}

	/**
	 * @param string $field Field name
	 * @return mixed
	 */
	public function __get( string $field ) {
		switch ( $field ) {
			case 'collapsed':
				return $this->mStartContainer === $this->mEndContainer &&
					$this->mStartOffset === $this->mEndOffset;
			case 'commonAncestorContainer':
				if ( !$this->mCommonAncestorContainer ) {
					$this->mCommonAncestorContainer =
						self::findCommonAncestorContainer( $this->mStartContainer, $this->mEndContainer );
				}
				return $this->mCommonAncestorContainer;
			case 'endContainer':
				return $this->mEndContainer;
			case 'endOffset':
				return $this->mEndOffset;
			case 'startContainer':
				return $this->mStartContainer;
			case 'startOffset':
				return $this->mStartOffset;
			default:
				throw new Exception( 'Invalid property: ' . $field );
		}
	}

	/**
	 * Clone range with a new start position
	 *
	 * @param DOMNode $startNode
	 * @param int $startOffset
	 * @return self
	 */
	public function setStart( DOMNode $startNode, int $startOffset ): self {
		return new self(
			$startNode, $startOffset, $this->mEndContainer, $this->mEndOffset
		);
	}

	/**
	 * Clone range with a new end position
	 *
	 * @param DOMNode $endNode
	 * @param int $endOffset
	 * @return self
	 */
	public function setEnd( DOMNode $endNode, int $endOffset ): self {
		return new self(
			$this->mStartContainer, $this->mStartOffset, $endNode, $endOffset
		);
	}

	/**
	 * Returns true if only a portion of the Node is contained within the Range.
	 *
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @see https://dom.spec.whatwg.org/#partially-contained
	 *
	 * @param DOMNode $node The Node to check against.
	 * @return bool
	 */
	private function isPartiallyContainedNode( DOMNode $node ): bool {
		$isAncestorOfStart = CommentUtils::contains( $node, $this->mStartContainer );
		$isAncestorOfEnd = CommentUtils::contains( $node, $this->mEndContainer );

		return ( $isAncestorOfStart && !$isAncestorOfEnd )
			|| ( !$isAncestorOfStart && $isAncestorOfEnd );
	}

	/**
	 * Returns true if the entire Node is within the Range, otherwise false.
	 *
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @see https://dom.spec.whatwg.org/#contained
	 *
	 * @param DOMNode $node The Node to check against.
	 * @return bool
	 */
	private function isFullyContainedNode( DOMNode $node ): bool {
		$startBP = [ $this->mStartContainer, $this->mStartOffset ];
		$endBP = [ $this->mEndContainer, $this->mEndOffset ];
		$root = self::getRootNode( $this->mStartContainer );

		return self::getRootNode( $node ) === $root
			&& $this->computePosition( [ $node, 0 ], $startBP ) === 'after'
			&& $this->computePosition(
				[ $node, strlen( $node->nodeValue ) ],
				$endBP
			) === 'before';
	}

	/**
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @see https://dom.spec.whatwg.org/#dom-range-clonecontents
	 *
	 * @return DOMDocumentFragment
	 */
	public function cloneContents(): DOMDocumentFragment {
		$ownerDocument = $this->mStartContainer->ownerDocument;
		$fragment = $ownerDocument->createDocumentFragment();

		if ( $this->mStartContainer === $this->mEndContainer
			&& $this->mStartOffset === $this->mEndOffset
		) {
			return $fragment;
		}

		$originalStartContainer = $this->mStartContainer;
		$originalStartOffset = $this->mStartOffset;
		$originalEndContainer = $this->mEndContainer;
		$originalEndOffset = $this->mEndOffset;

		if ( $originalStartContainer === $originalEndContainer
			&& ( $originalStartContainer instanceof DOMText
				|| $originalStartContainer instanceof DOMProcessingInstruction
				|| $originalStartContainer instanceof DOMComment )
		) {
			$clone = $originalStartContainer->cloneNode();
			$clone->nodeValue = substr(
				$originalStartContainer->nodeValue,
				$originalStartOffset,
				$originalEndOffset - $originalStartOffset
			);
			$fragment->appendChild( $clone );

			return $fragment;
		}

		$commonAncestor = self::findCommonAncestorContainer(
			$originalStartContainer,
			$originalEndContainer
		);
		$firstPartiallyContainedChild = null;

		if ( !CommentUtils::contains( $originalStartContainer, $originalEndContainer ) ) {
			foreach ( $commonAncestor->childNodes as $node ) {
				if ( $this->isPartiallyContainedNode( $node ) ) {
					$firstPartiallyContainedChild = $node;
					break;
				}
			}
		}

		$lastPartiallyContainedChild = null;

		if ( !CommentUtils::contains( $originalEndContainer, $originalStartContainer ) ) {
			$childNodes = iterator_to_array( $commonAncestor->childNodes );

			foreach ( array_reverse( $childNodes ) as $node ) {
				if ( $this->isPartiallyContainedNode( $node ) ) {
					$lastPartiallyContainedChild = $node;
					break;
				}
			}
		}

		$containedChildrenStart = null;
		$containedChildrenEnd = null;

		$child = $firstPartiallyContainedChild ?: $commonAncestor->firstChild;
		for ( ; $child; $child = $child->nextSibling ) {
			if ( $this->isFullyContainedNode( $child ) ) {
				$containedChildrenStart = $child;
				break;
			}
		}

		$child = $lastPartiallyContainedChild ?: $commonAncestor->lastChild;
		for ( ; $child !== $containedChildrenStart; $child = $child->previousSibling ) {
			if ( $this->isFullyContainedNode( $child ) ) {
				$containedChildrenEnd = $child;
				break;
			}
		}
		if ( !$containedChildrenEnd ) {
			$containedChildrenEnd = $containedChildrenStart;
		}

		// $containedChildrenStart and $containedChildrenEnd may be null here, but this loop still works correctly
		for ( $child = $containedChildrenStart; $child !== $containedChildrenEnd; $child = $child->nextSibling ) {
			if ( $child instanceof DOMDocumentType ) {
				throw new Error();
			}
		}

		if ( $firstPartiallyContainedChild instanceof DOMText
			|| $firstPartiallyContainedChild instanceof DOMProcessingInstruction
			|| $firstPartiallyContainedChild instanceof DOMComment
		) {
			$clone = $originalStartContainer->cloneNode();
			$clone->nodeValue = substr(
				$originalStartContainer->nodeValue,
				$originalStartOffset,
				strlen( $originalStartContainer->nodeValue ) - $originalStartOffset
			);
			$fragment->appendChild( $clone );
		} elseif ( $firstPartiallyContainedChild ) {
			$clone = $firstPartiallyContainedChild->cloneNode();
			$fragment->appendChild( $clone );
			$subrange = new self(
				$originalStartContainer, $originalStartOffset,
				$firstPartiallyContainedChild,
				strlen( $firstPartiallyContainedChild->nodeValue )
			);
			$subfragment = $subrange->cloneContents();
			if ( $subfragment->hasChildNodes() ) {
				$clone->appendChild( $subfragment );
			}
		}

		// $containedChildrenStart and $containedChildrenEnd may be null here, but this loop still works correctly
		for ( $child = $containedChildrenStart; $child !== $containedChildrenEnd; $child = $child->nextSibling ) {
			$clone = $child->cloneNode( true );
			$fragment->appendChild( $clone );
		}
		// If not null, this node wasn't processed by the loop
		if ( $containedChildrenEnd ) {
			$clone = $containedChildrenEnd->cloneNode( true );
			$fragment->appendChild( $clone );
		}

		if ( $lastPartiallyContainedChild instanceof DOMText
			|| $lastPartiallyContainedChild instanceof DOMProcessingInstruction
			|| $lastPartiallyContainedChild instanceof DOMComment
		) {
			$clone = $originalEndContainer->cloneNode();
			$clone->nodeValue = substr(
				$originalEndContainer->nodeValue,
				0,
				$originalEndOffset
			);
			$fragment->appendChild( $clone );
		} elseif ( $lastPartiallyContainedChild ) {
			$clone = $lastPartiallyContainedChild->cloneNode();
			$fragment->appendChild( $clone );
			$subrange = new self(
				$lastPartiallyContainedChild, 0,
				$originalEndContainer, $originalEndOffset
			);
			$subfragment = $subrange->cloneContents();
			if ( $subfragment->hasChildNodes() ) {
				$clone->appendChild( $subfragment );
			}
		}

		return $fragment;
	}

	/**
	 * Inserts a new Node into at the start of the Range.
	 *
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 *
	 * @see https://dom.spec.whatwg.org/#dom-range-insertnode
	 *
	 * @param DOMNode $node The Node to be inserted.
	 * @return void
	 */
	public function insertNode( DOMNode $node ): void {
		if ( ( $this->mStartContainer instanceof DOMProcessingInstruction
				|| $this->mStartContainer instanceof DOMComment )
			|| ( $this->mStartContainer instanceof DOMText
				&& $this->mStartContainer->parentNode === null )
		) {
			throw new Error();
		}

		$referenceNode = null;

		if ( $this->mStartContainer instanceof DOMText ) {
			$referenceNode = $this->mStartContainer;
		} else {
			$referenceNode = $this
				->mStartContainer
				->childNodes
				->item( $this->mStartOffset );
		}

		$parent = !$referenceNode
			? $this->mStartContainer
			: $referenceNode->parentNode;
		// TODO: Restore this validation check?
		// $parent->ensurePreinsertionValidity( $node, $referenceNode );

		if ( $this->mStartContainer instanceof DOMText ) {
			$referenceNode = $this->mStartContainer->splitText( $this->mStartOffset );
		}

		if ( $node === $referenceNode ) {
			$referenceNode = $referenceNode->nextSibling;
		}

		if ( $node->parentNode ) {
			$node->parentNode->removeChild( $node );
		}

		// TODO: Restore this validation check?
		// $parent->preinsertNode( $node, $referenceNode );
		//
		// This should just be
		//  $parent->insertBefore( $node, $referenceNode );
		// but the second argument is optional, not nullable
		if ( $referenceNode ) {
			$parent->insertBefore( $node, $referenceNode );
		} else {
			$parent->insertBefore( $node );
		}
	}

	/**
	 * Compares the position of two boundary points.
	 *
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @internal
	 *
	 * @see https://dom.spec.whatwg.org/#concept-range-bp-position
	 *
	 * @param mixed[] $boundaryPointA An array containing a Node and an offset within that Node representing a boundary.
	 * @param mixed[] $boundaryPointB An array containing a Node and an offset within that Node representing a boundary.
	 * @return string Returns before, equal, or after based on the position of the first boundary relative to the second
	 *                boundary.
	 */
	private function computePosition(
		array $boundaryPointA,
		array $boundaryPointB
	): string {
		if ( $boundaryPointA[0] === $boundaryPointB[0] ) {
			if ( $boundaryPointA[1] === $boundaryPointB[1] ) {
				return 'equal';
			} elseif ( $boundaryPointA[1] < $boundaryPointB[1] ) {
				return 'before';
			} else {
				return 'after';
			}
		}

		$commonAncestor = $this->findCommonAncestorContainer( $boundaryPointB[0], $boundaryPointA[0] );
		if ( $commonAncestor === $boundaryPointA[0] ) {
			$AFollowsB = false;
		} elseif ( $commonAncestor === $boundaryPointB[0] ) {
			$AFollowsB = true;
		} else {
			// A was not found inside B. Traverse both A & B up to the nodes
			// before their common ancestor, then see if A is in the nextSibling
			// chain of B.
			$b = $boundaryPointB[0];
			while ( $b->parentNode !== $commonAncestor ) {
				$b = $b->parentNode;
			}
			$a = $boundaryPointA[0];
			while ( $a->parentNode !== $commonAncestor ) {
				$a = $a->parentNode;
			}
			$AFollowsB = false;
			while ( $b ) {
				if ( $a === $b ) {
					$AFollowsB = true;
					break;
				}
				$b = $b->nextSibling;
			}
		}

		if ( $AFollowsB ) {
			// Swap variables
			[ $boundaryPointB, $boundaryPointA ] = [ $boundaryPointA, $boundaryPointB ];
		}

		$ancestor = $boundaryPointB[0]->parentNode;

		while ( $ancestor ) {
			if ( $ancestor === $boundaryPointA[0] ) {
				break;
			}

			$ancestor = $ancestor->parentNode;
		}

		if ( $ancestor ) {
			$child = $boundaryPointB[0];

			while ( $child ) {
				if ( $child->parentNode === $boundaryPointA[0] ) {
					break;
				}

				$child = $child->parentNode;
			}

			if ( CommentUtils::childIndexOf( $child ) < $boundaryPointA[1] ) {
				return $AFollowsB ? 'before' : 'after';
			}
		}

		return $AFollowsB ? 'after' : 'before';
	}

}
