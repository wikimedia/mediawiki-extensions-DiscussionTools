<?php

$IP = getenv( 'MW_INSTALL_PATH' );
if ( $IP === false ) {
	$IP = __DIR__ . '/../../..';
}
require_once "$IP/maintenance/Maintenance.php";

class DiscussionToolsManageForeignResources extends Maintenance {
	public function execute() {
		$frm = new ForeignResourceManager(
			__DIR__ . '/../modules/lib/foreign-resources.yaml',
			__DIR__ . '/../modules/lib'
		);
		return $frm->run( 'update', 'all' );
	}
}

$maintClass = DiscussionToolsManageForeignResources::class;
require_once RUN_MAINTENANCE_IF_MAIN;
