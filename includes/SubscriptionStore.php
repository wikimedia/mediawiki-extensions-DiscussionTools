<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\Linker\LinkTarget;
use MediaWiki\Logger\LoggerFactory;
use MediaWiki\User\UserFactory;
use MediaWiki\User\UserIdentity;
use ReadOnlyMode;
use stdClass;
use TitleValue;
use Wikimedia\Rdbms\FakeResultWrapper;
use Wikimedia\Rdbms\IDatabase;
use Wikimedia\Rdbms\ILBFactory;
use Wikimedia\Rdbms\ILoadBalancer;
use Wikimedia\Rdbms\IResultWrapper;

// use Wikimedia\ParamValidator\TypeDef\ExpiryDef;
// use Wikimedia\Timestamp\ConvertibleTimestamp;

class SubscriptionStore {
	/**
	 * Maximum number of subscriptions that we can store for each user.
	 */
	private const USER_SUBSCRIPTION_LIMIT = 5000;

	/** @var ILBFactory */
	private $lbFactory;

	/** @var ILoadBalancer */
	private $loadBalancer;

	/** @var ReadOnlyMode */
	private $readOnlyMode;

	/** @var UserFactory */
	private $userFactory;

	/**
	 * @param ILBFactory $lbFactory
	 * @param ReadOnlyMode $readOnlyMode
	 * @param UserFactory $userFactory
	 */
	public function __construct(
		ILBFactory $lbFactory,
		ReadOnlyMode $readOnlyMode,
		UserFactory $userFactory
	) {
		$this->lbFactory = $lbFactory;
		$this->loadBalancer = $lbFactory->getMainLB();

		$this->userFactory = $userFactory;
		$this->readOnlyMode = $readOnlyMode;
	}

	/**
	 * @param int $dbIndex DB_PRIMARY or DB_REPLICA
	 *
	 * @return IDatabase
	 */
	private function getConnectionRef( $dbIndex ) : IDatabase {
		return $this->loadBalancer->getConnectionRef( $dbIndex, [ 'watchlist' ] );
	}

	/**
	 * @param IDatabase $db
	 * @param UserIdentity|null $user
	 * @param array|null $itemNames
	 * @param int|null $state
	 * @return IResultWrapper|false
	 */
	private function fetchSubscriptions(
		IDatabase $db,
		?UserIdentity $user = null,
		?array $itemNames = null,
		?int $state = null
	) {
		$conditions = [];

		if ( $user ) {
			$conditions[ 'sub_user' ] = $user->getId();
		}

		if ( $itemNames !== null ) {
			if ( !count( $itemNames ) ) {
				// We are not allowed to construct a filter with an empty array.
				// Any empty array should result in no items being returned.
				return new FakeResultWrapper( [] );
			}
			$conditions[ 'sub_item' ] = $itemNames;
		}

		if ( $state !== null ) {
			$conditions[ 'sub_state' ] = $state;
		}

		return $db->select(
			'discussiontools_subscription',
			[
				'sub_user', 'sub_item', 'sub_namespace', 'sub_title', 'sub_section', 'sub_state',
				'sub_created', 'sub_notified'
			],
			$conditions,
			__METHOD__
		);
	}

	/**
	 * @param UserIdentity $user
	 * @param array|null $itemNames
	 * @param int|null $state
	 * @param array $options
	 * @return SubscriptionItem[]
	 */
	public function getSubscriptionItemsForUser(
		UserIdentity $user,
		?array $itemNames = null,
		?int $state = null,
		array $options = []
	) : array {
		// Only a registered user can be subscribed
		if ( !$user->isRegistered() ) {
			return [];
		}

		$options += [ 'forWrite' => false ];
		$db = $this->getConnectionRef( $options['forWrite'] ? DB_PRIMARY : DB_REPLICA );

		$rows = $this->fetchSubscriptions(
			$db,
			$user,
			$itemNames,
			$state
		);

		if ( !$rows ) {
			return [];
		}

		$items = [];
		foreach ( $rows as $row ) {
			$target = new TitleValue( (int)$row->sub_namespace, $row->sub_title, $row->sub_section );
			$items[] = $this->getSubscriptionItemFromRow( $user, $target, $row );
		}

		return $items;
	}

	/**
	 * @param string $itemName
	 * @param int|null $state
	 * @param array $options
	 * @return array
	 */
	public function getSubscriptionItemsForTopic(
		string $itemName,
		?int $state = null,
		array $options = []
	) : array {
		$options += [ 'forWrite' => false ];
		$db = $this->getConnectionRef( $options['forWrite'] ? DB_PRIMARY : DB_REPLICA );

		$rows = $this->fetchSubscriptions(
			$db,
			null,
			[ $itemName ],
			$state
		);

		if ( !$rows ) {
			return [];
		}

		$items = [];
		foreach ( $rows as $row ) {
			$target = new TitleValue( (int)$row->sub_namespace, $row->sub_title, $row->sub_section );
			$user = $this->userFactory->newFromId( $row->sub_user );
			$items[] = $this->getSubscriptionItemFromRow( $user, $target, $row );
		}

		return $items;
	}

