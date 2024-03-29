<?php

namespace MediaWiki\Extension\DiscussionTools;

use IContextSource;
use InvalidArgumentException;
use MediaWiki\Cache\LinkBatchFactory;
use MediaWiki\Html\Html;
use MediaWiki\Linker\Linker;
use MediaWiki\Linker\LinkRenderer;
use MediaWiki\Pager\TablePager;
use MediaWiki\Title\Title;
use OOUI;

class TopicSubscriptionsPager extends TablePager {

	/**
	 * Map of our field names (see ::getFieldNames()) to the column names actually used for
	 * pagination. This is needed to ensure that the values are unique, and that pagination
	 * won't get "stuck" when e.g. 50 subscriptions are all created within a second.
	 */
	private const INDEX_FIELDS = [
		// The auto-increment ID will almost always have the same order as sub_created
		// and the field already has an index.
		'_topic' => [ 'sub_id' ],
		'sub_created' => [ 'sub_id' ],
		// TODO Add indexes that cover these fields to enable sorting by them
		// 'sub_state' => [ 'sub_state', 'sub_item' ],
		// 'sub_created' => [ 'sub_created', 'sub_item' ],
		// 'sub_notified' => [ 'sub_notified', 'sub_item' ],
	];

	private LinkBatchFactory $linkBatchFactory;

	public function __construct(
		IContextSource $context,
		LinkRenderer $linkRenderer,
		LinkBatchFactory $linkBatchFactory
	) {
		parent::__construct( $context, $linkRenderer );
		$this->linkBatchFactory = $linkBatchFactory;
	}

	/**
	 * @inheritDoc
	 */
	public function preprocessResults( $result ) {
		$lb = $this->linkBatchFactory->newLinkBatch();
		foreach ( $result as $row ) {
			$lb->add( $row->sub_namespace, $row->sub_title );
		}
		$lb->execute();
	}

	/**
	 * @inheritDoc
	 */
	protected function getFieldNames() {
		return [
			'_topic' => $this->msg( 'discussiontools-topicsubscription-pager-topic' )->text(),
			'_page' => $this->msg( 'discussiontools-topicsubscription-pager-page' )->text(),
			'sub_created' => $this->msg( 'discussiontools-topicsubscription-pager-created' )->text(),
			'sub_notified' => $this->msg( 'discussiontools-topicsubscription-pager-notified' )->text(),
			'_unsubscribe' => $this->msg( 'discussiontools-topicsubscription-pager-actions' )->text(),
		];
	}

	/**
	 * @inheritDoc
	 */
	public function formatValue( $field, $value ) {
		/** @var stdClass $row */
		$row = $this->mCurrentRow;
		$linkRenderer = $this->getLinkRenderer();

		switch ( $field ) {
			case '_topic':
				if ( str_starts_with( $row->sub_item, 'p-topics-' ) ) {
					return '<em>' .
						$this->msg( 'discussiontools-topicsubscription-pager-newtopics-label' )->escaped() .
					'</em>';
				} else {
					$section = $row->sub_section;
					// Detect truncated section titles: either intentionally truncated by SubscriptionStore,
					// or incorrect multibyte truncation of old entries (T345648).
					$last = mb_substr( $section, -1 );
					if ( $last !== '' && ( $last === "\x1f" || mb_ord( $last ) === false ) ) {
						$section = substr( $section, 0, -strlen( $last ) );
						// We can't link to the section correctly, since the only link we have is truncated
						return htmlspecialchars( $section ) . $this->msg( 'ellipsis' )->escaped();
					}
					$titleSection = Title::makeTitleSafe( $row->sub_namespace, $row->sub_title, $section );
					if ( !$titleSection ) {
						// Handle invalid titles of any other kind, just in case
						return htmlspecialchars( $section );
					}
					return $linkRenderer->makeLink( $titleSection, $section );
				}

			case '_page':
				$title = Title::makeTitleSafe( $row->sub_namespace, $row->sub_title );
				if ( !$title ) {
					// Handle invalid titles (T345648)
					return Html::element( 'span', [ 'class' => 'mw-invalidtitle' ],
						Linker::getInvalidTitleDescription(
							$this->getContext(), $row->sub_namespace, $row->sub_title )
						);
				}
				return $linkRenderer->makeLink( $title, $title->getPrefixedText() );

			case 'sub_created':
				return htmlspecialchars( $this->getLanguage()->userTimeAndDate( $value, $this->getUser() ) );

			case 'sub_notified':
				return $value ?
					htmlspecialchars( $this->getLanguage()->userTimeAndDate( $value, $this->getUser() ) ) :
					$this->msg( 'discussiontools-topicsubscription-pager-notified-never' )->escaped();

			case '_unsubscribe':
				$title = Title::makeTitleSafe( $row->sub_namespace, $row->sub_title );
				if ( !$title ) {
					// Handle invalid titles (T345648)
					// The title isn't checked when unsubscribing, as long as it's a valid title,
					// so specify something to make it possible to unsubscribe from the buggy entries.
					$title = Title::newMainPage();
				}
				return (string)new OOUI\ButtonWidget( [
					'label' => $this->msg( 'discussiontools-topicsubscription-pager-unsubscribe-button' )->text(),
					'classes' => [ 'ext-discussiontools-special-unsubscribe-button' ],
					'framed' => false,
					'flags' => [ 'destructive' ],
					'data' => [
						'item' => $row->sub_item,
						'title' => $title->getPrefixedText(),
					],
					'href' => $title->getLinkURL( [
						'action' => 'dtunsubscribe',
						'commentname' => $row->sub_item,
					] ),
					'infusable' => true,
				] );

			default:
				throw new InvalidArgumentException( "Unknown field '$field'" );
		}
	}

	/**
	 * @inheritDoc
	 */
	protected function getCellAttrs( $field, $value ) {
		$attrs = parent::getCellAttrs( $field, $value );
		if ( $field === '_unsubscribe' ) {
			$attrs['style'] = 'text-align: center;';
		}
		return $attrs;
	}

	/**
	 * @inheritDoc
	 */
	public function getQueryInfo() {
		return [
			'tables' => [
				'discussiontools_subscription',
			],
			'fields' => [
				'sub_id',
				'sub_item',
				'sub_namespace',
				'sub_title',
				'sub_section',
				'sub_created',
				'sub_notified',
			],
			'conds' => [
				'sub_user' => $this->getUser()->getId(),
				'sub_state != ' . SubscriptionStore::STATE_UNSUBSCRIBED,
			],
		];
	}

	/**
	 * @inheritDoc
	 */
	public function getDefaultSort() {
		return 'sub_created';
	}

	/**
	 * @inheritDoc
	 */
	public function getDefaultDirections() {
		return static::DIR_DESCENDING;
	}

	/**
	 * @inheritDoc
	 */
	public function getIndexField() {
		return [ static::INDEX_FIELDS[$this->mSort] ];
	}

	/**
	 * @inheritDoc
	 */
	protected function isFieldSortable( $field ) {
		// Hide the sort button for "Topic" as it is more accurately shown as "Created"
		return isset( static::INDEX_FIELDS[$field] ) && $field !== '_topic';
	}
}
