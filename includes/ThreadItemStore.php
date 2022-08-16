<?php

namespace MediaWiki\Extension\DiscussionTools;

use ConfigFactory;
use MediaWiki\Extension\DiscussionTools\ThreadItem\CommentItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\DatabaseCommentItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\DatabaseHeadingItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\DatabaseThreadItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\HeadingItem;
use MediaWiki\Page\PageStore;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\Revision\RevisionStore;
use MediaWiki\User\ActorStore;
use MWTimestamp;
use ReadOnlyMode;
use stdClass;
use TitleFormatter;
use Wikimedia\Rdbms\ILBFactory;
use Wikimedia\Rdbms\ILoadBalancer;
use Wikimedia\Rdbms\IResultWrapper;
use Wikimedia\Rdbms\SelectQueryBuilder;

/**
 * Stores and fetches ThreadItemSets from the database.
 */
class ThreadItemStore {
	/** @var ConfigFactory */
	private $configFactory;

	/** @var ILoadBalancer */
	private $loadBalancer;

	/** @var ReadOnlyMode */
	private $readOnlyMode;

	/** @var PageStore */
	private $pageStore;

	/** @var RevisionStore */
	private $revStore;

	/** @var TitleFormatter */
	private $titleFormatter;

	/** @var ActorStore */
	private $actorStore;

	/**
	 * @param ConfigFactory $configFactory
	 * @param ILBFactory $lbFactory
	 * @param ReadOnlyMode $readOnlyMode
	 * @param PageStore $pageStore
	 * @param RevisionStore $revStore
	 * @param TitleFormatter $titleFormatter
	 * @param ActorStore $actorStore
	 */
	public function __construct(
		ConfigFactory $configFactory,
		ILBFactory $lbFactory,
		ReadOnlyMode $readOnlyMode,
		PageStore $pageStore,
		RevisionStore $revStore,
		TitleFormatter $titleFormatter,
		ActorStore $actorStore
	) {
		$this->configFactory = $configFactory;
		$this->loadBalancer = $lbFactory->getMainLB();
		$this->readOnlyMode = $readOnlyMode;
		$this->pageStore = $pageStore;
		$this->revStore = $revStore;
		$this->titleFormatter = $titleFormatter;
		$this->actorStore = $actorStore;
	}

	/**
	 * Returns true if the tables necessary for this feature haven't been created yet,
	 * to allow failing softly in that case.
	 *
	 * @return bool
	 */
	private function isDisabled(): bool {
		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
		return !$dtConfig->get( 'DiscussionToolsEnablePermalinksBackend' );
	}

	/**
	 * Find the thread items with the given name in the newest revision of every page in which they
	 * have appeared.
	 *
	 * @param string|string[] $itemName
	 * @return DatabaseThreadItem[]
	 */
	public function findNewestRevisionsByName( $itemName ): array {
		if ( $this->isDisabled() ) {
			return [];
		}

		$queryBuilder = $this->getIdsNamesBuilder()
			->where( [
				'it_itemname' => $itemName,
				// Disallow querying for headings of sections that contain no comments.
				// They all share the same name, so this would return a huge useless list on most wikis.
				// (But we still store them, as we might need this data elsewhere.)
				"it_itemname != 'h-'",
			] );

		$result = $this->fetchItemsResultSet( $queryBuilder );
		$revs = $this->fetchRevisionAndPageForItems( $result );

		$threadItems = [];
		foreach ( $result as $row ) {
			$threadItem = $this->getThreadItemFromRow( $row, null, $revs );
			if ( $threadItem ) {
				$threadItems[] = $threadItem;
			}
		}
		return $threadItems;
	}

