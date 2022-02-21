<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use Title;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDiscussionToolsPageInfo extends ApiBase {

	use ApiDiscussionToolsTrait;
	use ApiParsoidTrait;

	/**
	 * @inheritDoc
	 */
	public function __construct( ApiMain $main, string $name ) {
		parent::__construct( $main, $name );
	}

	/**
	 * @inheritDoc
	 */
	public function execute() {
		$params = $this->extractRequestParams();
		$title = Title::newFromText( $params['page'] );

		if ( !$title ) {
			$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['page'] ) ] );
		}

		$revision = $this->getValidRevision( $title, $params['oldid'] ?? null );
		$threadItemSet = $this->parseRevision( $revision );
		$threadItems = $threadItemSet->getThreadItems();

		$transcludedFrom = [];
		foreach ( $threadItems as $threadItem ) {
			$from = $threadItem->getTranscludedFrom();

			// Key by IDs, legacy IDs, and names. This assumes that they can never conflict.

			$transcludedFrom[ $threadItem->getId() ] = $from;

			$legacyId = $threadItem->getLegacyId();
			if ( $legacyId ) {
				$transcludedFrom[ $legacyId ] = $from;
			}

			$name = $threadItem->getName();
			if ( isset( $transcludedFrom[ $name ] ) && $transcludedFrom[ $name ] !== $from ) {
				// Two or more items with the same name, transcluded from different pages.
				// Consider them both to be transcluded from unknown source.
				$transcludedFrom[ $name ] = true;
			} else {
				$transcludedFrom[ $name ] = $from;
			}
		}

		$result = [
			'transcludedfrom' => $transcludedFrom
		];

		$this->getResult()->addValue( null, $this->getModuleName(), $result );
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'page' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-page',
			],
			'oldid' => null,
		];
	}

	/**
	 * @inheritDoc
	 */
	public function needsToken() {
		return false;
	}

	/**
	 * @inheritDoc
	 */
	public function isInternal() {
		return true;
	}

	/**
	 * @inheritDoc
	 */
	public function isWriteMode() {
		return false;
	}
}
