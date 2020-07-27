<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use DerivativeRequest;
use DOMElement;
use Title;
use Wikimedia\ParamValidator\ParamValidator;
use Wikimedia\Parsoid\Utils\DOMUtils;

class ApiDiscussionToolsEdit extends ApiBase {

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
			case 'addcomment':
				// Fetch the latest revision
				$revision = $this->getLatestRevision( $title );
				$oldid = $revision->getId();
				$response = $this->requestRestbasePageHtml( $revision );
				$headers = $response['headers'];

				$doc = DOMUtils::parseHTML( $response['body'] );
				$container = $doc->getElementsByTagName( 'body' )->item( 0 );
				'@phan-var DOMElement $container';

				$commentId = $params['commentid'] ?? null;

				if ( !$commentId ) {
					$this->dieWithError( [ 'apierror-missingparam', 'commentid' ] );
				}

				$parser = CommentParser::newFromGlobalState( $container );
				$comment = $parser->findCommentById( $commentId );
				if ( !$comment ) {
					$this->dieWithError( [ 'apierror-discussiontools-commentid-notfound', $commentId ] );
					return;
				}

				$this->requireOnlyOneParameter( $params, 'wikitext', 'html' );

				if ( $params['wikitext'] !== null ) {
					CommentModifier::addWikitextReply( $comment, $params['wikitext'] );
				} else {
					CommentModifier::addHtmlReply( $comment, $params['html'] );
				}

				$heading = $comment->getHeading();
				if ( $heading->isPlaceholderHeading() ) {
					// This comment is in 0th section, there's no section title for the edit summary
					$summaryPrefix = '';
				} else {
					$summaryPrefix = '/* ' . $heading->getRange()->startContainer->textContent . ' */ ';
				}
				$summary = $summaryPrefix .
					$this->msg( 'discussiontools-defaultsummary-reply' )->inContentLanguage()->text();

				$api = new ApiMain(
					new DerivativeRequest(
						$this->getRequest(),
						[
							'action' => 'visualeditoredit',
							'paction' => 'save',
							'page' => $params['page'],
							'token' => $params['token'],
							'oldid' => $oldid,
							'html' => $doc->saveHtml(),
							'summary' => $summary,
							'baserevid' => $revision->getId(),
							'starttimestamp' => wfTimestampNow(),
							'basetimestamp' => $revision->getTimestamp(),
							'etag' => $headers['etag'],
							'watchlist' => $params['watchlist'],
							'captchaid' => $params['captchaid'],
							'captchaword' => $params['captchaword']
						],
						/* was posted? */ true
					),
					/* enable write? */ true
				);

				$api->execute();

				// TODO: Tags are only added by 'dttags' existing on the original request
				// context (see Hook::onRecentChangeSave). What tags (if any) should be
				// added in this API?

				$data = $api->getResult()->getResultData();
				$result = $data['visualeditoredit'];
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
					'addcomment',
				],
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-paction',
			],
			'page' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-page',
			],
			'token' => [
				ParamValidator::PARAM_REQUIRED => true,
			],
			'commentid' => null,
			'wikitext' => [
				ParamValidator::PARAM_TYPE => 'text',
				ParamValidator::PARAM_DEFAULT => null,
			],
			'html' => [
				ParamValidator::PARAM_TYPE => 'text',
				ParamValidator::PARAM_DEFAULT => null,
			],
			'watchlist' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-edit-param-watchlist',
			],
			'captchaid' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-captchaword',
			],
			'captchaword' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-captchaword',
			],
		];
	}

	/**
	 * @inheritDoc
	 */
	public function needsToken() {
		return 'csrf';
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
		return true;
	}
}
