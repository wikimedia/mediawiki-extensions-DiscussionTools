<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\Linker\LinkTarget;
use MediaWiki\User\UserIdentity;

/**
 * Representation of a subscription to a given topic.
 */
class SubscriptionItem {
	private $itemName;
	private $linkTarget;
	private $user;
	private $state;
	private $createdTimestamp;
	private $notifiedTimestamp;

	/**
	 * @param UserIdentity $user
	 * @param string $itemName
	 * @param LinkTarget $linkTarget
	 * @param int $state 1/0 for watched/muted
	 * @param string|null $createdTimestamp When the subscription was created
	 * @param string|null $notifiedTimestamp When the item subscribed to last tried to trigger
	 *                                       a notification (even if muted).
	 */
	public function __construct(
		UserIdentity $user,
		string $itemName,
		linkTarget $linkTarget,
		int $state,
		?string $createdTimestamp,
		?string $notifiedTimestamp
	) {
		$this->user = $user;
		$this->itemName = $itemName;
		$this->linkTarget = $linkTarget;
		$this->state = $state;
		$this->createdTimestamp = $createdTimestamp;
		$this->notifiedTimestamp = $notifiedTimestamp;
	}

	/**
	 * @return UserIdentity
	 */
	public function getUserIdentity() : UserIdentity {
		return $this->user;
	}

	/**
	 * @return string
	 */
	public function getItemName() : string {
		return $this->itemName;
	}

	/**
	 * @return LinkTarget
	 */
	public function getLinkTarget() : LinkTarget {
		return $this->linkTarget;
	}

	/**
	 * Get the creation timestamp of this entry.
	 *
	 * @return string|null
	 */
	public function getCreatedTimestamp() {
		return $this->createdTimestamp;
	}

	/**
	 * Get the notification timestamp of this entry.
	 *
	 * @return string|null
	 */
	public function getNotificationTimestamp() {
		return $this->notifiedTimestamp;
	}

	/**
	 * Check if the notification is muted
	 *
	 * @return bool
	 */
	public function isMuted() : bool {
		return $this->state === 0;
	}
}
