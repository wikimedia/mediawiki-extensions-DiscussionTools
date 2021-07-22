<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\Extension\DiscussionTools\Notifications\EventDispatcher;
use MediaWiki\Page\PageIdentity;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\User\UserIdentity;

class MockEventDispatcher extends EventDispatcher {

	/**
	 * Public for testing
	 *
	 * Note that we can't use TestingAccessWrapper instead of this, because it doesn't support passing
	 * arguments by reference (causes exceptions like "PHPUnit\Framework\Error\Warning: Parameter 1 to
	 * ... expected to be a reference, value given").
	 *
	 * @param array &$events
	 * @param CommentParser $oldParser
	 * @param CommentParser $newParser
	 * @param RevisionRecord $newRevRecord
	 * @param PageIdentity $title
	 * @param UserIdentity $user
	 */
	public static function generateEventsFromParsers(
		array &$events,
		CommentParser $oldParser,
		CommentParser $newParser,
		RevisionRecord $newRevRecord,
		PageIdentity $title,
		UserIdentity $user
	) {
		parent::generateEventsFromParsers(
			$events,
			$oldParser,
			$newParser,
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
	public static function addCommentChangeTag( RevisionRecord $newRevRecord ) {
	}

}
