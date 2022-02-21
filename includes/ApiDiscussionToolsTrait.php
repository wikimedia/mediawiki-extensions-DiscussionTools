<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionRecord;
use Title;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

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
	 * @param RevisionRecord $revision
	 * @return array
	 */
	abstract protected function requestRestbasePageHtml( RevisionRecord $revision ): array;
}
