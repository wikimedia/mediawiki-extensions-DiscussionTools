<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\Config\ConfigException;
use MediaWiki\Context\IContextSource;
use MediaWiki\Exception\MWExceptionHandler;
use MediaWiki\Extension\DiscussionTools\Hooks\HookRunner;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ContentCommentItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ContentHeadingItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ContentThreadItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ThreadItem;
use MediaWiki\Html\Html;
use MediaWiki\Html\HtmlHelper;
use MediaWiki\Language\Language;
use MediaWiki\MediaWikiServices;
use MediaWiki\Parser\ParserOutput;
use MediaWiki\Parser\Sanitizer;
use MediaWiki\Request\WebRequest;
use MediaWiki\Title\Title;
use MediaWiki\User\UserIdentity;
use MediaWiki\Utils\MWTimestamp;
use Throwable;
use Wikimedia\Parsoid\DOM\Document;
use Wikimedia\Parsoid\DOM\Element;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;
use Wikimedia\Parsoid\Wt2Html\XHtmlSerializer;
use Wikimedia\RemexHtml\Serializer\SerializerNode;
use Wikimedia\Timestamp\TimestampException;

class CommentFormatter {
	// List of features which, when enabled, cause the comment formatter to run
	public const USE_WITH_FEATURES = [
		HookUtils::REPLYTOOL,
		HookUtils::TOPICSUBSCRIPTION,
		HookUtils::VISUALENHANCEMENTS
	];

	/**
	 * Get a comment parser object for a DOM element
	 *
	 * This method exists so it can mocked in tests.
	 */
	protected static function getParser(): CommentParser {
		return MediaWikiServices::getInstance()->getService( 'DiscussionTools.CommentParser' );
	}

	protected static function getHookRunner(): HookRunner {
		return new HookRunner( MediaWikiServices::getInstance()->getHookContainer() );
	}

	/**
	 * Add discussion tools to some HTML
	 *
	 * @param string &$text Parser text output (modified by reference)
	 * @param ParserOutput $pout ParserOutput object for metadata, e.g. parser limit report
	 * @param Title $title
	 */
	public static function addDiscussionTools( string &$text, ParserOutput $pout, Title $title ): void {
		$start = microtime( true );
		$requestId = null;

		try {
			$text = static::addDiscussionToolsInternal( $text, $pout, $title );

		} catch ( Throwable $e ) {
			// Catch errors, so that they don't cause the entire page to not display.
			// Log it and report the request ID to make it easier to find in the logs.
			MWExceptionHandler::logException( $e );
			$requestId = WebRequest::getRequestId();
		}

		$duration = microtime( true ) - $start;

		MediaWikiServices::getInstance()->getStatsFactory()
			->getTiming( 'discussiontools_addreplylinks_seconds' )
			->copyToStatsdAt( 'discussiontools.addReplyLinks' )
			->observe( $duration * 1000 );

		// How long this method took, in seconds
		$pout->setLimitReportData(
			// The following messages can be generated upstream
			// * discussiontools-limitreport-timeusage-value
			// * discussiontools-limitreport-timeusage-value-text
			// * discussiontools-limitreport-timeusage-value-html
			'discussiontools-limitreport-timeusage',
			sprintf( '%.3f', $duration )
		);
		if ( $requestId ) {
			// Request ID where errors were logged (only if an error occurred)
			$pout->setLimitReportData(
				'discussiontools-limitreport-errorreqid',
				$requestId
			);
		}
	}

	/**
	 * Check if the heading has attributes that can only be added using HTML syntax.
	 *
	 * In the Parsoid default future, we might prefer checking for stx=html.
	 */
	private static function isHtmlHeading( Element $h ): bool {
		foreach ( $h->attributes as $attr ) {
			// Condition matches core HandleSectionLinks / HandleParsoidSectionLinks::isHtmlHeading
			if (
				!in_array( $attr->name, [ 'id', 'data-object-id', 'about', 'typeof' ], true ) &&
				!Sanitizer::isReservedDataAttribute( $attr->name )
			) {
				return true;
			}
		}
		// FIXME(T100856): stx info probably shouldn't be in data-parsoid
		// FIXME(T394005): onParserOutputPostCacheTransform is called from a
		// ContentTextTransformStage, so data-parsoid isn't available
		//
		// Id is ignored above since it's a special case, make use of metadata
		// to determine if it came from wikitext
		// if ( DOMDataUtils::getDataParsoid( $h )->reusedId ?? false ) {
		// 	return true;
		// }
		return false;
	}