	/**
	 * Find the thread items with the given ID in the newest revision of every page in which they have
	 * appeared.
	 *
	 * @param string|string[] $itemId
	 * @return DatabaseThreadItem[]
	 */
	public function findNewestRevisionsById( $itemId ): array {
		if ( $this->isDisabled() ) {
			return [];
		}

		$queryBuilder = $this->getIdsNamesBuilder();

		// First find the name associated with the ID; then find by name. Otherwise we wouldn't find the
		// latest revision in case comment ID changed, e.g. the comment was moved elsewhere on the page.
		$itemNameQueryBuilder = $this->getIdsNamesBuilder()
			->where( [ 'itid_itemid' => $itemId ] )
			->field( 'it_itemname' );
			// I think there may be more than 1 only in case of headings?
			// For comments, any ID corresponds to just 1 name.
			// Not sure how bad it is to not have limit( 1 ) here?
			// It might scan a bunch of rows...
			// ->limit( 1 );

		$queryBuilder
			->where( [
				'it_itemname IN (' . $itemNameQueryBuilder->getSQL() . ')',
				"it_itemname != 'h-'",
			] );

		$result = $this->fetchItemsResultSet( $queryBuilder );
		$revs = $this->fetchRevisionAndPageForItems( $result );

		$threadItems = [];
		foreach ( $result as $row ) {
			$threadItem = $this->getThreadItemFromRow( $row, null, $revs );
			if ( $threadItem ) {
				$threadItems[] = $threadItem;
			}
		}
		return $threadItems;
	}

	/**
	 * @param SelectQueryBuilder $queryBuilder
	 * @return IResultWrapper
	 */
	private function fetchItemsResultSet( SelectQueryBuilder $queryBuilder ): IResultWrapper {
		$queryBuilder
			->fields( [
				'itr_id',
				'it_itemname',
				'it_timestamp',
				'it_actor',
				'itid_itemid',
				'itr_parent_id',
				'itr_transcludedfrom',
				'itr_level',
				'itr_headinglevel',
				'itr_revision_id',
			] )
			// PageStore fields for the transcluded-from page
			->leftJoin( 'page', null, [ 'page_id = itr_transcludedfrom' ] )
			->fields( $this->pageStore->getSelectFields() )
			// ActorStore fields for the author
			->leftJoin( 'actor', null, [ 'actor_id = it_actor' ] )
			->fields( [ 'actor_id', 'actor_name', 'actor_user' ] )
			// Parent item ID (the string, not just the primary key)
			->leftJoin(
				$this->getIdsNamesBuilder()
					->fields( [
						'itr_parent__itr_id' => 'itr_id',
						'itr_parent__itid_itemid' => 'itid_itemid',
					] ),
				null,
				[ 'itr_parent_id = itr_parent__itr_id' ]
			)
			->field( 'itr_parent__itid_itemid' );

		return $queryBuilder->fetchResultSet();
	}

	/**
	 * @param IResultWrapper $result
	 * @return stdClass[]
	 */
	private function fetchRevisionAndPageForItems( IResultWrapper $result ): array {
		// This could theoretically be done in the same query as fetchItemsResultSet(),
		// but the resulting query would be two screens long
		// and we'd have to alias a lot of fields to avoid conflicts.
		$revs = [];
		foreach ( $result as $row ) {
			$revs[ $row->itr_revision_id ] = null;
		}
		$revQueryBuilder = $this->loadBalancer->getConnection( DB_REPLICA )->newSelectQueryBuilder()
			->queryInfo( $this->revStore->getQueryInfo( [ 'page' ] ) )
			->fields( $this->pageStore->getSelectFields() )
			->where( $revs ? [ 'rev_id' => array_keys( $revs ) ] : '0=1' );
		$revResult = $revQueryBuilder->fetchResultSet();
		foreach ( $revResult as $row ) {
			$revs[ $row->rev_id ] = $row;
		}
		return $revs;
	}

