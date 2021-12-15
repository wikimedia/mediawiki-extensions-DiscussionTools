<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\MediaWikiServices;

return [
	'DiscussionTools.SubscriptionStore' => static function ( MediaWikiServices $services ): SubscriptionStore {
		return new SubscriptionStore(
			$services->getConfigFactory(),
			$services->getDBLoadBalancerFactory(),
			$services->getReadOnlyMode(),
			$services->getUserFactory()
		);
	}
];
