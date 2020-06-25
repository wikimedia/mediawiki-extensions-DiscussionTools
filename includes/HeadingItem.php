<?php

namespace MediaWiki\Extension\DiscussionTools;

class HeadingItem extends ThreadItem {
	private $placeholderHeading = false;

	/**
	 * @param ImmutableRange $range
	 * @param bool $placeholderHeading Item doesn't correspond to a real heading (e.g. 0th section)
	 */
	public function __construct(
		ImmutableRange $range, bool $placeholderHeading = false
	) {
		parent::__construct( 'heading', 0, $range );
		$this->placeholderHeading = $placeholderHeading;
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
