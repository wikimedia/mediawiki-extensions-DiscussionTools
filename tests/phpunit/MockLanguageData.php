<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\LanguageData;

class MockLanguageData extends LanguageData {

	/**
	 * @var array
	 */
	private $data;

	/**
	 * @param array $data
	 */
	public function __construct( array $data ) {
		$this->data = $data;
	}

	/**
	 * @return array
	 */
	public function getLocalData(): array {
		return $this->data;
	}
}
