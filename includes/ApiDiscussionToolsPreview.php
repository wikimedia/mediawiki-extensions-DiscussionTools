<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ApiParsoidTrait;
use Title;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDiscussionToolsPreview extends ApiBase {

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
		if ( $params['type'] === 'topic' ) {
			$this->requireAtLeastOneParameter( $params, 'sectiontitle' );
		}

		// Add signature if missing
		$signature = null;
		if ( !CommentModifier::isWikitextSigned( $params['wikitext'] ) ) {
			$signature = $this->msg( 'discussiontools-signature-prefix' )->inContentLanguage()->text() . '~~~~';
			// Drop opacity of signature in preview to make message body preview clearer.
			// Extract any leading spaces outside the <span> markup to ensure accurate previews.
			$signature = preg_replace_callback( '/^( *)(.+)$/', static function ( $matches ) {
				list( , $leadingSpaces, $sig ) = $matches;
				return $leadingSpaces . '<span style="opacity: 0.6;">' . $sig . '</span>';
			}, $signature );
		}

		$result = $this->previewMessage( [
			'type' => $params['type'],
			'title' => $title,
			'wikitext' => $params['wikitext'],
			'sectiontitle' => $params['sectiontitle'],
			'signature' => $signature,
		] );

		$this->getResult()->addValue( null, $this->getModuleName(), $result->serializeForApiResult() );
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'type' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => [
					'reply',
					'topic',
				],
				ApiBase::PARAM_HELP_MSG_PER_VALUE => [],
			],
			'page' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-page',
			],
			'wikitext' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => 'text',
			],
			'sectiontitle' => [
				ParamValidator::PARAM_TYPE => 'string',
				ApiBase::PARAM_HELP_MSG => 'apihelp-edit-param-sectiontitle',
			],
		];
	}

	/**
	 * @inheritDoc
	 */
	public function isInternal() {
		return true;
	}
}