	/**
	 * @param stdClass $row
	 * @param DatabaseThreadItemSet|null $set
	 * @param array $revs
	 * @return DatabaseThreadItem|null
	 */
	private function getThreadItemFromRow(
		stdClass $row, ?DatabaseThreadItemSet $set, array $revs
	): ?DatabaseThreadItem {
		if ( $revs[ $row->itr_revision_id ] === null ) {
			// We didn't find the 'revision' table row at all, this revision is deleted.
			// (The page may or may not have other non-deleted revisions.)
			// Pretend the thread item doesn't exist to avoid leaking data to users who shouldn't see it.
			// TODO Allow privileged users to see it (we'd need to query from 'archive')
			return null;
		}

		$revRow = $revs[$row->itr_revision_id];
		$page = $this->pageStore->newPageRecordFromRow( $revRow );
		$rev = $this->revStore->newRevisionFromRow( $revRow );
		if ( $rev->isDeleted( RevisionRecord::DELETED_TEXT ) ) {
			// This revision is revision-deleted.
			// TODO Allow privileged users to see it
			return null;
		}

		if ( $set && $row->itr_parent__itid_itemid ) {
			$parent = $set->findCommentById( $row->itr_parent__itid_itemid );
		} else {
			$parent = null;
		}

		$transcludedFrom = $row->itr_transcludedfrom === null ? false : (
			$row->itr_transcludedfrom === '0' ? true :
				$this->titleFormatter->getPrefixedText(
					$this->pageStore->newPageRecordFromRow( $row )
				)
		);

		if ( $row->it_timestamp !== null && $row->it_actor !== null ) {
			$author = $this->actorStore->newActorFromRow( $row )->getName();

			$item = new DatabaseCommentItem(
				$page,
				$rev,
				$row->it_itemname,
				$row->itid_itemid,
				$parent,
				$transcludedFrom,
				(int)$row->itr_level,
				$row->it_timestamp,
				$author
			);
		} else {
			$item = new DatabaseHeadingItem(
				$page,
				$rev,
				$row->it_itemname,
				$row->itid_itemid,
				$parent,
				$transcludedFrom,
				(int)$row->itr_level,
				$row->itr_headinglevel === null ? null : (int)$row->itr_headinglevel
			);
		}

		if ( $parent ) {
			$parent->addReply( $item );
		}
		return $item;
	}

	/**
	 * Find the thread item set for the given revision, assuming that it is the current revision of
	 * its page.
	 *
	 * @param int $revId
	 * @return DatabaseThreadItemSet
	 */
	public function findThreadItemsInCurrentRevision( int $revId ): DatabaseThreadItemSet {
		if ( $this->isDisabled() ) {
			return new DatabaseThreadItemSet();
		}

		$queryBuilder = $this->getIdsNamesBuilder();
		$queryBuilder
			->where( [ 'itr_revision_id' => $revId ] )
			// We must process parents before their children in the loop later
			->orderBy( 'itr_id', SelectQueryBuilder::SORT_ASC );

		$result = $this->fetchItemsResultSet( $queryBuilder );
		$revs = $this->fetchRevisionAndPageForItems( $result );

		$set = new DatabaseThreadItemSet();
		foreach ( $result as $row ) {
			$threadItem = $this->getThreadItemFromRow( $row, $set, $revs );
			if ( $threadItem ) {
				$set->addThreadItem( $threadItem );
				$set->updateIdAndNameMaps( $threadItem );
			}
		}
		return $set;
	}

	/**
	 * @return SelectQueryBuilder
	 */
	private function getIdsNamesBuilder(): SelectQueryBuilder {
		$dbr = $this->loadBalancer->getConnection( DB_REPLICA );

		$queryBuilder = $dbr->newSelectQueryBuilder()
			->from( 'discussiontools_items' )
			->join( 'discussiontools_item_pages', null, [ 'itp_items_id = it_id' ] )
			->join( 'discussiontools_item_revisions', null, [
				'itr_items_id = it_id',
				// Only the latest revision of the items with each name
				'itr_revision_id = itp_newest_revision_id',
			] )
			->join( 'discussiontools_item_ids', null, [ 'itid_id = itr_itemid_id' ] );

		return $queryBuilder;
	}

