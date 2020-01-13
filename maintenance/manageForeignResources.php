<?php

$IP = getenv( 'MW_INSTALL_PATH' );
if ( $IP === false ) {
	$IP = __DIR__ . '/../../..';
}
require_once "$IP/maintenance/Maintenance.php";

class ManageForeignResources extends Maintenance {

	public function __construct() {
		parent::__construct();
		$this->requireExtension( 'DiscussionTools' );
	}

	public function execute() {
		$frm = new ForeignResourceManager(
			__DIR__ . '/../modules/lib/foreign-resources.yaml',
			__DIR__ . '/../modules/lib'
		);
		return $frm->run( 'update', 'all' );
	}
}

$maintClass = ManageForeignResources::class;
require_once RUN_MAINTENANCE_IF_MAIN;
