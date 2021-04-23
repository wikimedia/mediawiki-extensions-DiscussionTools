<?php

namespace MediaWiki\Extension\DiscussionTools;

use DOMDocument;
use DOMElement;
use Language;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\MediaWikiServices;
use MediaWiki\User\UserIdentity;
use MWExceptionHandler;
use Throwable;
use WebRequest;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;
use Wikimedia\Parsoid\Wt2Html\XMLSerializer;

class CommentFormatter {
	// List of features which, when enabled, cause the comment formatter to run
	public const USE_WITH_FEATURES = [
		HookUtils::REPLYTOOL,
		HookUtils::TOPICSUBSCRIPTION,
	];

	protected const MARKER_COMMENT = '<!-- DiscussionTools addDiscussionTools called -->';
	// Compatibility with old cached content
	protected const REPLY_LINKS_COMMENT = '<!-- DiscussionTools addReplyLinks called -->';

	/**
	 * Get a comment parser object for a DOM element
	 *
	 * This method exists so it can mocked in tests.
	 *
	 * @param DOMElement $container
	 * @return CommentParser
	 */
	protected static function getParser( DOMElement $container ) : CommentParser {
		return CommentParser::newFromGlobalState( $container );
	}

	/**
	 * Add discussion tools to some HTML
	 *
	 * @param string &$text Parser text output
	 */
	public static function addDiscussionTools( string &$text ) : void {
		$start = microtime( true );

		// Never add tools twice.
		// This is required because we try again to add tools to cached content
		// to support query string or cookie enabling
		if ( strpos( $text, static::MARKER_COMMENT ) !== false ) {
			return;
		}
		// Compatibility with old cached content
		if ( strpos( $text, static::REPLY_LINKS_COMMENT ) !== false ) {
			return;
		}

		$text = $text . "\n" . static::MARKER_COMMENT;

		try {
			$newText = static::addDiscussionToolsInternal( $text );
		} catch ( Throwable $e ) {
			// Catch errors, so that they don't cause the entire page to not display.
			// Log it and add the request ID in a comment to make it easier to find in the logs.
			MWExceptionHandler::logException( $e );

			$requestId = htmlspecialchars( WebRequest::getRequestId() );
			$info = "<!-- [$requestId] DiscussionTools could not process this page -->";
			$text .= "\n" . $info;

			return;
		}

		$text = $newText;
		$duration = microtime( true ) - $start;

		$stats = MediaWikiServices::getInstance()->getStatsdDataFactory();
		$stats->timing( 'discussiontools.addReplyLinks', $duration * 1000 );
	}

