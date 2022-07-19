<?php

namespace MediaWiki\Extension\DiscussionTools;

use Html;
use Language;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ContentCommentItem;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ContentHeadingItem;
use MediaWiki\MediaWikiServices;
use MediaWiki\User\UserIdentity;
use MWExceptionHandler;
use MWTimestamp;
use ParserOutput;
use Throwable;
use Title;
use WebRequest;
use Wikimedia\Assert\Assert;
use Wikimedia\Parsoid\DOM\Element;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;
use Wikimedia\Parsoid\Wt2Html\XMLSerializer;

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
	 *
	 * @return CommentParser
	 */
	protected static function getParser(): CommentParser {
		return MediaWikiServices::getInstance()->getService( 'DiscussionTools.CommentParser' );
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
			$text = static::addDiscussionToolsInternal( $text, $title );
		} catch ( Throwable $e ) {
			// Catch errors, so that they don't cause the entire page to not display.
			// Log it and report the request ID to make it easier to find in the logs.
			MWExceptionHandler::logException( $e );
			$requestId = WebRequest::getRequestId();
		}

		$duration = microtime( true ) - $start;

		$stats = MediaWikiServices::getInstance()->getStatsdDataFactory();
		$stats->timing( 'discussiontools.addReplyLinks', $duration * 1000 );

		// How long this method took, in seconds
		$pout->setLimitReportData(
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
	 * Add a topic container around a heading element
	 *
	 * @param Element $headingElement Heading element
	 * @param ContentHeadingItem|null $headingItem Heading item
	 */
	protected static function addTopicContainer( Element $headingElement, ?ContentHeadingItem $headingItem = null ) {
		$doc = $headingElement->ownerDocument;

		DOMCompat::getClassList( $headingElement )->add( 'ext-discussiontools-init-section' );

		if ( !$headingItem ) {
			return;
		}

		$headingNameEscaped = htmlspecialchars( $headingItem->getName(), ENT_NOQUOTES );

		// Replaced in ::postprocessTopicSubscription() as the text depends on user state
		$subscribe = $doc->createComment( '__DTSUBSCRIBELINK__' . $headingNameEscaped );
		$headingElement->appendChild( $subscribe );

		// TEMPORARY: If enhancements are "unavailable", don't modify the HTML at all
		// so as to avoid polluting the parser cache. Once the HTML output is more stable
		// this can be removed.
		$dtConfig = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'discussiontools' );
		if ( $dtConfig->get( 'DiscussionTools_' . HookUtils::VISUALENHANCEMENTS ) === 'unavailable' ) {
			return;
		}

		// Visual enhancements: topic containers
		$summary = $headingItem->getThreadSummary();
		if ( $summary['commentCount'] ) {
			$latestReplyJSON = static::getJsonForCommentMarker( $summary['latestReply'] );
			$latestReply = $doc->createComment(
				// Timestamp output varies by user timezone, so is formatted later
				'__DTLATESTCOMMENTTHREAD__' . htmlspecialchars( $latestReplyJSON, ENT_NOQUOTES ) . '__'
			);

			$commentCount = $doc->createComment(
				'__DTCOMMENTCOUNT__' . $summary['commentCount'] . '__'
			);

			$authorCount = $doc->createComment(
				'__DTAUTHORCOUNT__' . count( $summary['authors'] ) . '__'
			);

			// Topic subscriptions
			$subscribeButton = $doc->createComment( '__DTSUBSCRIBEBUTTON__' . $headingNameEscaped );
			$ellipsisButton = $doc->createComment( '__DTELLIPSISBUTTON__' );

			$metadata = $doc->createElement( 'div' );
			$metadata->setAttribute(
				'class',
				'ext-discussiontools-init-section-metadata'
			);

			$metadata->appendChild( $latestReply );
			$metadata->appendChild( $commentCount );
			$metadata->appendChild( $authorCount );

			$actions = $doc->createElement( 'div' );
			$actions->setAttribute(
				'class',
				'ext-discussiontools-init-section-actions'
			);

			$actions->appendChild( $subscribeButton );

			$bar = $doc->createElement( 'div' );
			$bar->setAttribute(
				'class',
				'ext-discussiontools-init-section-bar'
			);

			$bar->appendChild( $metadata );
			$bar->appendChild( $actions );

			$headingElement->appendChild( $ellipsisButton );
			$headingElement->appendChild( $bar );
		}
	}

	/**
	 * Add discussion tools to some HTML
	 *
	 * @param string $html HTML
	 * @param Title $title
	 * @return string HTML with discussion tools
	 */
	protected static function addDiscussionToolsInternal( string $html, Title $title ): string {
		// The output of this method can end up in the HTTP cache (Varnish). Avoid changing it;
		// and when doing so, ensure that frontend code can handle both the old and new outputs.
		// See controller#init in JS.

		$doc = DOMUtils::parseHTML( $html );
		$container = DOMCompat::getBody( $doc );

		$threadItemSet = static::getParser()->parse( $container, $title->getTitleValue() );
		$threadItems = $threadItemSet->getThreadItems();

		// Iterate in reverse order, because adding the range markers for a thread item
		// can invalidate the ranges of subsequent thread items (T298096)
		foreach ( array_reverse( $threadItems ) as $threadItem ) {
			// TODO: Consider not attaching JSON data to the DOM.
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
			$range->insertNode( $startMarker );

			$itemData = $threadItem->jsonSerialize();
			$itemJSON = json_encode( $itemData );

			if ( $threadItem instanceof ContentHeadingItem ) {
				// <span class="mw-headline" …>, or <hN …> in Parsoid HTML
				$headline = $threadItem->getRange()->endContainer;
				Assert::precondition( $headline instanceof Element, 'HeadingItem refers to an element node' );
				$headline->setAttribute( 'data-mw-comment', $itemJSON );
				if ( $threadItem->isSubscribable() ) {
					$headingElement = CommentUtils::closestElement( $headline, [ 'h2' ] );

					if ( $headingElement ) {
						static::addTopicContainer( $headingElement, $threadItem );
					}
				}
			} elseif ( $threadItem instanceof ContentCommentItem ) {
				$replyLinkButtons = $doc->createElement( 'span' );
				$replyLinkButtons->setAttribute( 'class', 'ext-discussiontools-init-replylink-buttons' );

				// Reply
				$replyLink = $doc->createElement( 'a' );
				$replyLink->setAttribute( 'class', 'ext-discussiontools-init-replylink-reply' );
				$replyLink->setAttribute( 'role', 'button' );
				$replyLink->setAttribute( 'tabindex', '0' );
				$replyLink->setAttribute( 'data-mw-comment', $itemJSON );
				// Set empty 'href' to avoid a:not([href]) selector in MobileFrontend
				$replyLink->setAttribute( 'href', '' );
				// Replaced in ::postprocessReplyTool() as the label depends on user language
				$replyText = $doc->createComment( '__DTREPLY__' );
				$replyLink->appendChild( $replyText );

				$bracket = $doc->createElement( 'span' );
				$bracket->setAttribute( 'class', 'ext-discussiontools-init-replylink-bracket' );
				$bracketOpen = $bracket->cloneNode( false );
				$bracketClose = $bracket->cloneNode( false );
				// Replaced in ::postprocessReplyTool() to avoid displaying empty brackets in various
				// contexts where parser output is used (API T292345, search T294168, action=render)
				$bracketOpen->appendChild( $doc->createComment( '__DTREPLYBRACKETOPEN__' ) );
				$bracketClose->appendChild( $doc->createComment( '__DTREPLYBRACKETCLOSE__' ) );

				$replyLinkButtons->appendChild( $bracketOpen );
				$replyLinkButtons->appendChild( $replyLink );
				$replyLinkButtons->appendChild( $bracketClose );

				CommentModifier::addReplyLink( $threadItem, $replyLinkButtons );
			}
		}

		// Enhance other <h2>'s which aren't part of a thread
		$headings = DOMCompat::querySelectorAll( $container, 'h2' );
		foreach ( $headings as $headingElement ) {
			static::addTopicContainer( $headingElement );
		}

		if ( count( $threadItems ) === 0 ) {
			$container->appendChild( $doc->createComment( '__DTEMPTYTALKPAGE__' ) );
		}

		// Like DOMCompat::getInnerHTML(), but disable 'smartQuote' for compatibility with
		// ParserOutput::EDITSECTION_REGEX matching 'mw:editsection' tags (T274709)
		return XMLSerializer::serialize( $container, [ 'innerXML' => true, 'smartQuote' => false ] )['html'];
	}

	/**
	 * Replace placeholders for all interactive tools with nothing. This is intended for cases where
	 * interaction is unexpected, e.g. reply links while previewing an edit.
	 *
	 * @param string $text
	 * @return string
	 */
	public static function removeInteractiveTools( string $text ) {
		$text = strtr( $text, [
			'<!--__DTREPLY__-->' => '',
			'<!--__DTREPLYBRACKETOPEN__-->' => '',
			'<!--__DTREPLYBRACKETCLOSE__-->' => '',
			'<!--__DTELLIPSISBUTTON__-->' => '',
			'<!--__DTEMPTYTALKPAGE__-->' => '',
		] );

		$text = preg_replace( '/<!--__DTSUBSCRIBE__(.*?)-->/', '', $text );
		$text = preg_replace( '/<!--__DTSUBSCRIBELINK__(.*?)-->/', '', $text );
		$text = preg_replace( '/<!--__DTSUBSCRIBEBUTTON__(.*?)-->/', '', $text );

		return $text;
	}

	/**
	 * Replace placeholders for topic subscription buttons with the real thing.
	 *
	 * @param string $text
	 * @param Language $lang
	 * @param SubscriptionStore $subscriptionStore
	 * @param UserIdentity $user
	 * @return string
	 */
	public static function postprocessTopicSubscription(
		string $text, Language $lang, SubscriptionStore $subscriptionStore, UserIdentity $user
	): string {
		$doc = DOMCompat::newDocument( true );

		$matches = [];
		preg_match_all( '/<!--__DTSUBSCRIBE(LINK)?__(.*?)-->/', $text, $matches );
		$itemNames = array_map(
			static function ( string $itemName, string $link ): string {
				return $link ? htmlspecialchars_decode( $itemName ) : $itemName;
			},
			$matches[2], $matches[1]
		);

		// TODO: Remove (LINK)? from regex once parser cache has expired (a few weeks):
		// preg_match_all( '/<!--__DTSUBSCRIBELINK__(.*?)-->/', $text, $matches );
		// $itemNames = array_map(
		// 	static function ( string $itemName ): string {
		// 		return htmlspecialchars_decode( $itemName );
		// 	},
		// 	$matches[1]
		// );

		$items = $subscriptionStore->getSubscriptionItemsForUser(
			$user,
			$itemNames
		);
		$itemsByName = [];
		foreach ( $items as $item ) {
			$itemsByName[ $item->getItemName() ] = $item;
		}

		$text = preg_replace_callback(
			'/<!--__DTSUBSCRIBE(LINK)?__(.*?)-->/',
			static function ( $matches ) use ( $doc, $itemsByName, $lang ) {
				// TODO: Remove (LINK)? from regex
				$itemName = $matches[1] ? htmlspecialchars_decode( $matches[2] ) : $matches[2];
				$isSubscribed = isset( $itemsByName[ $itemName ] ) && !$itemsByName[ $itemName ]->isMuted();
				$subscribedState = isset( $itemsByName[ $itemName ] ) ? $itemsByName[ $itemName ]->getState() : null;

				$subscribe = $doc->createElement( 'span' );
				$subscribe->setAttribute(
					'class',
					'ext-discussiontools-init-section-subscribe mw-editsection-like'
				);

				$subscribeLink = $doc->createElement( 'a' );
				// Set empty 'href' to avoid a:not([href]) selector in MobileFrontend
				$subscribeLink->setAttribute( 'href', '' );
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
			},
			$text
		);

		$text = preg_replace_callback(
			'/<!--__DTSUBSCRIBEBUTTON__(.*?)-->/',
			static function ( $matches ) use ( $doc, $itemsByName, $lang ) {
				$itemName = htmlspecialchars_decode( $matches[1] );
				$isSubscribed = isset( $itemsByName[ $itemName ] ) && !$itemsByName[ $itemName ]->isMuted();
				$subscribedState = isset( $itemsByName[ $itemName ] ) ? $itemsByName[ $itemName ]->getState() : null;

				$subscribe = new \OOUI\ButtonWidget( [
					'classes' => [ 'ext-discussiontools-init-section-subscribeButton' ],
					'framed' => false,
					'icon' => $isSubscribed ? 'bell' : 'bellOutline',
					'flags' => [ 'progressive' ],
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
			},
			$text
		);

		return $text;
	}

	/**
	 * Replace placeholders for reply links with the real thing.
	 *
	 * @param string $text
	 * @param Language $lang
	 * @return string
	 */
	public static function postprocessReplyTool(
		string $text, Language $lang
	): string {
		$replyText = wfMessage( 'discussiontools-replylink' )->inLanguage( $lang )->escaped();

		$text = strtr( $text, [
			 '<!--__DTREPLY__-->' => $replyText,
			 '<!--__DTREPLYBRACKETOPEN__-->' => '[',
			 '<!--__DTREPLYBRACKETCLOSE__-->' => ']',
		] );

		return $text;
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
	 * Get JSON for a commentItem that can be inserted into a comment marker
	 *
	 * @param ContentCommentItem $commentItem Comment item
	 * @return string
	 */
	private static function getJsonForCommentMarker( ContentCommentItem $commentItem ): string {
		$JSON = [
			'id' => $commentItem->getId(),
			'timestamp' => $commentItem->getTimestampString()
		];
		return json_encode( $JSON );
	}

	/**
	 * Get a relative timestamp from a signature timestamp.
	 *
	 * Signature timestamps don't have seconds-level accuracy, so any
	 * time difference of less than 120 seconds is treated as being
	 * posted "just now".
	 *
	 * @param MWTimestamp $timestamp
	 * @param Language $lang
	 * @param UserIdentity $user
	 * @return string
	 */
	public static function getSignatureRelativeTime(
		MWTimestamp $timestamp, Language $lang, UserIdentity $user
	): string {
		if ( time() - intval( $timestamp->getTimestamp() ) < 120 ) {
			$timestamp = new MWTimestamp();
		}
		return $lang->getHumanTimestamp( $timestamp, null, $user );
	}

	/**
	 * Post-process timestamps
	 *
	 * @param string $text
	 * @param Language $lang
	 * @param UserIdentity $user
	 * @return string
	 */
	public static function postprocessVisualEnhancements(
		string $text, Language $lang, UserIdentity $user
	): string {
		$text = preg_replace_callback(
			'/<!--__DTLATESTCOMMENTTHREAD__(.*?)__-->/',
			static function ( $matches ) use ( $lang, $user ) {
				$itemData = json_decode( htmlspecialchars_decode( $matches[1] ), true );
				if ( $itemData && $itemData['timestamp'] && $itemData['id'] ) {
					$relativeTime = static::getSignatureRelativeTime(
						new MWTimestamp( $itemData['timestamp'] ),
						$lang,
						$user
					);
					$commentLink = Html::element( 'a', [
						'href' => '#' . $itemData['id']
					], $relativeTime );

					$label = wfMessage( 'discussiontools-topicheader-latestcomment' )
						->rawParams( $commentLink )
						->inLanguage( $lang )->escaped();

					return CommentFormatter::metaLabel(
						'ext-discussiontools-init-section-timestampLabel',
						new \OOUI\HtmlSnippet( $label )
					);
				}
			},
			$text
		);
		$text = preg_replace_callback(
			'/<!--__DTCOMMENTCOUNT__([0-9]+)__-->/',
			static function ( $matches ) use ( $lang, $user ) {
				$count = $lang->formatNum( $matches[1] );
				$label = wfMessage(
					'discussiontools-topicheader-commentcount',
					$count
				)->inLanguage( $lang )->text();
				return CommentFormatter::metaLabel(
					'ext-discussiontools-init-section-commentCountLabel',
					$label
				);
			},
			$text
		);
		$text = preg_replace_callback(
			'/<!--__DTAUTHORCOUNT__([0-9]+)__-->/',
			static function ( $matches ) use ( $lang, $user ) {
				$count = $lang->formatNum( $matches[1] );
				$label = wfMessage(
					'discussiontools-topicheader-authorcount',
					$count
				)->inLanguage( $lang )->text();
				return CommentFormatter::metaLabel(
					'ext-discussiontools-init-section-authorCountLabel',
					$label
				);
			},
			$text
		);
		$text = preg_replace_callback(
			'/<!--__DTELLIPSISBUTTON__-->/',
			static function ( $matches ) {
				$ellipsis = new ButtonMenuSelectWidget( [
					'classes' => [ 'ext-discussiontools-init-section-ellipsisButton' ],
					'framed' => false,
					'icon' => 'ellipsis',
					'infusable' => true,
				] );

				return $ellipsis->toString();
			},
			$text
		);
		return $text;
	}

	/**
	 * Check if the talk page had no comments or headings.
	 *
	 * @param string $text
	 * @return bool
	 */
	public static function isEmptyTalkPage( string $text ): bool {
		return strpos( $text, '<!--__DTEMPTYTALKPAGE__-->' ) !== false;
	}

	/**
	 * Append content to an empty talk page
	 *
	 * @param string $text
	 * @param string $content
	 * @return string
	 */
	public static function appendToEmptyTalkPage( string $text, string $content ): string {
		return str_replace( '<!--__DTEMPTYTALKPAGE__-->', $content, $text );
	}

}
