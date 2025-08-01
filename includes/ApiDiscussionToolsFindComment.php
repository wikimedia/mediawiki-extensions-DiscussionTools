<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\Api\ApiBase;
use MediaWiki\Api\ApiMain;
use MediaWiki\Api\ApiUsageException;
use MediaWiki\Extension\DiscussionTools\ThreadItem\DatabaseThreadItem;
use MediaWiki\Title\Title;
use MediaWiki\Title\TitleFormatter;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDiscussionToolsFindComment extends ApiBase {

	private ThreadItemStore $threadItemStore;
	private TitleFormatter $titleFormatter;

	public function __construct(
		ApiMain $main,
		string $name,
		ThreadItemStore $threadItemStore,
		TitleFormatter $titleFormatter
	) {
		parent::__construct( $main, $name );
		$this->threadItemStore = $threadItemStore;
		$this->titleFormatter = $titleFormatter;
	}

	/**
	 * @inheritDoc
	 * @throws ApiUsageException
	 */
	public function execute() {
		$params = $this->extractRequestParams();

		$values = [];

		$this->requireAtLeastOneParameter( $params, 'idorname', 'heading', 'page' );

		if ( $params['idorname'] ) {
			$idOrName = $params['idorname'];

			$byId = $this->threadItemStore->findNewestRevisionsById( $idOrName );
			foreach ( $byId as $item ) {
				$values[] = $this->getValue( $item, 'id' );
			}

			$byName = $this->threadItemStore->findNewestRevisionsByName( $idOrName );
			foreach ( $byName as $item ) {
				$values[] = $this->getValue( $item, 'name' );
			}
		} else {
			$this->requireAtLeastOneParameter( $params, 'heading' );
			$this->requireAtLeastOneParameter( $params, 'page' );

			$heading = $params['heading'];
			$page = $params['page'];

			$title = Title::newFromText( $page );
			if ( $title ) {
				$articleId = $title->getArticleId();

				if ( $articleId ) {
					try {
						$byHeading = $this->threadItemStore->findNewestRevisionsByHeading(
							$heading, $articleId, $title->getTitleValue()
						);
					} catch ( PageNeverHadThreadsException ) {
						$this->dieWithError( [ 'apierror-discussiontools-findcomment-pagenevertalk' ] );
					}
					foreach ( $byHeading as $item ) {
						$values[] = $this->getValue( $item, 'heading' );
					}
				} else {
					// TODO: Consider if we should still search if the article ID is not found
					$this->dieWithError( [ 'apierror-discussiontools-findcomment-pagenevertalk' ] );
				}
			} else {
				// TODO: Consider if we should still search if the title is invalid
				$this->dieWithError( [ 'apierror-discussiontools-findcomment-pagenevertalk' ] );
			}
		}

		$redirects = 0;
		foreach ( $values as $value ) {
			if ( $value['couldredirect'] ) {
				$redirects++;
				if ( $redirects > 1 ) {
					break;
				}
			}
		}
		foreach ( $values as $value ) {
			if ( $redirects === 1 && $value['couldredirect'] ) {
				$value['shouldredirect'] = true;
			}
			$this->getResult()->addValue( $this->getModuleName(), null, $value );
		}
	}

	/**
	 * Get a value to add to the results
	 *
	 * @param DatabaseThreadItem $item Thread item
	 * @param string $matchedBy How the thread item was matched (id, name or heading)
	 * @return array
	 */
	private function getValue( DatabaseThreadItem $item, string $matchedBy ): array {
		$title = Title::castFromPageReference( $item->getPage() );

		return [
			'id' => $item->getId(),
			'name' => $item->getName(),
			'title' => $this->titleFormatter->getPrefixedText( $item->getPage() ),
			'oldid' => !$item->getRevision()->isCurrent() ? $item->getRevision()->getId() : null,
			'matchedby' => $matchedBy,
			// Could this be an automatic redirect? Will be converted to 'shouldredirect'
			// if there is only one of these in the result set.
			'couldredirect' => $item->isCanonicalPermalink(),
		];
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'idorname' => [
				ParamValidator::PARAM_TYPE => 'string',
			],
			'heading' => [
				ParamValidator::PARAM_TYPE => 'string',
			],
			'page' => [
				ParamValidator::PARAM_TYPE => 'string',
			],
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
	public function isWriteMode() {
		return false;
	}
}
