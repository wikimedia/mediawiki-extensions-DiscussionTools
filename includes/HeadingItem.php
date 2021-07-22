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
}
