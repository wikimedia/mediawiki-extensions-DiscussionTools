<?php

namespace MediaWiki\Extension\DiscussionTools;

class CommentItem extends ThreadItem {
	private $signatureRanges;
	private $timestamp;
	private $author;
	private $warnings = [];

	private $parent;

	/**
	 * @param int $level
	 * @param ImmutableRange $range
	 * @param ImmutableRange[] $signatureRanges Objects describing the extent of signatures (plus
	 *  timestamps) for this comment. There is always at least one signature, but there may be
	 *  multiple. The author and timestamp of the comment is determined from the first signature.
	 *  The last node in every signature range is a node containing the timestamp.
	 * @param string|null $timestamp Timestamp
	 * @param string|null $author Comment author's username
	 */
	public function __construct(
		int $level, ImmutableRange $range,
		array $signatureRanges = [], ?string $timestamp = null, ?string $author = null
	) {
		parent::__construct( 'comment', $level, $range );
		$this->signatureRanges = $signatureRanges;
		$this->timestamp = $timestamp;
		$this->author = $author;
	}

	/**
	 * @return ImmutableRange[] Comment signature ranges
	 */
	public function getSignatureRanges() : array {
		return $this->signatureRanges;
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
	 * @return ThreadItem Parent thread item
	 */
	public function getParent() : ThreadItem {
		return $this->parent;
	}

	/**
	 * @return string[] Comment warnings
	 */
	public function getWarnings() : array {
		return $this->warnings;
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

	/**
	 * @param ThreadItem $parent Parent thread item
	 */
	public function setParent( ThreadItem $parent ) {
		$this->parent = $parent;
	}

	/**
	 * @param string $warning Comment warning
	 */
	public function addWarning( string $warning ) : void {
		$this->warnings[] = $warning;
	}

	/**
	 * @param string[] $warnings Comment warnings
	 */
	public function addWarnings( array $warnings ) : void {
		$this->warnings = array_merge( $this->warnings, $warnings );
	}
}
