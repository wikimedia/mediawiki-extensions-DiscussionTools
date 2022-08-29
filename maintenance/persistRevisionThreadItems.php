<?php

namespace MediaWiki\Extension\DiscussionTools\Maintenance;

use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Extension\DiscussionTools\ThreadItemStore;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionStore;
use MWExceptionRenderer;
use stdClass;
use TableCleanup;
use Throwable;
use Title;

// Security: Disable all stream wrappers and reenable individually as needed
foreach ( stream_get_wrappers() as $wrapper ) {
	stream_wrapper_unregister( $wrapper );
}

stream_wrapper_restore( 'file' );
$basePath = getenv( 'MW_INSTALL_PATH' );
if ( $basePath ) {
	if ( !is_dir( $basePath )
		|| strpos( $basePath, '~' ) !== false
	) {
		die( "Bad MediaWiki install path: $basePath\n" );
	}
} else {
	$basePath = __DIR__ . '/../../..';
}
require_once "$basePath/maintenance/Maintenance.php";
// Autoloader isn't set up yet until we do `require_once RUN_MAINTENANCE_IF_MAIN`…
// but our class needs to exist at that point D:
require_once "$basePath/maintenance/TableCleanup.php";

class PersistRevisionThreadItems extends TableCleanup {

	/** @var ThreadItemStore */
	private $itemStore;

	/** @var RevisionStore */
	private $revStore;

	public function __construct() {
		parent::__construct();
		$this->requireExtension( 'DiscussionTools' );
		$this->addDescription( 'Persist thread item information for the given pages/revisions' );
		$this->addOption( 'rev', 'Revision ID to process', false, true, false, true );
		$this->addOption( 'page', 'Page title to process', false, true, false, true );
		$this->addOption( 'all', 'Process the whole wiki', false, false, false, false );
		$this->addOption( 'current', 'Process current revisions only', false, false, false, false );
	}

	public function execute() {
		$services = MediaWikiServices::getInstance();

		$this->itemStore = $services->getService( 'DiscussionTools.ThreadItemStore' );
		$this->revStore = $services->getRevisionStore();

		if ( $this->getOption( 'all' ) ) {
			$conds = [];

		} elseif ( $this->getOption( 'page' ) ) {
			$linkBatch = $services->getLinkBatchFactory()->newLinkBatch();
			foreach ( $this->getOption( 'page' ) as $page ) {
				$linkBatch->addObj( Title::newFromText( $page ) );
			}
			$pageIds = array_map( static function ( $page ) {
				return $page->getId();
			}, $linkBatch->getPageIdentities() );

			$conds = [ 'rev_page' => $pageIds ];

		} elseif ( $this->getOption( 'rev' ) ) {
			$conds = [ 'rev_id' => $this->getOption( 'rev' ) ];
		} else {
			$this->error( "One of 'all', 'page', or 'rev' required" );
			$this->maybeHelp( true );
			return;
		}

		if ( $this->getOption( 'current' ) ) {
			// runTable() doesn't provide a way to do a JOIN. This is equivalent, but it might have
			// different performance characteristics. It should be good enough for a maintenance script.
			$conds[] = 'rev_id IN ( SELECT page_latest FROM page )';
		}

		$this->runTable( [
			'table' => 'revision',
			'conds' => $conds,
			'index' => [ 'rev_page', 'rev_timestamp', 'rev_id' ],
			'callback' => 'processRow',
		] );
	}

	/**
	 * @param stdClass $row Database table row
	 */
	protected function processRow( stdClass $row ) {
		$changed = false;
		try {
			// HACK (because we don't query the table this data ordinarily comes from,
			// and we don't care about edit summaries here)
			$row->rev_comment_text = '';
			$row->rev_comment_data = null;
			$row->rev_comment_cid = null;

			$rev = $this->revStore->newRevisionFromRow( $row );
			$title = Title::newFromLinkTarget(
				$rev->getPageAsLinkTarget()
			);
			if ( HookUtils::isAvailableForTitle( $title ) ) {
				$threadItemSet = HookUtils::parseRevisionParsoidHtml( $rev );

				if ( !$this->dryrun ) {
					// Store permalink data
					$changed = $this->itemStore->insertThreadItems( $rev, $threadItemSet );
				}
			}
		} catch ( Throwable $e ) {
			$this->output( "Error while processing revid=$row->rev_id, pageid=$row->rev_page\n" );
			MWExceptionRenderer::output( $e, MWExceptionRenderer::AS_RAW );
		}
		$this->progress( (int)$changed );
	}
}

$maintClass = PersistRevisionThreadItems::class;
require_once RUN_MAINTENANCE_IF_MAIN;