	/**
	 * Add a wrapper, topic container, and subscribe link around a heading element
	 *
	 * @param Element $headingElement Heading element
	 * @param ContentHeadingItem|null $headingItem Heading item
	 * @param array|null &$tocInfo TOC info
	 * @return Element Wrapper element (either found or newly added)
	 */
	protected static function handleHeading(
		Element $headingElement,
		?ContentHeadingItem $headingItem = null,
		?array &$tocInfo = null
	): Element {
		$doc = $headingElement->ownerDocument;
		$wrapperNode = $headingElement->parentNode;
		if ( !(
			$wrapperNode instanceof Element &&
			DOMUtils::hasClass( $wrapperNode, 'mw-heading' )
		) ) {
			// Do not add the wrapper if the heading has attributes generated from wikitext (T353489).
			if ( self::isHtmlHeading( $headingElement ) ) {
				return $headingElement;
			}

			$wrapperNode = $doc->createElement( 'div' );
			$headingElement->parentNode->insertBefore( $wrapperNode, $headingElement );
			$wrapperNode->appendChild( $headingElement );
		}

		if ( !$headingItem ) {
			return $wrapperNode;
		}

		$uneditable = false;
		$wrapperParent = $wrapperNode->parentNode;
		if (
			$wrapperParent instanceof Element &&
			strtolower( $wrapperParent->tagName ) === 'section'
		) {
			// Parsoid
			$uneditable = $wrapperParent->getAttribute( 'data-mw-section-id' ) < 0;
		} else {
			// Legacy parser
			$uneditable = DOMCompat::querySelector( $wrapperNode, 'mw\\:editsection' ) === null;
		}

		$headingItem->setUneditableSection( $uneditable );
		self::addOverflowMenuButton( $headingItem, $doc, $wrapperNode );

		$latestReplyItem = $headingItem->getLatestReply();

		$bar = null;
		if ( $latestReplyItem ) {
			$bar = $doc->createElement( 'div' );
			$bar->setAttribute(
				'class',
				'ext-discussiontools-init-section-bar'
			);
		}

		self::addTopicContainer(
			$wrapperNode, $latestReplyItem, $doc, $headingItem, $bar, $tocInfo
		);

		self::addSubscribeLink(
			$headingItem, $doc, $wrapperNode, $latestReplyItem, $bar
		);

		if ( $latestReplyItem ) {
			// The check for if ( $latestReplyItem ) prevents $bar from being null
			// @phan-suppress-next-line PhanTypeMismatchArgumentNullable
			$wrapperNode->appendChild( $bar );
		}

		return $wrapperNode;
	}

	/**
	 * Add a topic container around a heading element.
	 *
	 * A topic container is the information displayed when the "Show discusion activity" user
	 * preference is selected. This displays information such as the latest comment time, number
	 * of comments, and number of editors in the discussion.
	 */
	protected static function addTopicContainer(
		Element $wrapperNode,
		?ContentCommentItem $latestReplyItem,
		Document $doc,
		ContentHeadingItem $headingItem,
		?Element $bar,
		array &$tocInfo
	) {
		if ( !DOMCompat::getClassList( $wrapperNode )->contains( 'mw-heading' ) ) {
			DOMCompat::getClassList( $wrapperNode )->add( 'mw-heading' );
			DOMCompat::getClassList( $wrapperNode )->add( 'mw-heading2' );
		}
		DOMCompat::getClassList( $wrapperNode )->add( 'ext-discussiontools-init-section' );

		if ( !$latestReplyItem ) {
			return;
		}

		$latestReplyJSON = json_encode( static::getJsonArrayForCommentMarker( $latestReplyItem ) );
		// Timestamp output varies by user timezone, so is formatted later
		$latestReply = $doc->createElement( 'mw:dt-latestcommentthread' );
		$latestReply->setAttribute( 'data', $latestReplyJSON );

		$commentCount = $doc->createElement( 'mw:dt-commentcount' );
		$commentCount->setAttribute( 'data', (string)$headingItem->getCommentCount() );

		$authorCount = $doc->createElement( 'mw:dt-authorcount' );
		$authorCount->setAttribute( 'data', (string)count( $headingItem->getAuthorsBelow() ) );

		$metadata = $doc->createElement( 'div' );
		$metadata->setAttribute(
			'class',
			'ext-discussiontools-init-section-metadata'
		);
		$metadata->appendChild( $latestReply );
		$metadata->appendChild( $commentCount );
		$metadata->appendChild( $authorCount );
		$bar->appendChild( $metadata );

		$tocInfo[ $headingItem->getLinkableTitle() ] = [
			'commentCount' => $headingItem->getCommentCount(),
		];
	}

	/**
	 * Add a subscribe/unsubscribe link to the right of a heading element
	 */
	protected static function addSubscribeLink(
		ContentHeadingItem $headingItem,
		Document $doc,
		Element $wrapperNode,
		?ContentCommentItem $latestReplyItem,
		?Element $bar
	) {
		$headingJSON = json_encode( static::getJsonForHeadingMarker( $headingItem ) );

		// Replaced in ::postprocessTopicSubscription() as the text depends on user state
		if ( $headingItem->isSubscribable() ) {
			$subscribeButton = $doc->createElement( 'mw:dt-subscribebutton' );
			$subscribeButton->setAttribute( 'data', $headingJSON );
			$wrapperNode->insertBefore( $subscribeButton, $wrapperNode->firstChild );
		}

		if ( !$latestReplyItem ) {
			return;
		}

		$actions = $doc->createElement( 'div' );
		$actions->setAttribute(
			'class',
			'ext-discussiontools-init-section-actions'
		);
		if ( $headingItem->isSubscribable() ) {
			$subscribeButton = $doc->createElement( 'mw:dt-subscribebutton' );
			$subscribeButton->setAttribute( 'mobile', '' );
			$subscribeButton->setAttribute( 'data', $headingJSON );
			$actions->appendChild( $subscribeButton );
		}
		$bar->appendChild( $actions );
	}

