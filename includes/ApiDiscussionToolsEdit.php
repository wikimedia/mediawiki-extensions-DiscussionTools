<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use DerivativeContext;
use DerivativeRequest;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Logger\LoggerFactory;
use MediaWiki\MediaWikiServices;
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

		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'discussiontools' );
		$autoSubscribe =
			$dtConfig->get( 'DiscussionToolsAutoTopicSubEditor' ) === 'discussiontoolsapi' &&
			HookUtils::shouldAddAutoSubscription( $this->getUser(), $title );
		$subscribableHeadingName = null;
		$subscribableSectionTitle = '';

		if ( !$title ) {
			$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['page'] ) ] );
		}

		$this->getErrorFormatter()->setContextTitle( $title );

		$session = null;
		$usedFormTokensKey = 'DiscussionTools:usedFormTokens';
		$formToken = $params['formtoken'];
		if ( $formToken ) {
			$session = $this->getContext()->getRequest()->getSession();
			$usedFormTokens = $session->get( $usedFormTokensKey ) ?? [];
			if ( in_array( $formToken, $usedFormTokens ) ) {
				$this->dieWithError( [ 'apierror-discussiontools-formtoken-used' ] );
			}
		}

		switch ( $params['paction'] ) {
			case 'addtopic':
				$this->requireAtLeastOneParameter( $params, 'sectiontitle' );
				$this->requireOnlyOneParameter( $params, 'wikitext', 'html' );

				$wikitext = $params['wikitext'];
				$html = $params['html'];

				$signature = $this->msg( 'discussiontools-signature-prefix' )->inContentLanguage()->text() . '~~~~';

				if ( $wikitext !== null ) {
					$wikitext = CommentUtils::htmlTrim( $wikitext );
					if ( !CommentModifier::isWikitextSigned( $wikitext ) ) {
						$wikitext .= $signature;
					}
				} else {
					$doc = DOMUtils::parseHTML( '' );
					$container = DOMUtils::parseHTMLToFragment( $doc, $html );
					if ( !CommentModifier::isHtmlSigned( $container ) ) {
						CommentModifier::appendSignature( $container, $signature );
					}
					$html = DOMUtils::getFragmentInnerHTML( $container );
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
							'useskin' => $params['useskin'],
							// Param is added by hook in MobileFrontend
							'mobileformat' => $params['mobileformat'] ?? null,
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

				if ( $autoSubscribe && isset( $result['content'] ) ) {
					// Determining the added topic's name directly is hard (we'd have to ensure we have the
					// same timestamp, and replicate some CommentParser stuff). Just pull it out of the response.
					$doc = DOMUtils::parseHTML( $result['content'] );
					$subscribeLinks = DOMCompat::querySelectorAll(
						DOMCompat::getBody( $doc ),
						'.ext-discussiontools-init-section-subscribe-link'
					);
					// Iterate to get the last item. (Also works if there are none somehow.)
					foreach ( $subscribeLinks as $link ) {
						$subscribableHeadingName = $link->getAttribute( 'data-mw-comment-name' );
					}
					$subscribableSectionTitle =
						MediaWikiServices::getInstance()->getParser()->stripSectionName( $params['sectiontitle'] );
				}

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

				$container = DOMCompat::getBody( $doc );

				$threadItemSet = MediaWikiServices::getInstance()->getService( 'DiscussionTools.CommentParser' )
					->parse( $container, $title );

				if ( $commentId ) {
					$comment = $threadItemSet->findCommentById( $commentId );

					if ( !$comment || !( $comment instanceof CommentItem ) ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentid-notfound', $commentId ] );
					}

				} else {
					$comments = $threadItemSet->findCommentsByName( $commentName );
					$comment = $comments[ 0 ] ?? null;

					if ( count( $comments ) > 1 ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentname-ambiguous', $commentName ] );
					} elseif ( !$comment || !( $comment instanceof CommentItem ) ) {
						$this->dieWithError( [ 'apierror-discussiontools-commentname-notfound', $commentName ] );
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
					$sectionTitle = $comment->getHeading()->getLinkableTitle();
					$summary = ( $sectionTitle ? '/* ' . $sectionTitle . ' */ ' : '' ) .
						$this->msg( 'discussiontools-defaultsummary-reply' )->inContentLanguage()->text();
				}

				if ( $autoSubscribe ) {
					$heading = $comment->getSubscribableHeading();
					if ( $heading ) {
						$subscribableHeadingName = $heading->getName();
						$subscribableSectionTitle = $heading->getLinkableTitle();
					}
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
							'useskin' => $params['useskin'],
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

		if ( $autoSubscribe && $subscribableHeadingName ) {
			$subscriptionStore = MediaWikiServices::getInstance()->getService( 'DiscussionTools.SubscriptionStore' );
			$subsTitle = $title->createFragmentTarget( $subscribableSectionTitle );
			$subscriptionStore->addAutoSubscriptionForUser( $this->getUser(), $subsTitle, $subscribableHeadingName );
		}

		// Check the post was successful (could have been blocked by ConfirmEdit) before
		// marking the form token as used.
		if ( $formToken && isset( $result['result'] ) && $result['result'] === 'success' ) {
			$usedFormTokens[] = $formToken;
			// Set an arbitrary limit of the number of form tokens to
			// store to prevent session storage from becoming full.
			// It is unlikely that form tokens other than the few most
			// recently used will be needed.
			while ( count( $usedFormTokens ) > 50 ) {
				// Discard the oldest tokens first
				array_shift( $usedFormTokens );
			}
			$session->set( $usedFormTokensKey, $usedFormTokens );
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
			'formtoken' => [
				ApiBase::PARAM_TYPE => 'string',
				ApiBase::PARAM_MAX_CHARS => 16,
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
			'useskin' => [
				ApiBase::PARAM_TYPE => array_keys(
					MediaWikiServices::getInstance()->getSkinFactory()->getInstalledSkins()
				),
				ApiBase::PARAM_HELP_MSG => 'apihelp-parse-param-useskin',
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
