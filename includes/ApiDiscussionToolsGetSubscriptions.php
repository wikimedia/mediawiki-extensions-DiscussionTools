<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use ConfigFactory;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDiscussionToolsGetSubscriptions extends ApiBase {

	/** @var SubscriptionStore */
	private $subscriptionStore;

	/** @var ConfigFactory */
	private $configFactory;

	/**
	 * @param ApiMain $main
	 * @param string $name
	 * @param SubscriptionStore $subscriptionStore
	 * @param ConfigFactory $configFactory
	 */
	public function __construct(
		ApiMain $main,
		$name,
		SubscriptionStore $subscriptionStore,
		ConfigFactory $configFactory
	) {
		parent::__construct( $main, $name );
		$this->subscriptionStore = $subscriptionStore;
		$this->configFactory = $configFactory;
	}

	/**
	 * @inheritDoc
	 */
	public function execute() {
		$dtConfig = $this->configFactory->makeConfig( 'discussiontools' );
		if ( !$dtConfig->get( 'DiscussionToolsEnableTopicSubscriptionBackend' ) ) {
			$this->dieWithError( [ 'apierror-moduledisabled', $this->getModuleName() ] );
		}

		$user = $this->getUser();
		if ( !$user->isRegistered() ) {
			$this->dieWithError( 'apierror-mustbeloggedin-generic', 'notloggedin' );
		}

		$params = $this->extractRequestParams();
		$itemNames = $params['commentname'];
		$items = $this->subscriptionStore->getSubscriptionItemsForUser(
			$user,
			$itemNames
		);

		// Ensure consistent formatting in JSON and XML formats
		$this->getResult()->addIndexedTagName( 'subscriptions', 'subscription' );
		$this->getResult()->addArrayType( 'subscriptions', 'kvp', 'name' );

		foreach ( $items as $item ) {
			$this->getResult()->addValue( 'subscriptions', $item->getItemName(), $item->getState() );
		}
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'commentname' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_ISMULTI => true,
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
