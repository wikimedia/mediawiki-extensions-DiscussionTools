<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiMain;
use ApiResult;
use DerivativeContext;
use DerivativeRequest;
use IContextSource;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionRecord;
use Title;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

/**
 * Random methods we want to share between API modules.
 */
trait ApiDiscussionToolsTrait {
	/**
	 * @param RevisionRecord $revision
	 * @return ThreadItemSet
	 */
	protected function parseRevision( RevisionRecord $revision ): ThreadItemSet {
		$response = $this->requestRestbasePageHtml( $revision );

		$doc = DOMUtils::parseHTML( $response['body'] );
		$container = DOMCompat::getBody( $doc );

		CommentUtils::unwrapParsoidSections( $container );

		$title = Title::newFromLinkTarget(
			$revision->getPageAsLinkTarget()
		);

		$parser = MediaWikiServices::getInstance()->getService( 'DiscussionTools.CommentParser' );
		return $parser->parse( $container, $title );
	}

	/**
	 * Given parameters describing a reply or new topic, transform them into wikitext using Parsoid,
	 * then preview the wikitext using the legacy parser.
	 *
	 * @param array $params Associative array with the following keys:
	 *  - `type` (string) 'topic' or 'reply'
	 *  - `title` (Title) Context title for wikitext transformations
	 *  - `wikitext` (string) Content of the message
	 *  - `sectiontitle` (string) Content of the title, when `type` is 'topic'
	 *  - `signature` (string|null) Wikitext signature to add to the message
	 * @return ApiResult action=parse API result
	 */
	protected function previewMessage( array $params ): ApiResult {
		$wikitext = $params['wikitext'];
		$title = $params['title'];
		$signature = $params['signature'] ?? null;

		switch ( $params['type'] ) {
			case 'topic':
				$wikitext = CommentUtils::htmlTrim( $wikitext );
				if ( $signature !== null ) {
					$wikitext .= $signature;
				}

				if ( $params['sectiontitle'] ) {
					$wikitext = "== " . $params['sectiontitle'] . " ==\n" . $wikitext;
				}

				break;

			case 'reply':
				$doc = DOMUtils::parseHTML( '' );

				$container = CommentModifier::prepareWikitextReply( $doc, $wikitext );

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