	/**
	 * Add discussion tools to some HTML
	 *
	 * @param string $html HTML
	 * @param ParserOutput $pout
	 * @param Title $title
	 * @return string HTML with discussion tools
	 */
	protected static function addDiscussionToolsInternal( string $html, ParserOutput $pout, Title $title ): string {
		// The output of this method can end up in the HTTP cache (Varnish). Avoid changing it;
		// and when doing so, ensure that frontend code can handle both the old and new outputs.
		// See controller#init in JS.

		$doc = DOMUtils::parseHTML( $html );
		$container = DOMCompat::getBody( $doc );

		$threadItemSet = static::getParser()->parse( $container, $title->getTitleValue() );
		$threadItems = $threadItemSet->getThreadItems();

		$tocInfo = [];

		$newestComment = null;
		$newestCommentData = null;

		$url = $title->getCanonicalURL();
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'discussiontools' );
		$enablePermalinksFrontend = $dtConfig->get( 'DiscussionToolsEnablePermalinksFrontend' );

		// Iterate in reverse order, because adding the range markers for a thread item
		// can invalidate the ranges of subsequent thread items (T298096)
		foreach ( array_reverse( $threadItems ) as $threadItem ) {
			// Create a dummy node to attach data to.
			if ( $threadItem instanceof ContentHeadingItem && $threadItem->isPlaceholderHeading() ) {
				$node = $doc->createElement( 'span' );
				$container->insertBefore( $node, $container->firstChild );
				$threadItem->setRange( new ImmutableRange( $node, 0, $node, 0 ) );
			}

			// Add start and end markers to range
			$id = $threadItem->getId();
			$range = $threadItem->getRange();
			$startMarker = $doc->createElement( 'span' );
			$startMarker->setAttribute( 'data-mw-comment-start', '' );
			$startMarker->setAttribute( 'id', $id );
			$endMarker = $doc->createElement( 'span' );
			$endMarker->setAttribute( 'data-mw-comment-end', $id );

			// Extend the range if the start or end is inside an element which can't have element children.
			// (There may be other problematic elements... but this seems like a good start.)
			while ( CommentUtils::cantHaveElementChildren( $range->startContainer ) ) {
				$range = $range->setStart(
					$range->startContainer->parentNode,
					CommentUtils::childIndexOf( $range->startContainer )
				);
			}
			while ( CommentUtils::cantHaveElementChildren( $range->endContainer ) ) {
				$range = $range->setEnd(
					$range->endContainer->parentNode,
					CommentUtils::childIndexOf( $range->endContainer ) + 1
				);
			}

			$range->setStart( $range->endContainer, $range->endOffset )->insertNode( $endMarker );
			// Start marker is added after reply link to keep reverse DOM order

			if ( $threadItem instanceof ContentHeadingItem ) {
				$headline = $threadItem->getHeadlineNode();
				$headline->setAttribute( 'data-mw-thread-id', $threadItem->getId() );
				if ( $threadItem->getHeadingLevel() === 2 ) {
					// Hack for tests (T363031), $headline should already be a <h2>
					$headingElement = CommentUtils::closestElement( $headline, [ 'h2' ] );

					if ( $headingElement ) {
						static::handleHeading( $headingElement, $threadItem, $tocInfo );
					}
				}
			} elseif ( $threadItem instanceof ContentCommentItem ) {
				$replyButtons = $doc->createElement( 'span' );
				$replyButtons->setAttribute( 'class', 'ext-discussiontools-init-replylink-buttons' );
				$replyButtons->setAttribute( 'data-mw-thread-id', $threadItem->getId() );
				$replyButtons->appendChild( $doc->createElement( 'mw:dt-replybuttonscontent' ) );

				if ( !$newestComment || $threadItem->getTimestamp() > $newestComment->getTimestamp() ) {
					$newestComment = $threadItem;
					// Needs to calculated before DOM modifications change ranges
					$newestCommentData = static::getJsonArrayForCommentMarker( $threadItem, true );
				}

				CommentModifier::addReplyLink( $threadItem, $replyButtons );

				if ( $enablePermalinksFrontend ) {
					$timestampRanges = $threadItem->getTimestampRanges();
					$lastTimestamp = end( $timestampRanges );
					$existingLink = CommentUtils::closestElement( $lastTimestamp->startContainer, [ 'a' ] ) ??
						CommentUtils::closestElement( $lastTimestamp->endContainer, [ 'a' ] );

					if ( !$existingLink ) {
						$link = $doc->createElement( 'mw:dt-timestamplink' );
						$link->setAttribute( 'href', $url . '#' . Sanitizer::escapeIdForLink( $threadItem->getId() ) );
						$link->setAttribute( 'class', 'ext-discussiontools-init-timestamplink' );
						$link->setAttribute( 'title', $threadItem->getTimestampString() );
						$lastTimestamp->surroundContents( $link );
					}
				}
				self::addOverflowMenuButton( $threadItem, $doc, $replyButtons );

				$sigMarker = $doc->createElement( 'span' );
				$sigMarker->setAttribute( 'data-mw-comment-sig', $id );
				$signatureRanges = $threadItem->getSignatureRanges();
				$lastSignature = end( $signatureRanges );
				$lastSignature->insertNode( $sigMarker );
			}

			$range->insertNode( $startMarker );
		}

