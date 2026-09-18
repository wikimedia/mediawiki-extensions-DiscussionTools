<?php

namespace MediaWiki\Extension\DiscussionTools\Hooks;

use MediaWiki\Context\IContextSource;

/**
 * This is a hook handler interface, see docs/Hooks.md in core.
 * Use the hook name "DiscussionToolsAddSignatureUserInfoMarkup" to register handlers implementing this interface.
 *
 * @stable to implement
 * @ingroup Hooks
 */
interface DiscussionToolsAddSignatureUserInfoMarkupHook {

	/**
	 * Register markup for denoting user information to add before comment signatures
	 * in DiscussionTools.
	 *
	 * This hook is called during post-processing of DiscussionTools comment signatures,
	 * allowing extensions to inject HTML adjacent to each signature. For example, this
	 * can be used to buttons (such as the CheckUser's User Info Card feature) next to
	 * usernames in talk page comments.
	 *
	 * The markup goes inside an empty marker element that DiscussionTools puts immediately
	 * before the signature. It is inserted as it is, without sanitization. Implementations are
	 * responsible for returning well-formed HTML, and for escaping all values that come
	 * from users, such as user names and display names.
	 *
	 * A talk page can contain many threads with many replies. For this reason, this hook is
	 * called for a batch of comments. Implementations should consider batching their database
	 * queries and other processing.
	 *
	 * @param string[] &$markupByItemId HTML to insert before each signature, keyed by thread
	 *   item ID. Implementations should append to the existing value rather than replacing it,
	 *   to allow multiple hooks to add content. Entries for IDs that are not in $threadItemsData
	 *   are ignored.
	 *   Hook callers pre-populate this array with empty strings.
	 * @param array[] $threadItemsData Thread item data for every comment in the content, keyed by
	 *   thread item ID. Each entry has the keys 'id' and 'author'. Both are always non-empty.
	 * @param IContextSource $contextSource Use this to obtain OutputPage, User, Language,
	 *   etc. objects as needed.
	 * @return bool|void True or no return value to continue or false to abort
	 */
	public function onDiscussionToolsAddSignatureUserInfoMarkup(
		array &$markupByItemId,
		array $threadItemsData,
		IContextSource $contextSource
	);
}