	/**
	 * @param UserIdentity $user
	 * @param LinkTarget $target
	 * @param stdClass $row
	 * @return SubscriptionItem
	 */
	private function getSubscriptionItemFromRow(
		UserIdentity $user,
		LinkTarget $target,
		stdClass $row
	) : SubscriptionItem {
		return new SubscriptionItem(
			$user,
			$row->sub_item,
			$target,
			$row->sub_state,
			$row->sub_created,
			$row->sub_notified
		);
	}

	/**
	 * @param UserIdentity $user
	 * @return bool
	 */
	private function userExceedsSubscriptionLimit( UserIdentity $user ) : bool {
		$logger = LoggerFactory::getInstance( 'DiscussionTools' );
		// This is always queried before updating
		$db = $this->getConnectionRef( DB_PRIMARY );

		$rowCount = $db->selectRowCount(
			'discussiontools_subscription',
			'*',
			[ 'sub_user' => $user->getId() ],
			__METHOD__,
			[ 'LIMIT' => self::USER_SUBSCRIPTION_LIMIT ]
		);

		if ( $rowCount >= self::USER_SUBSCRIPTION_LIMIT / 2 ) {
			$logger->warning(
				"User {user} has {rowCount} subscriptions, approaching the limit",
				[
					'user' => $user->getId(),
					'rowCount' => $rowCount,
				]
			);
		}

		return $rowCount >= self::USER_SUBSCRIPTION_LIMIT;
	}

	/**
	 * @param UserIdentity $user
	 * @param LinkTarget $target
	 * @param string $itemName
	 * @return bool
	 */
	public function addSubscriptionForUser(
		UserIdentity $user,
		LinkTarget $target,
		string $itemName
	) : bool {
		if ( $this->readOnlyMode->isReadOnly() ) {
			return false;
		}
		// Only a registered user can subscribe
		if ( !$user->isRegistered() ) {
			return false;
		}
		if ( $this->userExceedsSubscriptionLimit( $user ) ) {
			return false;
		}
		$dbw = $this->getConnectionRef( DB_PRIMARY );
		$dbw->upsert(
			'discussiontools_subscription',
			[
				'sub_user' => $user->getId(),
				'sub_namespace' => $target->getNamespace(),
				'sub_title' => $target->getDBkey(),
				'sub_section' => $target->getFragment(),
				'sub_item' => $itemName,
				'sub_state' => 1,
				'sub_created' => $dbw->timestamp(),
			],
			[ [ 'sub_user', 'sub_item' ] ],
			[
				'sub_state' => 1,
			],
			__METHOD__
		);
		return (bool)$dbw->affectedRows();
	}

	/**
	 * @param UserIdentity $user
	 * @param string $itemName
	 * @return bool
	 */
	public function removeSubscriptionForUser(
		UserIdentity $user,
		string $itemName
	) : bool {
		if ( $this->readOnlyMode->isReadOnly() ) {
			return false;
		}
		// Only a registered user can subscribe
		if ( !$user->isRegistered() ) {
			return false;
		}
		$dbw = $this->getConnectionRef( DB_PRIMARY );
		$dbw->update(
			'discussiontools_subscription',
			[ 'sub_state' => 0 ],
			[
				'sub_user' => $user->getId(),
				'sub_item' => $itemName,
			],
			__METHOD__
		);
		return (bool)$dbw->affectedRows();
	}

	/**
	 * @param string $field Timestamp field name
	 * @param UserIdentity|null $user
	 * @param string $itemName
	 * @return bool
	 */
	private function updateSubscriptionTimestamp(
		string $field,
		?UserIdentity $user,
		string $itemName
	) : bool {
		if ( $this->readOnlyMode->isReadOnly() ) {
			return false;
		}
		$dbw = $this->getConnectionRef( DB_PRIMARY );

		$conditions = [
			'sub_item' => $itemName,
		];

		if ( $user ) {
			$conditions[ 'sub_user' ] = $user->getId();
		}

		$dbw->update(
			'discussiontools_subscription',
			[ $field => $dbw->timestamp() ],
			$conditions,
			__METHOD__
		);
		return (bool)$dbw->affectedRows();
	}

	/**
	 * Update the notified timestamp on a subscription
	 *
	 * This field could be used in future to cleanup notifications
	 * that are no longer needed (e.g. because the conversation has
	 * been archived), so should be set for muted notifications too.
	 *
	 * @param UserIdentity|null $user
	 * @param string $itemName
	 * @return bool
	 */
	public function updateSubscriptionNotifiedTimestamp(
		?UserIdentity $user,
		string $itemName
	) : bool {
		return $this->updateSubscriptionTimestamp(
			'sub_notified',
			$user,
			$itemName
		);
	}
}
