<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\SubscriptionStore;
use MediaWiki\User\UserIdentity;

class MockSubscriptionStore extends SubscriptionStore {

	/**
	 * @param mixed ...$args Unused, required for inheritance
	 */
	public function __construct( ...$args ) {
	}

	/**
	 * @param UserIdentity $user Unused, required for inheritance
	 * @param string|null $itemName Unused, required for inheritance
	 * @param int|null $state Unused, required for inheritance
	 * @param array $options Unused, required for inheritance
	 * @return array
	 */
	public function getSubscriptionItemsForUser(
		UserIdentity $user,
		?string $itemName = null,
		?int $state = null,
		array $options = []
	) : array {
		return [];
	}

}