	/**
	 * Store the thread item set.
	 *
	 * @param RevisionRecord $rev
	 * @param ThreadItemSet $threadItemSet
	 * @return bool
	 */
	public function insertThreadItems( RevisionRecord $rev, ThreadItemSet $threadItemSet ): bool {
		if ( $this->isDisabled() || $this->readOnlyMode->isReadOnly() ) {
			return false;
		}

		$dbw = $this->loadBalancer->getConnection( DB_PRIMARY );
		$didInsert = false;
		$method = __METHOD__;

		$dbw->doAtomicSection( $method, function ( $dbw ) use ( $method, $rev, $threadItemSet, &$didInsert ) {
			$itemRevisionsIds = [];
			foreach ( $threadItemSet->getThreadItems() as $item ) {
				$itemIdsId = $dbw->newSelectQueryBuilder()
					->from( 'discussiontools_item_ids' )
					->field( 'itid_id' )
					->where( [ 'itid_itemid' => $item->getId() ] )
					->caller( $method )
					->fetchField();
				if ( $itemIdsId === false ) {
					$dbw->insert(
						'discussiontools_item_ids',
						[
							'itid_itemid' => $item->getId(),
						],
						$method
					);
					$itemIdsId = $dbw->insertId();
					$didInsert = true;
				}

				$itemsId = $dbw->newSelectQueryBuilder()
					->from( 'discussiontools_items' )
					->field( 'it_id' )
					->where( [ 'it_itemname' => $item->getName() ] )
					->caller( $method )
					->fetchField();
				if ( $itemsId === false ) {
					$dbw->insert(
						'discussiontools_items',
						[
							'it_itemname' => $item->getName(),
						] +
						( $item instanceof CommentItem ? [
							'it_timestamp' =>
								$dbw->timestamp( $item->getTimestampString() ),
							'it_actor' =>
								$this->actorStore->findActorIdByName( $item->getAuthor(), $dbw ),
						] : [] ),
						$method
					);
					$itemsId = $dbw->insertId();
					$didInsert = true;
				}

				$itemRevisionsId = $dbw->newSelectQueryBuilder()
					->from( 'discussiontools_item_revisions' )
					->field( 'itr_id' )
					->where( [
						'itr_itemid_id' => $itemIdsId,
						'itr_revision_id' => $rev->getId(),
					] )
					->caller( $method )
					->fetchField();
				if ( $itemRevisionsId === false ) {
					$transcl = $item->getTranscludedFrom();
					$dbw->insert(
						'discussiontools_item_revisions',
						[
							'itr_itemid_id' => $itemIdsId,
							'itr_revision_id' => $rev->getId(),
							'itr_items_id' => $itemsId,
							'itr_parent_id' =>
								// This assumes that parent items were processed first
								$item->getParent() ? $itemRevisionsIds[ $item->getParent()->getId() ] : null,
							'itr_transcludedfrom' =>
								$transcl === false ? null : (
									$transcl === true ? 0 :
										$this->pageStore->getPageByText( $transcl )->getId()
								),
							'itr_level' => $item->getLevel(),
						] +
						( $item instanceof HeadingItem ? [
							'itr_headinglevel' => $item->isPlaceholderHeading() ? null : $item->getHeadingLevel(),
						] : [] ),
						$method
					);
					$itemRevisionsId = $dbw->insertId();
					$didInsert = true;
				}
				$itemRevisionsIds[ $item->getId() ] = $itemRevisionsId;

				// Update (or insert) the references to oldest/newest item revision.
				// The page revision we're processing is usually the newest one, but it doesn't have to be
				// (in case of backfilling using the maintenance script, or in case of revisions being
				// imported), so we need all these funky queries to see if we need to update oldest/newest.

				// This should be a single upsert query (INSERT ... ON DUPLICATE KEY UPDATE), however it
				// doesn't work in practice:
				//
				// - Attempt 1:
				//   https://gerrit.wikimedia.org/r/c/mediawiki/extensions/DiscussionTools/+/771974/14/includes/ThreadItemStore.php#451
				//
				//   This is the same logic as below in SQL: only doing a single comparison of the timestamp
				//   of the current revision to the existing data in discussiontools_item_pages.
				//   It worked great on my machine, `mysql --version`:
				//     mysql  Ver 8.0.29-0ubuntu0.20.04.3 for Linux on x86_64 ((Ubuntu))
				//   but it failed in Wikimedia CI, `mysql --version`:
				//     mysql  Ver 15.1 Distrib 10.3.34-MariaDB, for debian-linux-gnu (x86_64) using readline 5.2
				//   …with the error:
				//     "Error 1054: Unknown column 'itp_oldest_revision_id' in 'where clause'".
				//   Apparently it doesn't like dependent subqueries in the UPDATE part of an upsert.
				//   I'm not sure if it's a bug in MariaDB or if you're not supposed to do that.
				//
				// - Attempt 2:
				//   https://gerrit.wikimedia.org/r/c/mediawiki/extensions/DiscussionTools/+/771974/15/includes/ThreadItemStore.php#451
				//
				//   This avoids the dependent subquery: instead of comparing to the existing data in
				//   discussiontools_item_pages, it just takes the IDs with min/max timestamp from
				//   discussiontools_item_revisions/revision. This should be a simple lookup from an index,
				//   but apparently it doesn't work that way and is significantly slower (the maintenance
				//   script went from 13 minutes to 18 minutes when processing a few thousands of revisions
				//   on my local testing wiki).
				//
				// In the end, the solution below using multiple queries is just as fast as the original,
				// and only a little more verbose.

				$itemPagesRow = $dbw->newSelectQueryBuilder()
					->from( 'discussiontools_item_pages' )
					->join( 'revision', 'revision_oldest', [ 'itp_oldest_revision_id = revision_oldest.rev_id' ] )
					->join( 'revision', 'revision_newest', [ 'itp_newest_revision_id = revision_newest.rev_id' ] )
					->field( 'itp_id' )
					->field( 'revision_oldest.rev_timestamp', 'oldest_rev_timestamp' )
					->field( 'revision_newest.rev_timestamp', 'newest_rev_timestamp' )
					->where( [
						'itp_items_id' => $itemsId,
						'itp_page_id' => $rev->getPageId(),
					] )
					->fetchRow();
				if ( $itemPagesRow === false ) {
					$dbw->insert(
						'discussiontools_item_pages',
						[
							'itp_items_id' => $itemsId,
							'itp_page_id' => $rev->getPageId(),
							'itp_oldest_revision_id' => $rev->getId(),
							'itp_newest_revision_id' => $rev->getId(),
						],
						$method
					);
				} else {
					$existingTime = ( new MWTimestamp( $itemPagesRow->oldest_rev_timestamp ) )->getTimestamp( TS_MW );
					if ( $existingTime >= $rev->getTimestamp() ) {
						$dbw->update(
							'discussiontools_item_pages',
							[ 'itp_oldest_revision_id' => $rev->getId() ],
							[ 'itp_id' => $itemPagesRow->itp_id ],
							$method
						);
					}
					$existingTime = ( new MWTimestamp( $itemPagesRow->newest_rev_timestamp ) )->getTimestamp( TS_MW );
					if ( $existingTime <= $rev->getTimestamp() ) {
						$dbw->update(
							'discussiontools_item_pages',
							[ 'itp_newest_revision_id' => $rev->getId() ],
							[ 'itp_id' => $itemPagesRow->itp_id ],
							$method
						);
					}
				}

				// Delete rows that we don't care about, to save space (item revisions with the same ID and
				// name as the one we just inserted, which are not the oldest or newest revision).
				$oldestRevisionSql = $dbw->newSelectQueryBuilder()
					->from( 'discussiontools_item_pages' )
					->field( 'itp_oldest_revision_id' )
					->where( [ 'itp_items_id' => $itemsId ] )
					->caller( $method )
					->getSQL();
				$newestRevisionSql = $dbw->newSelectQueryBuilder()
					->from( 'discussiontools_item_pages' )
					->field( 'itp_newest_revision_id' )
					->where( [ 'itp_items_id' => $itemsId ] )
					->caller( $method )
					->getSQL();
				$dbw->delete(
					'discussiontools_item_revisions',
					[
						'itr_itemid_id' => $itemIdsId,
						'itr_items_id' => $itemsId,
						"itr_revision_id NOT IN ($oldestRevisionSql)",
						"itr_revision_id NOT IN ($newestRevisionSql)",
					],
					$method
				);
			}
		}, $dbw::ATOMIC_CANCELABLE );

		return $didInsert;
	}
}
