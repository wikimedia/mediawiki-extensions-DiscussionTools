<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMText;
use DOMXPath;
use MWException;
use Title;
use Wikimedia\Parsoid\Utils\DOMCompat;

class CommentItem extends ThreadItem {
	private $signatureRanges;
	private $timestamp;
	private $author;

	/**
	 * @param int $level
	 * @param ImmutableRange $range
	 * @param ImmutableRange[] $signatureRanges Objects describing the extent of signatures (plus
	 *  timestamps) for this comment. There is always at least one signature, but there may be
	 *  multiple. The author and timestamp of the comment is determined from the first signature.
	 *  The last node in every signature range is a node containing the timestamp.
	 * @param string $timestamp
	 * @param string $author Comment author's username
	 */
	public function __construct(
		int $level, ImmutableRange $range,
		array $signatureRanges, string $timestamp, string $author
	) {
		parent::__construct( 'comment', $level, $range );
		$this->signatureRanges = $signatureRanges;
		$this->timestamp = $timestamp;
		$this->author = $author;
	}

	/**
	 * @return array JSON-serializable array
	 */
	public function jsonSerialize() : array {
		return array_merge( parent::jsonSerialize(), [
			'timestamp' => $this->timestamp,
			'author' => $this->author,
		] );
	}

	/**
	 * Get the HTML of this comment's body
	 *
	 *
	 * @param bool $stripTrailingSeparator Strip a trailing separator between the body and
	 *  the signature which consists of whitespace and hyphens e.g. ' --'
	 * @return string HTML
	 */
	public function getBodyHTML( bool $stripTrailingSeparator = false ) : string {
		$fragment = $this->getBodyRange()->cloneContents();
		CommentModifier::unwrapFragment( $fragment );

		if ( $stripTrailingSeparator ) {
			// Find a trailing text node
			$lastChild = $fragment->lastChild;
			while (
				!( $lastChild instanceof DOMText ) &&
				$lastChild->lastChild
			) {
				$lastChild = $lastChild->lastChild;
			}
			if (
				$lastChild instanceof DOMText &&
				preg_match( '/[\s\-~\x{2010}-\x{2015}\x{2043}\x{2060}]+$/u', $lastChild->nodeValue, $matches )
			) {
				$lastChild->nodeValue =
					substr( $lastChild->nodeValue, 0, -strlen( $matches[0] ) );
			}
		}
		$container = $fragment->ownerDocument->createElement( 'div' );
		$container->appendChild( $fragment );
		return DOMCompat::getInnerHTML( $container );
	}

	/**
	 * Get the text of this comment's body
	 *
	 * @return string Text
	 */
	public function getBodyText() : string {
		$fragment = $this->getBodyRange()->cloneContents();
		return $fragment->textContent;
	}

	/**
	 * Get a list of all users mentioned
	 *
	 * @return Title[] Title objects for mentioned user pages
	 */
	public function getMentions() : array {
		$fragment = $this->getBodyRange()->cloneContents();
		$xPath = new DOMXPath( $fragment->ownerDocument );
		$links = $xPath->query( './/a', $fragment );
		$users = [];
		foreach ( $links as $link ) {
			$title = CommentUtils::getTitleFromUrl( $link->getAttribute( 'href' ) );
			if ( $title && $title->getNamespace() === NS_USER ) {
				// TODO: Consider returning User objects
				$users[] = $title;
			}
		}
		return array_unique( $users );
	}

	/**
	 * @return ImmutableRange[] Comment signature ranges
	 */
	public function getSignatureRanges() : array {
		return $this->signatureRanges;
	}

	/**
	 * @return ImmutableRange Range of the thread item's "body"
	 */
	public function getBodyRange() : ImmutableRange {
		// Exclude last signature from body
		$signatureRanges = $this->getSignatureRanges();
		$lastSignature = end( $signatureRanges );
		return $this->getRange()->setEnd( $lastSignature->startContainer, $lastSignature->startOffset );
	}

	/**
	 * @return string Comment timestamp
	 */
	public function getTimestamp() : string {
		return $this->timestamp;
	}

	/**
	 * @return string|null Comment author
	 */
	public function getAuthor() : ?string {
		return $this->author;
	}

	/**
	 * @return HeadingItem Closest ancestor which is a HeadingItem
	 */
	public function getHeading() : HeadingItem {
		$parent = $this;
		while ( $parent instanceof CommentItem ) {
			$parent = $parent->getParent();
		}
		if ( !( $parent instanceof HeadingItem ) ) {
			throw new MWException( 'heading parent not found' );
		}
		return $parent;
	}

	/**
	 * @param ImmutableRange $signatureRange Comment signature range to add
	 */
	public function addSignatureRange( ImmutableRange $signatureRange ) : void {
		$this->signatureRanges[] = $signatureRange;
	}

	/**
	 * @param ImmutableRange[] $signatureRanges Comment signature ranges
	 */
	public function setSignatureRanges( array $signatureRanges ) : void {
		$this->signatureRanges = $signatureRanges;
	}

	/**
	 * @param string $timestamp Comment timestamp
	 */
	public function setTimestamp( string $timestamp ) : void {
		$this->timestamp = $timestamp;
	}

	/**
	 * @param string|null $author Comment author
	 */
	public function setAuthor( ?string $author ) : void {
		$this->author = $author;
	}
}
