<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use DerivativeRequest;
use DOMElement;
use MediaWiki\Logger\LoggerFactory;
use Title;
use Wikimedia\ParamValidator\ParamValidator;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

class ApiDiscussionToolsEdit extends ApiBase {

	use ApiParsoidTrait;

	/**
	 * @inheritDoc
	 */
	public function __construct( ApiMain $main, string $name ) {
		parent::__construct( $main, $name );
		$this->setLogger( LoggerFactory::getInstance( 'DiscussionTools' ) );
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
			case 'addtopic':

				$this->requireAtLeastOneParameter( $params, 'sectiontitle' );
				$this->requireOnlyOneParameter( $params, 'wikitext', 'html' );

				$wikitext = $params['wikitext'];
				$html = $params['html'];

				if ( $wikitext !== null ) {
					$wikitext = trim( $wikitext );
					if ( !CommentModifier::isWikitextSigned( $wikitext ) ) {
						$wikitext .=
							$this->msg( 'discussiontools-signature-prefix' )->inContentLanguage()->text() . '~~~~';
					}
				} else {
					$doc = DOMUtils::parseHTML( $html );
					$container = $doc->getElementsByTagName( 'body' )->item( 0 );
					'@phan-var DOMElement $container';
					if ( !CommentModifier::isHtmlSigned( $container ) ) {
						CommentModifier::appendSignature( $container );
					}
					$html = DOMCompat::getInnerHTML( $container );
					$wikitext = $this->transformHTML( $title, $html )[ 'body' ];
				}

				// As section=new this is append only so we don't need to
				// worry about edit-conflict params such as oldid/baserevid/etag.
				// Edit summary is also automatically generated when section=new
				$api = new ApiMain(
					new DerivativeRequest(
						$this->getRequest(),
						[
							'action' => 'visualeditoredit',
							'paction' => 'save',
							'page' => $params['page'],
							'token' => $params['token'],
							'wikitext' => $wikitext,
							// A default is provided automatically by the Edit API
							// for new sections when the summary is empty.
							'summary' => $params['summary'],
							'section' => 'new',
							'sectiontitle' => $params['sectiontitle'],
							'starttimestamp' => wfTimestampNow(),
							'watchlist' => $params['watchlist'],
							'captchaid' => $params['captchaid'],
							'captchaword' => $params['captchaword']
						],
						/* was posted? */ true
					),
					/* enable write? */ true
				);

				$api->execute();

				$data = $api->getResult()->getResultData();
				$result = $data['visualeditoredit'];

				break;

			case 'addcomment':
				// Fetch the latest revision
				$requestedRevision = $this->getLatestRevision( $title );
				$response = $this->requestRestbasePageHtml( $requestedRevision );

				$headers = $response['headers'];
				$doc = DOMUtils::parseHTML( $response['body'] );

				// Don't trust RESTBase to always give us the revision we requested,
				// instead get the revision ID from the document and use that.
				// Ported from ve.init.mw.ArticleTarget.prototype.parseMetadata
				$docRevId = null;
				$aboutDoc = $doc->documentElement->getAttribute( 'about' );

				if ( $aboutDoc ) {
					preg_match( '/revision\\/([0-9]+)$/', $aboutDoc, $docRevIdMatches );
					if ( $docRevIdMatches ) {
						$docRevId = (int)$docRevIdMatches[ 1 ];
					}
				}

				if ( !$docRevId ) {
					$this->dieWithError( 'apierror-visualeditor-docserver', 'docserver' );
				}

				if ( $docRevId !== $requestedRevision->getId() ) {
					// TODO: If this never triggers, consider removing the check.
					$this->getLogger()->warning(
						"Requested revision {$requestedRevision->getId()} " .
						"but received {$docRevId}."
					);
				}

				$container = $doc->getElementsByTagName( 'body' )->item( 0 );
				'@phan-var DOMElement $container';

				$commentId = $params['commentid'] ?? null;

				if ( !$commentId ) {
					$this->dieWithError( [ 'apierror-missingparam', 'commentid' ] );
				}

				$parser = CommentParser::newFromGlobalState( $container );

				$comment = $parser->findCommentById( $commentId );
				if ( !$comment || !( $comment instanceof CommentItem ) ) {
					$this->dieWithError( [ 'apierror-discussiontools-commentid-notfound', $commentId ] );
					return;
				}

				$this->requireOnlyOneParameter( $params, 'wikitext', 'html' );

				if ( $params['wikitext'] !== null ) {
					CommentModifier::addWikitextReply( $comment, $params['wikitext'] );
				} else {
					CommentModifier::addHtmlReply( $comment, $params['html'] );
				}

				if ( isset( $params['summary'] ) ) {
					$summary = $params['summary'];
				} else {
					$heading = $comment->getHeading();
					if ( $heading->isPlaceholderHeading() ) {
						// This comment is in 0th section, there's no section title for the edit summary
						$summaryPrefix = '';
					} else {
						$summaryPrefix = '/* ' . $heading->getRange()->startContainer->textContent . ' */ ';
					}
					$summary = $summaryPrefix .
						$this->msg( 'discussiontools-defaultsummary-reply' )->inContentLanguage()->text();
				}

				$api = new ApiMain(
					new DerivativeRequest(
						$this->getRequest(),
						[
							'action' => 'visualeditoredit',
							'paction' => 'save',
							'page' => $params['page'],
							'token' => $params['token'],
							'oldid' => $docRevId,
							'html' => DOMCompat::getOuterHTML( $doc->documentElement ),
							'summary' => $summary,
							'baserevid' => $docRevId,
							'starttimestamp' => wfTimestampNow(),
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
					'addtopic',
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
			'summary' => [
				ParamValidator::PARAM_TYPE => 'string',
				ParamValidator::PARAM_DEFAULT => null,
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-summary',
			],
			'sectiontitle' => [
				ParamValidator::PARAM_TYPE => 'string',
				ApiBase::PARAM_HELP_MSG => 'apihelp-edit-param-sectiontitle',
			],
			'watchlist' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-edit-param-watchlist',
			],
			'captchaid' => [
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-captchaid',
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
