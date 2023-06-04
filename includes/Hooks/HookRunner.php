<?php

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use Config;
use MediaWiki\HookContainer\HookContainer;
use MessageLocalizer;

/**
 * This is a hook runner class, see docs/Hooks.md in core.
 * @internal
 */
class HookRunner implements
	DiscussionToolsTermsOfUseMessagesHook
{
	private HookContainer $hookContainer;

	public function __construct( HookContainer $hookContainer ) {
		$this->hookContainer = $hookContainer;
	}

	/**
	 * @inheritDoc
	 */
	public function onDiscussionToolsTermsOfUseMessages( array &$messages, MessageLocalizer $context, Config $config ) {
		return $this->hookContainer->run(
			'DiscussionToolsTermsOfUseMessages',
			[ &$messages, $context, $config ]
		);
	}
}
