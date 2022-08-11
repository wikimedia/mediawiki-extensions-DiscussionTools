<?php
/**
 * DiscussionTools data updates hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use DeferrableUpdate;
use MediaWiki\Extension\DiscussionTools\ThreadItemStore;
use MediaWiki\Revision\RenderedRevision;
use MediaWiki\Storage\Hook\RevisionDataUpdatesHook;
use MWCallableUpdate;
use Title;

class DataUpdatesHooks implements RevisionDataUpdatesHook {

	/** @var ThreadItemStore */
	private $threadItemStore;

	/**
	 * @param ThreadItemStore $threadItemStore
	 */
	public function __construct(
		ThreadItemStore $threadItemStore
	) {
		$this->threadItemStore = $threadItemStore;
	}

	/**
	 * @param Title $title
	 * @param RenderedRevision $renderedRevision
	 * @param DeferrableUpdate[] &$updates
	 * @return bool|void
	 */
	public function onRevisionDataUpdates( $title, $renderedRevision, &$updates ) {
		// This doesn't trigger on action=purge, only on automatic purge after editing a template or
		// transcluded page, and API action=purge&forcelinkupdate=1.

		// TODO Deduplicate work between this and the Echo hook (make it use Parsoid too)
		$rev = $renderedRevision->getRevision();
		if ( HookUtils::isAvailableForTitle( $title ) ) {
			$updates[] = new MWCallableUpdate( function () use ( $rev ) {
				$threadItemSet = HookUtils::parseRevisionParsoidHtml( $rev );
				$this->threadItemStore->insertThreadItems( $rev, $threadItemSet );
			}, __METHOD__ );
		}
	}
}
