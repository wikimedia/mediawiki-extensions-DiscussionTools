<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use DerivativeContext;
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
					$wikitext = CommentUtils::htmlTrim( $wikitext );
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
				$context = new DerivativeContext( $this->getContext() );
				$context->setRequest(
					new DerivativeRequest(
						$context->getRequest(),
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
					)
				);
				$api = new ApiMain(
					$context,
					/* enable write? */ true
				);

				$api->execute();

				$data = $api->getResult()->getResultData();
				$result = $data['visualeditoredit'];

				break;

			case 'addcomment':
				$this->requireAtLeastOneParameter( $params, 'commentid', 'commentname' );

				$commentId = $params['commentid'] ?? null;
				$commentName = $params['commentname'] ?? null;

				if ( !$title->exists() ) {
					// The page does not exist, so the comment we're trying to reply to can't exist either.
					if ( $commentId ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentid-notfound', $commentId ] );
					} else {
						$this->dieWithError( [ 'apierror-discussiontools-commentname-notfound', $commentName ] );
					}
				}

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

				$parser = CommentParser::newFromGlobalState( $container );

				if ( $commentId ) {
					$comment = $parser->findCommentById( $commentId );

					if ( !$comment || !( $comment instanceof CommentItem ) ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentid-notfound', $commentId ] );
						return;
					}

				} else {
					$comments = $parser->findCommentsByName( $commentName );
					$comment = $comments[ 0 ] ?? null;

					if ( count( $comments ) > 1 ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentname-ambiguous', $commentName ] );
						return;
					} elseif ( !$comment || !( $comment instanceof CommentItem ) ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentname-notfound', $commentName ] );
						return;
					}
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
					$title = $comment->getHeading()->getLinkableTitle();
					$summary = ( $title ? '/* ' . $title . ' */ ' : '' ) .
						$this->msg( 'discussiontools-defaultsummary-reply' )->inContentLanguage()->text();
				}

				$context = new DerivativeContext( $this->getContext() );
				$context->setRequest(
					new DerivativeRequest(
						$context->getRequest(),
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
					)
				);
				$api = new ApiMain(
					$context,
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

		if ( !isset( $result['newrevid'] ) && isset( $result['result'] ) && $result['result'] === 'success' ) {
			// No new revision, so no changes were made to the page (null edit).
			// Comment was not actually saved, so for this API, that's an error.
			// This is probably because changes were inside a transclusion's HTML?
			$this->dieWithError( 'discussiontools-error-comment-not-saved', 'comment-comment-not-saved' );
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
				ApiBase::PARAM_HELP_MSG_PER_VALUE => [],
			],
			'page' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-page',
			],
			'token' => [
				ParamValidator::PARAM_REQUIRED => true,
			],
			'commentname' => null,
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
