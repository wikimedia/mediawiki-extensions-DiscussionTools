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
	public function jsonSerialize() : array {
		return array_merge( parent::jsonSerialize(), [
			'headingLevel' => $this->headingLevel,
			'placeholderHeading' => $this->placeholderHeading,
		] );
	}

	/**
	 * @return int Heading level (1-6)
	 */
	public function getHeadingLevel() : int {
		return $this->headingLevel;
	}

	/**
	 * @param int $headingLevel Heading level (1-6)
	 */
	public function setHeadingLevel( int $headingLevel ) : void {
		$this->headingLevel = $headingLevel;
	}

	/**
	 * @return bool
	 */
	public function isPlaceholderHeading() : bool {
		return $this->placeholderHeading;
	}

	/**
	 * @param bool $placeholderHeading
	 */
	public function setPlaceholderHeading( bool $placeholderHeading ) : void {
		$this->placeholderHeading = $placeholderHeading;
	}
}
