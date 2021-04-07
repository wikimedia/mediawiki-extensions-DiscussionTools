<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use DOMElement;
use Title;
use Wikimedia\ParamValidator\ParamValidator;
use Wikimedia\Parsoid\Utils\DOMUtils;

class ApiDiscussionTools extends ApiBase {

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
		$result = null;

		if ( !$title ) {
			$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['page'] ) ] );
			return;
		}

		switch ( $params['paction'] ) {
			case 'transcludedfrom':
				$response = $this->requestRestbasePageHtml(
					$this->getValidRevision( $title, $params['oldid'] ?? null )
				);

				$doc = DOMUtils::parseHTML( $response['body'] );
				$container = $doc->getElementsByTagName( 'body' )->item( 0 );
				'@phan-var DOMElement $container';

				CommentUtils::unwrapParsoidSections( $container );

				$parser = CommentParser::newFromGlobalState( $container );
				$threadItems = $parser->getThreadItems();

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

				$result = $transcludedFrom;
				break;
		}

		$this->getResult()->addValue( null, $this->getModuleName(), $result );
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'paction' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => [
					'transcludedfrom',
				],
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-paction',
				ApiBase::PARAM_HELP_MSG_PER_VALUE => [],
			],
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
