<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\Revision\RevisionRecord;
use Title;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

trait ApiDiscussionToolsTrait {
	/**
	 * @param RevisionRecord $revision
	 * @return CommentParser
	 */
	protected function parseRevision( RevisionRecord $revision ): CommentParser {
		$response = $this->requestRestbasePageHtml( $revision );

		$doc = DOMUtils::parseHTML( $response['body'] );
		$container = DOMCompat::getBody( $doc );

		CommentUtils::unwrapParsoidSections( $container );

		$title = Title::newFromLinkTarget(
			$revision->getPageAsLinkTarget()
		);

		return CommentParser::newFromGlobalState( $container, $title );
	}

	/**
	 * @param RevisionRecord $revision
	 * @return array
	 */
	abstract protected function requestRestbasePageHtml( RevisionRecord $revision ): array;
}