		$pout->setExtensionData( 'DiscussionTools-tocInfo', $tocInfo );

		if ( $newestCommentData ) {
			$pout->setExtensionData( 'DiscussionTools-newestComment', $newestCommentData );
		}

		$startOfSections = DOMCompat::querySelector( $container, 'meta[property="mw:PageProp/toc"]' );

		// Enhance other <h2>'s which aren't part of a thread
		$headings = DOMCompat::querySelectorAll( $container, 'h2' );
		foreach ( $headings as $headingElement ) {
			$wrapper = $headingElement->parentNode;
			if ( $wrapper instanceof Element && DOMUtils::hasClass( $wrapper, 'toctitle' ) ) {
				continue;
			}
			$headingElement = static::handleHeading( $headingElement );
			if ( !$startOfSections ) {
				$startOfSections = $headingElement;
			}
		}

		if (
			// Page has no headings but some content
			( !$startOfSections && $container->childNodes->length ) ||
			// Page has content before the first heading / TOC
			( $startOfSections && $startOfSections->previousSibling !== null )
		) {
			$pout->setExtensionData( 'DiscussionTools-hasLedeContent', true );
		}
		if (
			// Placeholder heading indicates that there are comments in the lede section (T324139).
			// We can't really separate them from the lede content.
			isset( $threadItems[0] ) &&
			$threadItems[0] instanceof ContentHeadingItem &&
			$threadItems[0]->isPlaceholderHeading()
		) {
			$pout->setExtensionData( 'DiscussionTools-hasCommentsInLedeContent', true );
			MediaWikiServices::getInstance()->getTrackingCategories()
				// The following messages are generated upstream:
				// * discussiontools-comments-before-first-heading-category-desc
				->addTrackingCategory( $pout, 'discussiontools-comments-before-first-heading-category', $title );
		}

		// FIXME: Similar to `setJsConfigVar` below, this will eventually throw
		// from Parsoid's calls to the legacy parser for extension content parsing
		$pout->setExtensionData(
			'DiscussionTools-isEmptyTalkPage',
			count( $threadItems ) === 0
		);

		$threadsJSON = array_map( static function ( ContentThreadItem $item ) {
			return $item->jsonSerialize( true );
		}, $threadItemSet->getThreadsStructured() );

		// Temporary hack to deal with T351461#9358034: this should be a
		// call to `setJsConfigVar` but Parsoid is currently reprocessing
		// content from extensions. (T372592)
		// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged
		@$pout->addJsConfigVars( 'wgDiscussionToolsPageThreads', $threadsJSON );

		// Like DOMCompat::getInnerHTML(), but disable 'smartQuote' for compatibility with
		// ParserOutput::EDITSECTION_REGEX matching 'mw:editsection' tags (T274709)
		$html = XHtmlSerializer::serialize( $container, [ 'innerXML' => true, 'smartQuote' => false ] )['html'];

