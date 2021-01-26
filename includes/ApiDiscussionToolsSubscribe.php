<?php

namespace MediaWiki\Extension\DiscussionTools;

use ApiBase;
use ApiMain;
use Title;
use User;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDiscussionToolsSubscribe extends ApiBase {

	/** @var SubscriptionStore */
	protected $subscriptionStore;

	/**
	 * @param ApiMain $main
	 * @param string $name
	 * @param SubscriptionStore $subscriptionStore
	 */
	public function __construct( ApiMain $main, $name, SubscriptionStore $subscriptionStore ) {
		parent::__construct( $main, $name );

		$this->subscriptionStore = $subscriptionStore;
	}

	/**
	 * @inheritDoc
	 */
	public function execute() {
		$user = $this->getUser();
		if ( !$user || $user->isAnon() ) {
			// TODO: More specific error message
			$this->dieWithError(
				'apierror-mustbeloggedin-generic', 'notloggedin'
			);
		}
		'@phan-var User $user';

		$params = $this->extractRequestParams();
		$title = Title::newFromText( $params['page'] );
		$result = null;

		if ( !$title ) {
			$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['page'] ) ] );
			return;
		}
		$commentName = $params['commentname'];
		$subscribe = $params['subscribe'];

		if ( $subscribe ) {
			$this->subscriptionStore->addSubscriptionForUser(
				$user,
				$title,
				$commentName
			);
		} else {
			$this->subscriptionStore->removeSubscriptionForUser(
				$user,
				$commentName
			);
		}
		// TODO: Subscribe should be tri-state:
		// * subscribe (add row)
		// * ubsubscribe (delete row)
		// * mute (set state=0)

		$result = [
			'page' => $title,
			'commentname' => $commentName,
			'subscribe' => $subscribe
		];

		$this->getResult()->addValue( null, $this->getModuleName(), $result );
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
			'token' => [
				ParamValidator::PARAM_REQUIRED => true,
			],
			'commentname' => [
				ParamValidator::PARAM_REQUIRED => true,
				ApiBase::PARAM_HELP_MSG => 'apihelp-discussiontoolsedit-param-commentname',
			],
			'subscribe' => [
				ParamValidator::PARAM_TYPE => 'boolean',
				ParamValidator::PARAM_REQUIRED => true,
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
