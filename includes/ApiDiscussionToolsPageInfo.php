<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use MediaWiki\Extension\VisualEditor\ApiParsoidTrait;
use Title;
use Wikimedia\ParamValidator\ParamValidator;
use Wikimedia\Parsoid\Utils\DOMUtils;

class ApiDiscussionToolsPageInfo extends ApiBase {

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
		$prop = array_fill_keys( $params['prop'], true );

		if ( !$title ) {
			$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['page'] ) ] );
		}

		$revision = $this->getValidRevision( $title, $params['oldid'] ?? null );
		$threadItemSet = $this->parseRevision( $revision );

		$result = [];

		if ( isset( $prop['transcludedfrom'] ) ) {
			$result['transcludedfrom'] = static::getTranscludedFrom( $threadItemSet );
		}

		if ( isset( $prop['threaditemshtml'] ) ) {
			$result['threaditemshtml'] = static::getThreadItemsHtml( $threadItemSet );
		}

		$this->getResult()->addValue( null, $this->getModuleName(), $result );
	}

	/**
	 * Get transcluded=from data for a ThreadItemSet
	 *
	 * @param ThreadItemSet $threadItemSet
	 * @return array
	 */
	private static function getTranscludedFrom( ThreadItemSet $threadItemSet ): array {
		$threadItems = $threadItemSet->getThreadItems();
		$transcludedFrom = [];
		foreach ( $threadItems as $threadItem ) {
			$from = $threadItem->getTranscludedFrom();

			// Key by IDs, legacy IDs, and names. This assumes that they can never conflict.

			$transcludedFrom[ $threadItem->getId() ] = $from;

			$legacyId = $threadItem->getLegacyId();
			if ( $legacyId ) {
				$transcludedFrom[ $legacyId ] = $from;
			}

			$name = $threadItem->getName();
			if ( isset( $transcludedFrom[ $name ] ) && $transcludedFrom[ $name ] !== $from ) {
				// Two or more items with the same name, transcluded from different pages.
				// Consider them both to be transcluded from unknown source.
				$transcludedFrom[ $name ] = true;
			} else {
				$transcludedFrom[ $name ] = $from;
			}
		}

		return $transcludedFrom;
	}

	/**
	 * Get thread items HTML for a ThreadItemSet
	 *
	 * @param ThreadItemSet $threadItemSet
	 * @return array
	 */
	private static function getThreadItemsHtml( ThreadItemSet $threadItemSet ): array {
		$threads = $threadItemSet->getThreads();
		if ( count( $threads ) > 0 ) {
			$firstHeading = $threads[0];
			if ( !$firstHeading->isPlaceholderHeading() ) {
				$range = new ImmutableRange( $firstHeading->getRootNode(), 0, $firstHeading->getRootNode(), 0 );
				$fakeHeading = new HeadingItem( $range, 99, true );
				$fakeHeading->setRootNode( $firstHeading->getRootNode() );
				array_unshift( $threads, $fakeHeading );
			}
		}
		$output = array_map( static function ( ThreadItem $item ) {
			return $item->jsonSerialize( true, static function ( array &$array, ThreadItem $item ) {
				$array['html'] = $item->getHtml();
			} );
		}, $threads );
		foreach ( $threads as $index => $item ) {
			// need to loop over this to fix up empty sections, because we
			// need context that's not available inside the array map
			if ( $item instanceof HeadingItem && count( $item->getReplies() ) === 0 ) {
				$nextItem = $threads[ $index + 1 ] ?? false;
				$startRange = $item->getRange();
				if ( $nextItem ) {
					$nextRange = $nextItem->getRange();
					$nextStart = $nextRange->startContainer->previousSibling ?: $nextRange->startContainer;
					$betweenRange = new ImmutableRange(
						$startRange->endContainer->nextSibling ?: $startRange->endContainer, 0,
						$nextStart, $nextStart->childNodes->length ?? 0
					);
				} else {
					// This is the last section, so we want to go to the end of the rootnode
					$betweenRange = new ImmutableRange(
						$startRange->endContainer->nextSibling ?: $startRange->endContainer, 0,
						$item->getRootNode(), $item->getRootNode()->childNodes->length
					);
				}
				$fragment = $betweenRange->cloneContents();
				CommentModifier::unwrapFragment( $fragment );
				$output[$index]['othercontent'] = trim( DOMUtils::getFragmentInnerHTML( $fragment ) );
			}
		}
		return $output;
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'page' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-page',
			],
			'oldid' => null,
			'prop' => [
				ParamValidator::PARAM_DEFAULT => 'transcludedfrom',
				ParamValidator::PARAM_ISMULTI => true,
				ParamValidator::PARAM_TYPE => [
					'transcludedfrom',
					'threaditemshtml'
				],
				ApiBase::PARAM_HELP_MSG_PER_VALUE => [],
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
