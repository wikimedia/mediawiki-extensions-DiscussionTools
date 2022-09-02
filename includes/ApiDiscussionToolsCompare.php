<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use MediaWiki\Extension\VisualEditor\ApiParsoidTrait;
use MediaWiki\Revision\RevisionRecord;
use Title;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDiscussionToolsCompare extends ApiBase {

	use ApiDiscussionToolsTrait;
	use ApiParsoidTrait;

	/** @var CommentParser */
	private $commentParser;

	/**
	 * @param ApiMain $main
	 * @param string $name
	 * @param CommentParser $commentParser
	 */
	public function __construct(
		ApiMain $main,
		string $name,
		CommentParser $commentParser
	) {
		parent::__construct( $main, $name );
		$this->commentParser = $commentParser;
	}

	/**
	 * @inheritDoc
	 */
	public function execute() {
		$params = $this->extractRequestParams();

		$this->requireOnlyOneParameter( $params, 'fromtitle', 'fromrev' );
		$this->requireOnlyOneParameter( $params, 'totitle', 'torev' );

		if ( $params['torev'] ) {
			$toRev = $this->getValidRevision( null, $params['torev'] ?? null );
		} else {
			$toTitle = Title::newFromText( $params['totitle'] );
			if ( !$toTitle ) {
				$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['totitle'] ) ] );
			}
			$toRev = $this->getValidRevision( $toTitle );
		}

		// When polling for new comments this is an important optimisation,
		// as usually there is no new revision.
		if ( $toRev->getId() === $params['fromrev'] ) {
			$this->addResult( $toRev, $toRev );
			return;
		}

		if ( $params['fromrev'] ) {
			$fromRev = $this->getValidRevision( null, $params['fromrev'] ?? null );
		} else {
			$fromTitle = Title::newFromText( $params['fromtitle'] );
			if ( !$fromTitle ) {
				$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['fromtitle'] ) ] );
			}
			$fromRev = $this->getValidRevision( $fromTitle );
		}

		if ( $fromRev->hasSameContent( $toRev ) ) {
			$this->addResult( $fromRev, $toRev );
			return;
		}

		$fromItemSet = $this->parseRevision( $fromRev );
		$toItemSet = $this->parseRevision( $toRev );

		$removedComments = [];
		foreach ( $fromItemSet->getCommentItems() as $fromComment ) {
			if ( !$toItemSet->findCommentById( $fromComment->getId() ) ) {
				$removedComments[] = $fromComment->jsonSerializeForDiff();
			}
		}

		$addedComments = [];
		foreach ( $toItemSet->getCommentItems() as $toComment ) {
			if ( !$fromItemSet->findCommentById( $toComment->getId() ) ) {
				$addedComments[] = $toComment->jsonSerializeForDiff();
			}
		}

		$this->addResult( $fromRev, $toRev, $removedComments, $addedComments );
	}

	/**
	 * Add the result object from revisions and comment lists
	 *
	 * @param RevisionRecord $fromRev From revision
	 * @param RevisionRecord $toRev To revision
	 * @param array $removedComments Removed comments
	 * @param array $addedComments Added comments
	 */
	protected function addResult(
		RevisionRecord $fromRev, RevisionRecord $toRev, array $removedComments = [], array $addedComments = []
	) {
		$fromTitle = Title::newFromLinkTarget(
			$fromRev->getPageAsLinkTarget()
		);
		$toTitle = Title::newFromLinkTarget(
			$toRev->getPageAsLinkTarget()
		);
		$result = [
			'fromrevid' => $fromRev->getId(),
			'fromtitle' => $fromTitle->getPrefixedText(),
			'torevid' => $toRev->getId(),
			'totitle' => $toTitle->getPrefixedText(),
			'removedcomments' => $removedComments,
			'addedcomments' => $addedComments,
		];
		$this->getResult()->addValue( null, $this->getModuleName(), $result );
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'fromtitle' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-compare-param-fromtitle',
			],
			'fromrev' => [
				ParamValidator::PARAM_TYPE => 'integer',
				ApiBase::PARAM_HELP_MSG => 'apihelp-compare-param-fromrev',
			],
			'totitle' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-compare-param-totitle',
			],
			'torev' => [
				ParamValidator::PARAM_TYPE => 'integer',
				ApiBase::PARAM_HELP_MSG => 'apihelp-compare-param-torev',
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