		return $html;
	}

	/**
	 * Add an overflow menu button to an element.
	 *
	 * @param ThreadItem $threadItem The heading or comment item
	 * @param Document $document Retrieved by parsing page HTML
	 * @param Element $element The element to add the overflow menu button to
	 * @return void
	 */
	protected static function addOverflowMenuButton(
		ThreadItem $threadItem, Document $document, Element $element
	): void {
		$overflowMenuDataJSON = json_encode( [ 'threadItem' => $threadItem ] );

		$overflowMenuButton = $document->createElement( 'mw:dt-ellipsisbutton' );
		$overflowMenuButton->setAttribute( 'data', $overflowMenuDataJSON );
		$element->appendChild( $overflowMenuButton );
	}

	/**
	 * Replace placeholders for all interactive tools with nothing. This is intended for cases where
	 * interaction is unexpected, e.g. reply links while previewing an edit.
	 */
	public static function removeInteractiveTools( BatchModifyElements &$batchModifyElements ): void {
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => in_array( $node->name, [
				'mw:dt-replybuttonscontent',
				'mw:dt-ellipsisbutton',
				'mw:dt-subscribebutton',
			] ),
			static fn () => ''
		);
	}

	/**
	 * Replace placeholders for topic subscription buttons with the real thing.
	 */
	public static function postprocessTopicSubscription(
		string $text, BatchModifyElements &$batchModifyElements, IContextSource $contextSource,
		SubscriptionStore $subscriptionStore, bool $isMobile, bool $useButtons
	): void {
		$doc = DOMCompat::newDocument( true );

		$itemDataByName = [];
		HtmlHelper::modifyElements(
			$text,
			static function ( SerializerNode $node ) use ( &$itemDataByName ): bool {
				if ( $node->name === 'mw:dt-subscribebutton' ) {
					$data = $node->attrs['data'];
					$itemDataByName[ $data ] = json_decode( $data, true );
				}
				// This is non-replacing - we are just using this as
				// a convenient way to traverse the DOM tree.
				return false;
			},
			static fn ( $n ) => $n
		);

		$itemNames = array_column( $itemDataByName, 'name' );

		$user = $contextSource->getUser();
		$items = $subscriptionStore->getSubscriptionItemsForUser(
			$user,
			$itemNames
		);
		$itemsByName = [];
		foreach ( $items as $item ) {
			$itemsByName[ $item->getItemName() ] = $item;
		}

		$lang = $contextSource->getLanguage();
		$title = $contextSource->getTitle();
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-subscribebutton',
			static function ( SerializerNode $node ) use (
				$doc, $itemsByName, $itemDataByName, $lang, $title, $isMobile, $useButtons
			) {
				$buttonIsMobile = $node->attrs->offsetExists( 'mobile' );
				$itemData = $itemDataByName[ $node->attrs['data'] ];
				'@phan-var array $itemData';
				$itemName = $itemData['name'];

				$isSubscribed = isset( $itemsByName[ $itemName ] ) && !$itemsByName[ $itemName ]->isMuted();
				$subscribedState = isset( $itemsByName[ $itemName ] ) ? $itemsByName[ $itemName ]->getState() : null;

				$href = $title->getLinkURL( [
					'action' => $isSubscribed ? 'dtunsubscribe' : 'dtsubscribe',
					'commentname' => $itemName,
					'section' => $isSubscribed ? null : $itemData['linkableTitle'],
				] );

				if ( $buttonIsMobile !== $isMobile ) {
					return '';
				}

				if ( !$useButtons ) {
					$subscribe = $doc->createElement( 'span' );
					$subscribe->setAttribute(
						'class',
						'ext-discussiontools-init-section-subscribe mw-editsection-like'
					);

					$subscribeLink = $doc->createElement( 'a' );
					$subscribeLink->setAttribute( 'href', $href );
					$subscribeLink->setAttribute( 'class', 'ext-discussiontools-init-section-subscribe-link' );
					$subscribeLink->setAttribute( 'role', 'button' );
					$subscribeLink->setAttribute( 'tabindex', '0' );
					$subscribeLink->setAttribute( 'title', wfMessage(
						$isSubscribed ?
							'discussiontools-topicsubscription-button-unsubscribe-tooltip' :
							'discussiontools-topicsubscription-button-subscribe-tooltip'
					)->inLanguage( $lang )->text() );
					$subscribeLink->nodeValue = wfMessage(
						$isSubscribed ?
							'discussiontools-topicsubscription-button-unsubscribe' :
							'discussiontools-topicsubscription-button-subscribe'
					)->inLanguage( $lang )->text();

					if ( $subscribedState !== null ) {
						$subscribeLink->setAttribute( 'data-mw-subscribed', (string)$subscribedState );
					}

					$bracket = $doc->createElement( 'span' );
					$bracket->setAttribute( 'class', 'ext-discussiontools-init-section-subscribe-bracket' );
					$bracketOpen = $bracket->cloneNode( false );
					$bracketOpen->nodeValue = '[';
					$bracketClose = $bracket->cloneNode( false );
					$bracketClose->nodeValue = ']';

					$subscribe->appendChild( $bracketOpen );
					$subscribe->appendChild( $subscribeLink );
					$subscribe->appendChild( $bracketClose );

					return DOMCompat::getOuterHTML( $subscribe );
				} else {
					$subscribe = new \OOUI\ButtonWidget( [
						'classes' => [ 'ext-discussiontools-init-section-subscribeButton' ],
						'framed' => false,
						'icon' => $isSubscribed ? 'bell' : 'bellOutline',
						'flags' => [ 'progressive' ],
						'href' => $href,
						'label' => wfMessage( $isSubscribed ?
							'discussiontools-topicsubscription-button-unsubscribe-label' :
							'discussiontools-topicsubscription-button-subscribe-label'
						)->inLanguage( $lang )->text(),
						'title' => wfMessage( $isSubscribed ?
							'discussiontools-topicsubscription-button-unsubscribe-tooltip' :
							'discussiontools-topicsubscription-button-subscribe-tooltip'
						)->inLanguage( $lang )->text(),
						'infusable' => true,
					] );

					if ( $subscribedState !== null ) {
						$subscribe->setAttributes( [ 'data-mw-subscribed' => (string)$subscribedState ] );
					}

					return $subscribe->toString();
				}
			}
		);
	}

	/**
	 * Remove placeholders for topic subscription buttons (e.g. if the feature is disabled)
	 */
	public static function removeTopicSubscription( BatchModifyElements &$batchModifyElements ): void {
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-subscribebutton',
			static fn () => ''
		);
	}

	/**
	 * Replace placeholders for reply links with the real thing.
	 */
	public static function postprocessReplyTool(
		string $text, BatchModifyElements &$batchModifyElements,
		IContextSource $contextSource, bool $isMobile, bool $useButtons
	): void {
		$doc = DOMCompat::newDocument( true );

		$lang = $contextSource->getLanguage();
		$replyLinkText = wfMessage( 'discussiontools-replylink' )->inLanguage( $lang )->escaped();
		$replyButtonText = wfMessage( 'discussiontools-replybutton' )->inLanguage( $lang )->escaped();

		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-replybuttonscontent',
			static function ( SerializerNode $node ) use(
				$doc, $replyLinkText, $replyButtonText, $isMobile, $useButtons, $lang
			) {
				$replyLinkButtons = $doc->createElement( 'span' );

				if ( $useButtons ) {
					// Visual enhancements button
					$useIcon = $isMobile || static::isLanguageRequiringReplyIcon( $lang );
					$replyLinkButton = new \OOUI\ButtonWidget( [
						'classes' => [ 'ext-discussiontools-init-replybutton' ],
						'framed' => false,
						'label' => $replyButtonText,
						'icon' => $useIcon ? 'share' : null,
						'flags' => [ 'progressive' ],
						'infusable' => true,
					] );

					DOMCompat::setInnerHTML( $replyLinkButtons, $replyLinkButton->toString() );
				} else {
					// Reply link
					$replyLink = $doc->createElement( 'a' );
					$replyLink->setAttribute( 'class', 'ext-discussiontools-init-replylink-reply' );
					$replyLink->setAttribute( 'role', 'button' );
					$replyLink->setAttribute( 'tabindex', '0' );
					// Set empty 'href' to avoid a:not([href]) selector in MobileFrontend
					$replyLink->setAttribute( 'href', '' );
					$replyLink->textContent = $replyLinkText;

					$bracket = $doc->createElement( 'span' );
					$bracket->setAttribute( 'class', 'ext-discussiontools-init-replylink-bracket' );
					$bracketOpen = $bracket->cloneNode( false );
					$bracketClose = $bracket->cloneNode( false );
					$bracketOpen->textContent = '[';
					$bracketClose->textContent = ']';

					$replyLinkButtons->appendChild( $bracketOpen );
					$replyLinkButtons->appendChild( $replyLink );
					$replyLinkButtons->appendChild( $bracketClose );
				}

				return DOMCompat::getInnerHTML( $replyLinkButtons );
			}
		);
	}

	/**
	 * Remove placeholders for reply links (e.g. if the feature is disabled)
	 */
	public static function removeReplyTool( BatchModifyElements &$batchModifyElements ): void {
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-replybuttonscontent',
			static fn () => ''
		);
	}

	/**
	 * Replace placeholders for timestamp links.
	 */
	public static function postprocessTimestampLinks(
		string $text, BatchModifyElements &$batchModifyElements, IContextSource $contextSource
	): void {
		$lang = $contextSource->getLanguage();
		$user = $contextSource->getUser();

		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-timestamplink',
			static function ( SerializerNode $node ) use ( $lang, $user ): SerializerNode {
				$node->name = 'a';
				$relativeTime = static::getSignatureRelativeTime(
					new MWTimestamp( $node->attrs['title'] ),
					$lang,
					$user
				);
				$node->attrs['title'] = $relativeTime;
				return $node;
			}
		);
	}

	/**
	 * Create a meta item label
	 *
	 * @param string $className
	 * @param string|\OOUI\HtmlSnippet $label Label
	 * @return \OOUI\Tag
	 */
	private static function metaLabel( string $className, $label ): \OOUI\Tag {
		return ( new \OOUI\Tag( 'span' ) )
			->addClasses( [ 'ext-discussiontools-init-section-metaitem', $className ] )
			->appendContent( $label );
	}

	/**
	 * Get JSON data for a commentItem that can be inserted into a comment marker
	 *
	 * @param ContentCommentItem $commentItem Comment item
	 * @param bool $includeTopicAndAuthor Include metadata about topic and author
	 * @return array
	 */
	private static function getJsonArrayForCommentMarker(
		ContentCommentItem $commentItem,
		bool $includeTopicAndAuthor = false
	): array {
		$JSON = [
			'id' => $commentItem->getId(),
			'timestamp' => $commentItem->getTimestampString()
		];
		if ( $includeTopicAndAuthor ) {
			$JSON['author'] = $commentItem->getAuthor();
			$heading = $commentItem->getSubscribableHeading();
			if ( $heading ) {
				$JSON['heading'] = static::getJsonForHeadingMarker( $heading );
			}
		}
		return $JSON;
	}

	private static function getJsonForHeadingMarker( ContentHeadingItem $heading ): array {
		$JSON = $heading->jsonSerialize();
		$JSON['text'] = $heading->getText();
		$JSON['linkableTitle'] = $heading->getLinkableTitle();
		return $JSON;
	}

	/**
	 * Get a relative timestamp from a signature timestamp.
	 *
	 * Signature timestamps don't have seconds-level accuracy, so any
	 * time difference of less than 120 seconds is treated as being
	 * posted "just now".
	 */
	public static function getSignatureRelativeTime(
		MWTimestamp $timestamp, Language $lang, UserIdentity $user
	): string {
		try {
			$diff = time() - intval( $timestamp->getTimestamp() );
		} catch ( TimestampException ) {
			// Can't happen
			$diff = 0;
		}
		if ( $diff < 120 ) {
			$timestamp = new MWTimestamp();
		}
		return $lang->getHumanTimestamp( $timestamp, null, $user );
	}

	/**
	 * Post-process visual enhancements features (topic containers)
	 */
	public static function postprocessVisualEnhancements(
		string $text, BatchModifyElements &$batchModifyElements,
		IContextSource $contextSource, bool $isMobile
	): void {
		$lang = $contextSource->getLanguage();
		$user = $contextSource->getUser();
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-latestcommentthread',
			static function ( SerializerNode $node ) use ( $lang, $user ) {
				$itemData = json_decode( $node->attrs['data'], true );
				if ( $itemData && $itemData['timestamp'] && $itemData['id'] ) {
					$relativeTime = static::getSignatureRelativeTime(
						new MWTimestamp( $itemData['timestamp'] ),
						$lang,
						$user
					);
					$commentLink = Html::element( 'a', [
						'href' => '#' . Sanitizer::escapeIdForLink( $itemData['id'] )
					], $relativeTime );

					$label = wfMessage( 'discussiontools-topicheader-latestcomment' )
						->rawParams( $commentLink )
						->inLanguage( $lang )->escaped();

					return CommentFormatter::metaLabel(
						'ext-discussiontools-init-section-timestampLabel',
						new \OOUI\HtmlSnippet( $label )
					)->toString();
				}
			}
		);
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-commentcount',
			static function ( SerializerNode $node ) use ( $lang ) {
				$count = $lang->formatNum( $node->attrs['data'] );
				$label = wfMessage(
					'discussiontools-topicheader-commentcount',
					$count
				)->inLanguage( $lang )->text();
				return CommentFormatter::metaLabel(
					'ext-discussiontools-init-section-commentCountLabel',
					$label
				)->toString();
			}
		);
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-authorcount',
			static function ( SerializerNode $node ) use ( $lang ) {
				$count = $lang->formatNum( $node->attrs['data'] );
				$label = wfMessage(
					'discussiontools-topicheader-authorcount',
					$count
				)->inLanguage( $lang )->text();
				return CommentFormatter::metaLabel(
					'ext-discussiontools-init-section-authorCountLabel',
					$label
				)->toString();
			}
		);
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => $node->name === 'mw:dt-ellipsisbutton',
			static function ( SerializerNode $node ) use ( $contextSource, $isMobile ) {
				$overflowMenuData = json_decode( $node->attrs['data'], true );

				'@phan-var array $overflowMenuData';
				$threadItem = $overflowMenuData['threadItem'];
				$threadItemType = $threadItem['type'] ?? null;
				if ( !$isMobile && $threadItemType === 'heading' ) {
					// Displaying the overflow menu next to a topic heading is a bit more
					// complicated on desktop, so leaving it out for now.
					return '';
				}
				$overflowMenuItems = [];
				$resourceLoaderModules = [];

				self::getHookRunner()->onDiscussionToolsAddOverflowMenuItems(
					$overflowMenuItems,
					$resourceLoaderModules,
					$threadItem,
					$contextSource
				);

				if ( $overflowMenuItems ) {
					usort(
						$overflowMenuItems,
						static function ( OverflowMenuItem $itemA, OverflowMenuItem $itemB ): int {
							return $itemB->getWeight() - $itemA->getWeight();
						}
					);

					$overflowButton = new ButtonMenuSelectWidget( [
						'classes' => [
							'ext-discussiontools-init-section-overflowMenuButton'
						],
						'framed' => false,
						'icon' => 'ellipsis',
						'infusable' => true,
						'data' => [
							'itemConfigs' => $overflowMenuItems,
							'resourceLoaderModules' => $resourceLoaderModules
						]
					] );
					return $overflowButton->toString();
				} else {
					return '';
				}
			}
		);
	}

	/**
	 * Remove visual enhancements features (e.g. if the feature is disabled)
	 */
	public static function removeVisualEnhancements( BatchModifyElements &$batchModifyElements ): void {
		$batchModifyElements->add(
			static fn ( SerializerNode $node ): bool => in_array( $node->name, [
				'mw:dt-latestcommentthread',
				'mw:dt-commentcount',
				'mw:dt-authorcount',
				'mw:dt-ellipsisbutton',
			] ),
			static fn () => ''
		);
	}

	/**
	 * Post-process visual enhancements features for page subtitle
	 *
	 * @return string|null HTML for page subtitle, null if nothing to show
	 */
	public static function postprocessVisualEnhancementsSubtitle(
		ParserOutput $pout, IContextSource $contextSource
	): ?string {
		$itemData = $pout->getExtensionData( 'DiscussionTools-newestComment' );
		if ( $itemData && $itemData['timestamp'] && $itemData['id'] ) {
			$lang = $contextSource->getLanguage();
			$user = $contextSource->getUser();
			$relativeTime = static::getSignatureRelativeTime(
				new MWTimestamp( $itemData['timestamp'] ),
				$lang,
				$user
			);
			$commentLink = Html::element( 'a', [
				'href' => '#' . Sanitizer::escapeIdForLink( $itemData['id'] )
			], $relativeTime );

			if ( isset( $itemData['heading'] ) ) {
				$headingLink = Html::element( 'a', [
					'href' => '#' . Sanitizer::escapeIdForLink( $itemData['heading']['linkableTitle'] )
				], $itemData['heading']['text'] );
				$label = wfMessage( 'discussiontools-pageframe-latestcomment' )
					->rawParams( $commentLink )
					->params( $itemData['author'] )
					->rawParams( $headingLink )
					->inLanguage( $lang )->escaped();
			} else {
				$label = wfMessage( 'discussiontools-pageframe-latestcomment-notopic' )
					->rawParams( $commentLink )
					->params( $itemData['author'] )
					->inLanguage( $lang )->escaped();
			}

			return Html::rawElement(
				'div',
				[ 'class' => 'ext-discussiontools-init-pageframe-latestcomment' ],
				$label
			);
		}
		return null;
	}

	/**
	 * Post-process visual enhancements features for table of contents
	 */
	public static function postprocessTableOfContents(
		ParserOutput $pout, IContextSource $contextSource
	): void {
		$tocInfo = $pout->getExtensionData( 'DiscussionTools-tocInfo' );

		if ( $tocInfo && $pout->getTOCData() ) {
			$sections = $pout->getTOCData()->getSections();
			foreach ( $sections as $item ) {
				$key = str_replace( '_', ' ', $item->anchor );
				// Unset if we did not format this section as a topic container
				if ( isset( $tocInfo[$key] ) ) {
					$lang = $contextSource->getLanguage();
					$count = $lang->formatNum( $tocInfo[$key]['commentCount'] );
					$commentCount = wfMessage(
						'discussiontools-topicheader-commentcount',
						$count
					)->inLanguage( $lang )->text();

					$summary = Html::element( 'span', [
						'class' => 'ext-discussiontools-init-sidebar-meta'
					], $commentCount );
				} else {
					$summary = '';
				}

				// This also shows up in API action=parse&prop=sections output.
				$item->setExtensionData( 'DiscussionTools-html-summary', $summary );
			}
		}
	}

	/**
	 * Check if the talk page had no comments or headings.
	 */
	public static function isEmptyTalkPage( ParserOutput $pout ): bool {
		return $pout->getExtensionData( 'DiscussionTools-isEmptyTalkPage' ) === true;
	}

	/**
	 * Check if the talk page has content above the first heading, in the lede section.
	 */
	public static function hasLedeContent( ParserOutput $pout ): bool {
		return $pout->getExtensionData( 'DiscussionTools-hasLedeContent' ) === true;
	}

	/**
	 * Check if the talk page has comments above the first heading, in the lede section.
	 */
	public static function hasCommentsInLedeContent( ParserOutput $pout ): bool {
		return $pout->getExtensionData( 'DiscussionTools-hasCommentsInLedeContent' ) === true;
	}

	/**
	 * Check if the language requires an icon for the reply button
	 *
	 * @param Language $userLang Language
	 * @return bool
	 */
	public static function isLanguageRequiringReplyIcon( Language $userLang ): bool {
		$services = MediaWikiServices::getInstance();

		$dtConfig = $services->getConfigFactory()->makeConfig( 'discussiontools' );
		$languages = $dtConfig->get( 'DiscussionTools_visualenhancements_reply_icon_languages' );

		if ( array_is_list( $languages ) ) {
			// Detect legacy list format
			throw new ConfigException(
				'DiscussionTools_visualenhancements_reply_icon_languages must be an associative array'
			);
		}

		// User language matched exactly and is explicitly set to true or false
		if ( isset( $languages[ $userLang->getCode() ] ) ) {
			return (bool)$languages[ $userLang->getCode() ];
		}

		// Check fallback languages
		$fallbackLanguages = $userLang->getFallbackLanguages();
		foreach ( $fallbackLanguages as $fallbackLanguage ) {
			if ( isset( $languages[ $fallbackLanguage ] ) ) {
				return (bool)$languages[ $fallbackLanguage ];
			}
		}

		// Language not listed, default is to show no icon
		return false;
	}

}
