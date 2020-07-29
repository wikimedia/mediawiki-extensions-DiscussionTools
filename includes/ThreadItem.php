<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMNode;

/**
 * A thread item, either a heading or a comment
 */
abstract class ThreadItem {
	protected $type;
	protected $range;
	protected $rootNode;
	protected $level;

	protected $id = null;
	protected $replies = [];

	/**
	 * @param string $type `heading` or `comment`
	 * @param int $level Item level in the thread tree
	 * @param ImmutableRange $range Object describing the extent of the comment, including the
	 *  signature and timestamp.
	 */
	public function __construct(
		string $type, int $level, ImmutableRange $range
	) {
		$this->type = $type;
		$this->level = $level;
		$this->range = $range;
	}

	/**
	 * Get the list of authors in the comment tree below this thread item.
	 *
	 * Usually called on a HeadingItem to find all authors in a thread.
	 *
	 * @return string[] Author usernames
	 */
	public function getAuthorsBelow() : array {
		$authors = [];
		$getAuthorSet = function ( CommentItem $comment ) use ( &$authors, &$getAuthorSet ) {
			$author = $comment->getAuthor();
			if ( $author ) {
				$authors[ $author ] = true;
			}
			// Get the set of authors in the same format from each reply
			array_map( $getAuthorSet, $comment->getReplies() );
		};

		array_map( $getAuthorSet, $this->getReplies() );

		ksort( $authors );
		return array_keys( $authors );
	}

	/**
	 * Get the name of the page from which this thread item is transcluded (if any).
	 *
	 * @return string|bool `false` if this item is not transcluded. A string if it's transcluded
	 *   from a single page (the page title, in text form with spaces). `true` if it's transcluded, but
	 *   we can't determine the source.
	 */
	public function getTranscludedFrom() {
		// If some template is used within the comment (e.g. {{ping|…}} or {{tl|…}}, or a
		// non-substituted signature template), that *does not* mean the comment is transcluded.
		// We only want to consider comments to be transcluded if all wrapper elements (usually
		// <li> or <p>) are marked as part of a single transclusion.

		// If we can't find "exact" wrappers, using only the end container works out well
		// (because the main purpose of this method is to decide on which page we should post
		// replies to the given comment, and they'll go after the comment).

		$coveredNodes = CommentUtils::getFullyCoveredSiblings( $this ) ?:
			[ $this->getRange()->endContainer ];

		$node = CommentUtils::getTranscludedFromElement( $coveredNodes[ 0 ] );
		$length = count( $coveredNodes );
		for ( $i = 1; $i < $length; $i++ ) {
			if ( $node !== CommentUtils::getTranscludedFromElement( $coveredNodes[ $i ] ) ) {
				// Comment is only partially transcluded, that should be fine
				return false;
			}
		}

		if ( !$node ) {
			// No mw:Transclusion node found, this item is not transcluded
			return false;
		}

		$dataMw = json_decode( $node->getAttribute( 'data-mw' ), true );

		// Only return a page name if this is a simple single-template transclusion.
		if (
			is_array( $dataMw ) &&
			$dataMw['parts'] &&
			count( $dataMw['parts'] ) === 1 &&
			$dataMw['parts'][0]['template'] &&
			$dataMw['parts'][0]['template']['target']['href']
		) {
			$title = CommentUtils::getTitleFromUrl( $dataMw['parts'][0]['template']['target']['href'] );
			return $title->getPrefixedText();
		}

		// Multi-template transclusion, or a parser function call, or template-affected wikitext outside
		// of a template call, or a mix of the above
		return true;
	}

	/**
	 * @return string Thread item type
	 */
	public function getType() : string {
		return $this->type;
	}

	/**
	 * @return int Thread item level
	 */
	public function getLevel() : int {
		return $this->level;
	}

	/**
	 * @return ImmutableRange Thread item range
	 */
	public function getRange() : ImmutableRange {
		return $this->range;
	}

	/**
	 * @return DOMNode Root node (level is relative to this node)
	 */
	public function getRootNode() : DOMNode {
		return $this->rootNode;
	}

	/**
	 * @return string|null Thread ID
	 */
	public function getId() : ?string {
		return $this->id;
	}

	/**
	 * @return CommentItem[] Replies to this thread item
	 */
	public function getReplies() : array {
		return $this->replies;
	}

	/**
	 * @param int $level Thread item level
	 */
	public function setLevel( int $level ) : void {
		$this->level = $level;
	}

	/**
	 * @param ImmutableRange $range Thread item range
	 */
	public function setRange( ImmutableRange $range ) : void {
		$this->range = $range;
	}

	/**
	 * @param DOMNode $rootNode Root node (level is relative to this node)
	 */
	public function setRootNode( DOMNode $rootNode ) : void {
		$this->rootNode = $rootNode;
	}

	/**
	 * @param string|null $id Thread ID
	 */
	public function setId( ?string $id ) : void {
		$this->id = $id;
	}

	/**
	 * @param CommentItem $reply Reply comment
	 */
	public function addReply( CommentItem $reply ) : void {
		$this->replies[] = $reply;
	}
}
