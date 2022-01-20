<?php

namespace MediaWiki\Extension\DiscussionTools;

class HeadingItem extends ThreadItem {
	private $placeholderHeading = false;
	private $headingLevel;

	/**
	 * @param ImmutableRange $range
	 * @param int $headingLevel Heading level (1-6)
	 * @param bool $placeholderHeading Item doesn't correspond to a real heading (e.g. 0th section)
	 */
	public function __construct(
		ImmutableRange $range, int $headingLevel, bool $placeholderHeading = false
	) {
		parent::__construct( 'heading', 0, $range );
		$this->headingLevel = $headingLevel;
		$this->placeholderHeading = $placeholderHeading;
	}

	/**
	 * @return array JSON-serializable array
	 */
	public function jsonSerialize(): array {
		return array_merge( parent::jsonSerialize(), [
			'headingLevel' => $this->headingLevel,
			'placeholderHeading' => $this->placeholderHeading,
		] );
	}

	/**
	 * Get a title based on the hash ID, such that it can be linked to
	 *
	 * @return string Title
	 */
	public function getLinkableTitle(): string {
		$title = '';
		// If this comment is in 0th section, there's no section title for the edit summary
		if ( !$this->isPlaceholderHeading() ) {
			$headingNode =
				CommentUtils::getHeadlineNodeAndOffset( $this->getRange()->startContainer )['node'];
			$id = $headingNode->getAttribute( 'id' );
			if ( $id ) {
				// Replace underscores with spaces to undo Sanitizer::escapeIdInternal().
				// This assumes that $wgFragmentMode is [ 'html5', 'legacy' ] or [ 'html5' ],
				// otherwise the escaped IDs are super garbled and can't be unescaped reliably.
				$title = str_replace( '_', ' ', $id );
			}
			// else: Not a real section, probably just HTML markup in wikitext
		}
		return $title;
	}

	/**
	 * @return int Heading level (1-6)
	 */
	public function getHeadingLevel(): int {
		return $this->headingLevel;
	}

	/**
	 * @param int $headingLevel Heading level (1-6)
	 */
	public function setHeadingLevel( int $headingLevel ): void {
		$this->headingLevel = $headingLevel;
	}

	/**
	 * @return bool
	 */
	public function isPlaceholderHeading(): bool {
		return $this->placeholderHeading;
	}

	/**
	 * @param bool $placeholderHeading
	 */
	public function setPlaceholderHeading( bool $placeholderHeading ): void {
		$this->placeholderHeading = $placeholderHeading;
	}

	/**
	 * Check whether this heading can be used for topic subscriptions.
	 *
	 * @return bool
	 */
	public function isSubscribable(): bool {
		return (
			// Placeholder headings have nothing to attach the button to.
			!$this->isPlaceholderHeading() &&
			// We only allow subscribing to level 2 headings, because the user interface for sub-headings
			// would be difficult to present.
			$this->getHeadingLevel() === 2 &&
			// Check if the name corresponds to a section that contain no comments (only sub-sections).
			// They can't be distinguished from each other, so disallow subscribing.
			$this->getName() !== 'h-'
		);
	}

	/**
	 * @inheritDoc
	 */
	public function getTranscludedFrom() {
		// Placeholder headings break the usual logic, because their ranges are collapsed
		if ( $this->isPlaceholderHeading() ) {
			return false;
		}
		// Collapsed ranges should otherwise be impossible, but they're not (T299583)
		// TODO: See if we can fix the root cause, and remove this?
		if ( $this->getRange()->collapsed ) {
			return false;
		}
		return parent::getTranscludedFrom();
	}
}
