<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\Notifications\EventDispatcher;
use MediaWiki\Extension\DiscussionTools\ThreadItemSet;
use MediaWiki\Page\PageIdentity;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\User\UserIdentity;
use Title;

class MockEventDispatcher extends EventDispatcher {

	/**
	 * Public for testing
	 *
	 * Note that we can't use TestingAccessWrapper instead of this, because it doesn't support passing
	 * arguments by reference (causes exceptions like "PHPUnit\Framework\Error\Warning: Parameter 1 to
	 * ... expected to be a reference, value given").
	 *
	 * @param array &$events
	 * @param ThreadItemSet $oldItemSet
	 * @param ThreadItemSet $newItemSet
	 * @param RevisionRecord $newRevRecord
	 * @param PageIdentity $title
	 * @param UserIdentity $user
	 */
	public static function generateEventsFromItemSets(
		array &$events,
		ThreadItemSet $oldItemSet,
		ThreadItemSet $newItemSet,
		RevisionRecord $newRevRecord,
		PageIdentity $title,
		UserIdentity $user
	): void {
		parent::generateEventsFromItemSets(
			$events,
			$oldItemSet,
			$newItemSet,
			$newRevRecord,
			$title,
			$user
		);
	}

	/**
	 * No-op for testing
	 *
	 * @param RevisionRecord $newRevRecord
	 */
	public static function addCommentChangeTag( RevisionRecord $newRevRecord ): void {
	}

	/**
	 * No-op for testing
	 *
	 * @param UserIdentity $user
	 * @param Title $title
	 * @param string $itemName
	 */
	protected static function addAutoSubscription( UserIdentity $user, Title $title, string $itemName ): void {
	}

}
