<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiMain;
use ApiResult;
use DerivativeContext;
use DerivativeRequest;
use IContextSource;
use MediaWiki\Revision\RevisionRecord;
use Title;
use TitleValue;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

/**
 * Random methods we want to share between API modules.
 *
 * @property CommentParser $commentParser
 */
trait ApiDiscussionToolsTrait {
	/**
	 * @param RevisionRecord $revision
	 * @return ContentThreadItemSet
	 */
	protected function parseRevision( RevisionRecord $revision ): ContentThreadItemSet {
		$response = $this->requestRestbasePageHtml( $revision );

		$doc = DOMUtils::parseHTML( $response['body'] );
		$container = DOMCompat::getBody( $doc );

		CommentUtils::unwrapParsoidSections( $container );

		$title = TitleValue::newFromPage( $revision->getPage() );

		return $this->commentParser->parse( $container, $title );
	}

	/**
	 * Given parameters describing a reply or new topic, transform them into wikitext using Parsoid,
	 * then preview the wikitext using the legacy parser.
	 *
	 * @param string $type 'topic' or 'reply'
	 * @param Title $title Context title for wikitext transformations
	 * @param array $params Associative array with the following keys:
	 *  - `wikitext` (string|null) Content of the message, mutually exclusive with `html`
	 *  - `html` (string|null) Content of the message, mutually exclusive with `wikitext`
	 *  - `sectiontitle` (string) Content of the title, when `type` is 'topic'
	 *  - `signature` (string|null) Wikitext signature to add to the message
	 * @param array $originalParams Original params from the source API call
	 * @return ApiResult action=parse API result
	 */
	protected function previewMessage(
		string $type, Title $title, array $params, array $originalParams = []
	): ApiResult {
		$wikitext = $params['wikitext'] ?? null;
		$html = $params['html'] ?? null;
		$signature = $params['signature'] ?? null;

		switch ( $type ) {
			case 'topic':
				if ( $wikitext !== null ) {
					if ( $signature !== null ) {
						$wikitext = CommentModifier::appendSignatureWikitext( $wikitext, $signature );
					}
				} else {
					$doc = DOMUtils::parseHTML( '' );
					$container = DOMUtils::parseHTMLToFragment( $doc, $html );
					if ( $signature !== null ) {
						CommentModifier::appendSignature( $container, $signature );
					}
					$html = DOMUtils::getFragmentInnerHTML( $container );
					$wikitext = $this->transformHTML( $title, $html )[ 'body' ];
				}

				if ( $params['sectiontitle'] ) {
					$wikitext = "== " . $params['sectiontitle'] . " ==\n" . $wikitext;
				}

				break;

			case 'reply':
				$doc = DOMUtils::parseHTML( '' );

				if ( $wikitext !== null ) {
					$container = CommentModifier::prepareWikitextReply( $doc, $wikitext );
				} else {
					$container = CommentModifier::prepareHtmlReply( $doc, $html );
				}

				if ( $signature !== null ) {
					CommentModifier::appendSignature( $container, $signature );
				}
				$list = CommentModifier::transferReply( $container );
				$html = DOMCompat::getOuterHTML( $list );

				$wikitext = $this->transformHTML( $title, $html )[ 'body' ];

				break;
		}

		$apiParams = [
			'action' => 'parse',
			'title' => $title->getPrefixedText(),
			'text' => $wikitext,
			'pst' => '1',
			'preview' => '1',
			'disableeditsection' => '1',
			'prop' => 'text|modules|jsconfigvars',
		];
		if ( isset( $originalParams['useskin'] ) ) {
			$apiParams['useskin'] = $originalParams['useskin'];
		}
		if ( isset( $originalParams['mobileformat'] ) && $originalParams['mobileformat'] ) {
			$apiParams['mobileformat'] = '1';
		}

		$context = new DerivativeContext( $this->getContext() );
		$context->setRequest(
			new DerivativeRequest(
				$context->getRequest(),
				$apiParams,
				/* was posted? */ true
			)
		);
		$api = new ApiMain(
			$context,
			/* enable write? */ false
		);

		$api->execute();
		return $api->getResult();
	}

	/**
	 * @param RevisionRecord $revision
	 * @return array
	 */
	abstract protected function requestRestbasePageHtml( RevisionRecord $revision ): array;

	/**
	 * @param Title $title
	 * @param string $html
	 * @param int|null $oldid
	 * @param string|null $etag
	 * @return array
	 */
	abstract protected function transformHTML(
		Title $title, string $html, int $oldid = null, string $etag = null
	): array;

	/**
	 * @return IContextSource
	 */
	abstract public function getContext();

}
