<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMNode;
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
	private static function findCommonAncestorContainer( DOMNode $a, DOMNode $b ) : DOMNode {
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
	 * @param DOMNode $startNode Start node
	 * @param int $startOffset Start offset
	 * @param DOMNode $endNode End node
	 * @param int $endOffset End offset
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
	 * @param DOMNode $startNode Start node
	 * @param int $startOffset Start offset
	 * @return self
	 */
	public function setStart( DOMNode $startNode, int $startOffset ) : self {
		return new self(
			$startNode, $startOffset, $this->mEndContainer, $this->mEndOffset
		);
	}

	/**
	 * Clone range with a new end position
	 *
	 * @param DOMNode $endNode End node
	 * @param int $endOffset End offset
	 * @return self
	 */
	public function setEnd( DOMNode $endNode, int $endOffset ) : self {
		return new self(
			$this->mStartContainer, $this->mStartOffset, $endNode, $endOffset
		);
	}

}
