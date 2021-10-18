<?php

namespace MediaWiki\Extension\DiscussionTools;

use Error;
use Exception;
use Wikimedia\Parsoid\DOM\Comment;
use Wikimedia\Parsoid\DOM\DocumentFragment;
use Wikimedia\Parsoid\DOM\DocumentType;
use Wikimedia\Parsoid\DOM\Node;
use Wikimedia\Parsoid\DOM\ProcessingInstruction;
use Wikimedia\Parsoid\DOM\Text;

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
	 * @param Node $a
	 * @param Node $b
	 * @return Node Common ancestor container
	 */
	private static function findCommonAncestorContainer( Node $a, Node $b ): Node {
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
	 * @param Node $node
	 * @return Node
	 */
	private static function getRootNode( Node $node ): Node {
		while ( $node->parentNode ) {
			$node = $node->parentNode;
			'@phan-var Node $node';
		}

		return $node;
	}

	/**
	 * @param Node $startNode
	 * @param int $startOffset
	 * @param Node $endNode
	 * @param int $endOffset
	 */
	public function __construct(
		Node $startNode, int $startOffset, Node $endNode, int $endOffset
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
	 * @param Node $startNode
	 * @param int $startOffset
	 * @return self
	 */
	public function setStart( Node $startNode, int $startOffset ): self {
		return new self(
			$startNode, $startOffset, $this->mEndContainer, $this->mEndOffset
		);
	}

	/**
	 * Clone range with a new end position
	 *
	 * @param Node $endNode
	 * @param int $endOffset
	 * @return self
	 */
	public function setEnd( Node $endNode, int $endOffset ): self {
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
	 * @param Node $node The Node to check against.
	 * @return bool
	 */
	private function isPartiallyContainedNode( Node $node ): bool {
		return CommentUtils::contains( $node, $this->mStartContainer ) xor
			CommentUtils::contains( $node, $this->mEndContainer );
	}

	/**
	 * Returns true if the entire Node is within the Range, otherwise false.
	 *
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @see https://dom.spec.whatwg.org/#contained
	 *
	 * @param Node $node The Node to check against.
	 * @return bool
	 */
	private function isFullyContainedNode( Node $node ): bool {
		return self::getRootNode( $node ) === self::getRootNode( $this->mStartContainer )
			&& $this->computePosition( $node, 0, $this->mStartContainer, $this->mStartOffset ) === 'after'
			&& $this->computePosition(
				// @phan-suppress-next-line PhanUndeclaredProperty
				$node, $node->length ?? $node->childNodes->length,
				$this->mEndContainer, $this->mEndOffset
			) === 'before';
	}

	/**
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @see https://dom.spec.whatwg.org/#dom-range-clonecontents
	 *
	 * @return DocumentFragment
	 */
	public function cloneContents(): DocumentFragment {
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
			&& ( $originalStartContainer instanceof Text
				|| $originalStartContainer instanceof ProcessingInstruction
				|| $originalStartContainer instanceof Comment )
		) {
			$clone = $originalStartContainer->cloneNode();
			$clone->nodeValue = $originalStartContainer->substringData(
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

		// Upstream uses lastChild then iterates over previousSibling, however this
		// is much slower that copying all the nodes to an array, at least when using
		// a native DOMNode, presumably because previousSibling is lazy-evaluated.
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
			if ( $child instanceof DocumentType ) {
				throw new Error();
			}
		}

		if ( $firstPartiallyContainedChild instanceof Text
			|| $firstPartiallyContainedChild instanceof ProcessingInstruction
			|| $firstPartiallyContainedChild instanceof Comment
		) {
			$clone = $originalStartContainer->cloneNode();
			// @phan-suppress-next-line PhanUndeclaredMethod
			$clone->nodeValue = $originalStartContainer->substringData(
				$originalStartOffset,
				// @phan-suppress-next-line PhanUndeclaredProperty
				$originalStartContainer->length - $originalStartOffset
			);
			$fragment->appendChild( $clone );
		} elseif ( $firstPartiallyContainedChild ) {
			$clone = $firstPartiallyContainedChild->cloneNode();
			$fragment->appendChild( $clone );
			$subrange = new self(
				$originalStartContainer, $originalStartOffset,
				$firstPartiallyContainedChild,
				// @phan-suppress-next-line PhanUndeclaredProperty
				$firstPartiallyContainedChild->length ?? $firstPartiallyContainedChild->childNodes->length
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

		if ( $lastPartiallyContainedChild instanceof Text
			|| $lastPartiallyContainedChild instanceof ProcessingInstruction
			|| $lastPartiallyContainedChild instanceof Comment
		) {
			$clone = $originalEndContainer->cloneNode();
			// @phan-suppress-next-line PhanUndeclaredMethod
			$clone->nodeValue = $originalEndContainer->substringData(
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
	 * @param Node $node The Node to be inserted.
	 * @return void
	 */
	public function insertNode( Node $node ): void {
		if ( ( $this->mStartContainer instanceof ProcessingInstruction
				|| $this->mStartContainer instanceof Comment )
			|| ( $this->mStartContainer instanceof Text
				&& $this->mStartContainer->parentNode === null )
		) {
			throw new Error();
		}

		$referenceNode = null;

		if ( $this->mStartContainer instanceof Text ) {
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

		if ( $this->mStartContainer instanceof Text ) {
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

		// $referenceNode may be null, this is okay
		$parent->insertBefore( $node, $referenceNode );
	}

	/**
	 * Compares the position of two boundary points.
	 *
	 * Ported from https://github.com/TRowbotham/PHPDOM (MIT)
	 * @internal
	 *
	 * @see https://dom.spec.whatwg.org/#concept-range-bp-position
	 *
	 * @param Node $nodeA
	 * @param int $offsetA
	 * @param Node $nodeB
	 * @param int $offsetB
	 * @return string 'before'|'after'|'equal'
	 */
	private function computePosition(
		Node $nodeA, int $offsetA, Node $nodeB, int $offsetB
	): string {
		// 1. Assert: nodeA and nodeB have the same root.
		// Removed, not necessary for our usage

		// 2. If nodeA is nodeB, then return equal if offsetA is offsetB, before if offsetA is less than offsetB, and
		// after if offsetA is greater than offsetB.
		if ( $nodeA === $nodeB ) {
			if ( $offsetA === $offsetB ) {
				return 'equal';
			} elseif ( $offsetA < $offsetB ) {
				return 'before';
			} else {
				return 'after';
			}
		}

		$commonAncestor = $this->findCommonAncestorContainer( $nodeB, $nodeA );
		if ( $commonAncestor === $nodeA ) {
			$AFollowsB = false;
		} elseif ( $commonAncestor === $nodeB ) {
			$AFollowsB = true;
		} else {
			// A was not found inside B. Traverse both A & B up to the nodes
			// before their common ancestor, then see if A is in the nextSibling
			// chain of B.
			$b = $nodeB;
			while ( $b->parentNode !== $commonAncestor ) {
				$b = $b->parentNode;
			}
			$a = $nodeA;
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
			[ $nodeB, $nodeA ] = [ $nodeA, $nodeB ];
			[ $offsetB, $offsetA ] = [ $offsetA, $offsetB ];
		}

		$ancestor = $nodeB->parentNode;

		while ( $ancestor ) {
			if ( $ancestor === $nodeA ) {
				break;
			}

			$ancestor = $ancestor->parentNode;
		}

		if ( $ancestor ) {
			$child = $nodeB;

			while ( $child ) {
				if ( $child->parentNode === $nodeA ) {
					break;
				}

				$child = $child->parentNode;
			}

			// Phan complains that $child may be null here, but that can't happen, because at this point
			// we know that $nodeA is an ancestor of $nodeB, so the loop above will stop before the root.
			// @phan-suppress-next-line PhanTypeMismatchArgumentNullable
			if ( CommentUtils::childIndexOf( $child ) < $offsetA ) {
				return $AFollowsB ? 'before' : 'after';
			}
		}

		return $AFollowsB ? 'after' : 'before';
	}

}