	/**
	 * Add discussion tools to some HTML
	 *
	 * @param string $html HTML
	 * @return string HTML with discussion tools
	 */
	protected static function addDiscussionToolsInternal( string $html ) : string {
		// The output of this method can end up in the HTTP cache (Varnish). Avoid changing it;
		// and when doing so, ensure that frontend code can handle both the old and new outputs.
		// See controller#init in JS.

		$doc = DOMUtils::parseHTML( $html );
		$doc->preserveWhiteSpace = false;

		$container = $doc->getElementsByTagName( 'body' )->item( 0 );
		if ( !( $container instanceof DOMElement ) ) {
			return $html;
		}

		$parser = static::getParser( $container );
		$threadItems = $parser->getThreadItems();

		foreach ( $threadItems as $threadItem ) {
			// TODO: Consider not attaching JSON data to the DOM.
			// Create a dummy node to attach data to.
			if ( $threadItem instanceof HeadingItem && $threadItem->isPlaceholderHeading() ) {
				$node = $doc->createElement( 'span' );
				$container->insertBefore( $node, $container->firstChild );
				$threadItem->setRange( new ImmutableRange( $node, 0, $node, 0 ) );
			}

			// And start and end markers to range
			$id = $threadItem->getId();
			$range = $threadItem->getRange();
			$startMarker = $doc->createElement( 'span' );
			$startMarker->setAttribute( 'data-mw-comment-start', '' );
			$startMarker->setAttribute( 'id', $id );
			$endMarker = $doc->createElement( 'span' );
			$endMarker->setAttribute( 'data-mw-comment-end', $id );

			// Extend the range if the start or end is inside an element which can't have element children.
			// (There may be other problematic elements... but this seems like a good start.)
			if ( CommentUtils::cantHaveElementChildren( $range->startContainer ) ) {
				$range = $range->setStart(
					$range->startContainer->parentNode,
					CommentUtils::childIndexOf( $range->startContainer )
				);
			}
			if ( CommentUtils::cantHaveElementChildren( $range->endContainer ) ) {
				$range = $range->setEnd(
					$range->endContainer->parentNode,
					CommentUtils::childIndexOf( $range->endContainer ) + 1
				);
			}

			$range->setStart( $range->endContainer, $range->endOffset )->insertNode( $endMarker );
			$range->insertNode( $startMarker );

			$itemData = $threadItem->jsonSerialize();
			$itemJSON = json_encode( $itemData );

			if ( $threadItem instanceof HeadingItem ) {
				$threadItem->getRange()->endContainer->setAttribute( 'data-mw-comment', $itemJSON );
				if ( !$threadItem->isPlaceholderHeading() && $threadItem->getHeadingLevel() === 2 ) {
					$headingNode = CommentUtils::closestElement( $threadItem->getRange()->endContainer, [ 'h2' ] );

					if ( $headingNode ) {
						$existingClass = $headingNode->getAttribute( 'class' );
						$headingNode->setAttribute(
							'class',
							( $existingClass ? $existingClass . ' ' : '' ) . 'ext-discussiontools-section'
						);

						// Replaced in ::postprocessTopicSubscription() as the icon depends on user state
						$subscribe = $doc->createComment( '__DTSUBSCRIBE__' . $threadItem->getName() );

						$headingNode->appendChild( $subscribe );
					}
				}
			} elseif ( $threadItem instanceof CommentItem ) {
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
				$bracketLeft = $bracket->cloneNode( false );
				$bracketLeft->nodeValue = '[';
				$bracketRight = $bracket->cloneNode( false );
				$bracketRight->nodeValue = ']';

				$replyLinkButtons->appendChild( $bracketLeft );
				$replyLinkButtons->appendChild( $replyLink );
				$replyLinkButtons->appendChild( $bracketRight );

				CommentModifier::addReplyLink( $threadItem, $replyLinkButtons );
			}
		}

		$docElement = $doc->getElementsByTagName( 'body' )->item( 0 );
		if ( !( $docElement instanceof DOMElement ) ) {
			return $html;
		}

		// Like DOMCompat::getInnerHTML(), but disable 'smartQuote' for compatibility with
		// ParserOutput::EDITSECTION_REGEX matching 'mw:editsection' tags (T274709)
		return XMLSerializer::serialize( $docElement, [ 'innerXML' => true, 'smartQuote' => false ] )['html'];
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
	) : string {
		$doc = new DOMDocument();

		$matches = [];
		preg_match_all( '/<!--__DTSUBSCRIBE__(.*?)-->/', $text, $matches );
		$itemNames = $matches[1];

		$items = $subscriptionStore->getSubscriptionItemsForUser(
			$user,
			$itemNames
		);
		$itemsByName = [];
		foreach ( $items as $item ) {
			$itemsByName[ $item->getItemName() ] = $item;
		}

		$text = preg_replace_callback(
			'/<!--__DTSUBSCRIBE__(.*?)-->/',
			function ( $matches ) use ( $doc, $itemsByName ) {
				$itemName = $matches[1];
				$isSubscribed = isset( $itemsByName[ $itemName ] ) && !$itemsByName[ $itemName ]->isMuted();
				$subscribe = $doc->createElement( 'span' );
				$subscribe->setAttribute(
					'class',
					'ext-discussiontools-section-subscribe ' .
						( $isSubscribed ? 'oo-ui-icon-unStar oo-ui-image-progressive' : 'oo-ui-icon-star' )
				);
				$subscribe->setAttribute( 'data-mw-comment-name', $itemName );
				return DOMCompat::getOuterHTML( $subscribe );
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
	) {
		$replyText = wfMessage( 'discussiontools-replylink' )->inLanguage( $lang )->escaped();
		$text = str_replace( '<!--__DTREPLY__-->', $replyText, $text );
		return $text;
	}

}
