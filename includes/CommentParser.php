<?php

namespace MediaWiki\Extension\DiscussionTools;

use Config;
use DateInterval;
use DateTime;
use DateTimeImmutable;
use DateTimeZone;
use DOMElement;
use DOMNode;
use DOMText;
use IP;
use Language;
use MediaWiki\MediaWikiServices;
use MWException;
use Title;

// TODO clean up static vs non-static
// TODO consider making timestamp parsing not a returned function

class CommentParser {
	private const SIGNATURE_SCAN_LIMIT = 100;

	/** @var DOMElement */
	private $rootNode;

	/** @var ThreadItem[] */
	private $threadItems;
	/** @var CommentItem[] */
	private $commentItems;
	/** @var ThreadItem[] */
	private $threadItemsById;
	/** @var HeadingItem[] */
	private $threads;

	/** @var Config */
	private $config;

	/** @var Language */
	private $language;

	private $dateFormat;
	private $digits;
	/** @var string[][] */
	private $contLangMessages;
	private $localTimezone;
	private $timezones;

	/**
	 * @param DomElement $rootNode Root node of content to parse
	 * @param Language $language Content language
	 * @param Config $config
	 * @param array $data
	 */
	public function __construct( DOMElement $rootNode, Language $language, Config $config, array $data = [] ) {
		$this->rootNode = $rootNode;
		$this->config = $config;
		$this->language = $language;

		if ( !$data ) {
			// TODO: Instead of passing data used for mocking, mock the methods that fetch the data.
			$data = Data::getLocalData( null, $config, $language );
		}

		$this->dateFormat = $data['dateFormat'];
		$this->digits = $data['digits'];
		$this->contLangMessages = $data['contLangMessages'];
		$this->localTimezone = $data['localTimezone'];
		$this->timezones = $data['timezones'];
	}

	/**
	 * @param DomElement $rootNode
	 * @return CommentParser
	 */
	public static function newFromGlobalState( DOMElement $rootNode ) : CommentParser {
		return new static(
			$rootNode,
			MediaWikiServices::getInstance()->getContentLanguage(),
			MediaWikiServices::getInstance()->getMainConfig()
		);
	}

	/**
	 * Check whether the node is a comment separator (instead of a part of the comment).
	 *
	 * @param DOMNode $node
	 * @return bool
	 */
	private static function isCommentSeparator( DOMNode $node ) {
		return $node instanceof DOMElement && (
			// Empty paragraphs (`<p><br></p>`) between indented comments mess up indentation detection
			strtolower( $node->nodeName ) === 'br' ||
			// Horizontal line
			strtolower( $node->nodeName ) === 'hr' ||
			// {{outdent}} templates
			$node->getAttribute( 'class' ) === 'outdent-template'
		);
	}

	/**
	 * Return the next leaf node in the tree order that is likely a part of a discussion comment,
	 * rather than some boring "separator" element.
	 *
	 * Currently, this can return a Text node with content other than whitespace, or an Element node
	 * that is a "void element" or "text element", except some special cases that we treat as comment
	 * separators (isCommentSeparator()).
	 *
	 * @param DOMNode $node Node to start searching at. This node's children are ignored.
	 * @return DOMNode
	 */
	private function nextInterestingLeafNode( DOMNode $node ) : DOMNode {
		$rootNode = $this->rootNode;
		$treeWalker = new TreeWalker(
			$rootNode,
			NodeFilter::SHOW_ELEMENT | NodeFilter::SHOW_TEXT,
			function ( $n ) use ( $node, $rootNode ) {
				// Ignore this node and its descendants
				// (unless it's the root node, this is a special case for "fakeHeading" handling)
				if ( $node !== $rootNode && ( $n === $node || $n->parentNode === $node ) ) {
					return NodeFilter::FILTER_REJECT;
				}
				// Ignore some elements usually used as separators or headers (and their descendants)
				if ( self::isCommentSeparator( $n ) ) {
					return NodeFilter::FILTER_REJECT;
				}
				// Ignore nodes with no rendering that mess up our indentation detection
				if ( CommentUtils::isRenderingTransparentNode( $n ) ) {
					return NodeFilter::FILTER_REJECT;
				}
				if (
					(
						$n->nodeType === XML_TEXT_NODE &&
						CommentUtils::htmlTrim( $n->nodeValue ) !== ''
					) ||
					(
						$n->nodeType === XML_CDATA_SECTION_NODE &&
						CommentUtils::htmlTrim( $n->nodeValue ) !== ''
					) ||
					(
						CommentUtils::cantHaveElementChildren( $n )
					)
				) {
					return NodeFilter::FILTER_ACCEPT;
				}
				return NodeFilter::FILTER_SKIP;
			}
		);
		$treeWalker->currentNode = $node;
		$treeWalker->nextNode();
		if ( !$treeWalker->currentNode ) {
			throw new MWException( 'nextInterestingLeafNode not found' );
		}
		return $treeWalker->currentNode;
	}

	/**
	 * @param string[] $values Values to match
	 * @return string Regular expression
	 */
	private static function regexpAlternateGroup( array $values ) : string {
		return '(' . implode( '|', array_map( function ( string $x ) {
			return preg_quote( $x, '/' );
		}, $values ) ) . ')';
	}

	/**
	 * Get text of localisation messages in content language.
	 *
	 * @param string $contLangVariant Content language variant
	 * @param string[] $messages Message keys
	 * @return string[] Message values
	 */
	private function getMessages( string $contLangVariant, array $messages ) : array {
		return array_map( function ( string $key ) use ( $contLangVariant ) {
			return $this->contLangMessages[$contLangVariant][$key];
		}, $messages );
	}

	/**
	 * Get a regexp that matches timestamps generated using the given date format.
	 *
	 * This only supports format characters that are used by the default date format in any of
	 * MediaWiki's languages, namely: D, d, F, G, H, i, j, l, M, n, Y, xg, xkY (and escape characters),
	 * and only dates when MediaWiki existed, let's say 2000 onwards (Thai dates before 1941 are
	 * complicated).
	 *
	 * @param string $contLangVariant Content language variant
	 * @param string $format Date format
	 * @param string $digitsRegexp Regular expression matching a single localised digit, e.g. '[0-9]'
	 * @param array $tzAbbrs Associative array mapping localised timezone abbreviations to
	 *   IANA abbreviations, for the local timezone, e.g. [ 'EDT' => 'EDT', 'EST' => 'EST' ]
	 * @return string Regular expression
	 */
	private function getTimestampRegexp(
		string $contLangVariant, string $format, string $digitsRegexp, array $tzAbbrs
	) : string {
		$formatLength = strlen( $format );
		$s = '';
		// Adapted from Language::sprintfDate()
		for ( $p = 0; $p < $formatLength; $p++ ) {
			$num = false;
			$code = $format[ $p ];
			if ( $code === 'x' && $p < $formatLength - 1 ) {
				$code .= $format[++$p];
			}
			if ( $code === 'xk' && $p < $formatLength - 1 ) {
				$code .= $format[++$p];
			}

			switch ( $code ) {
				case 'xx':
					$s .= 'x';
					break;
				case 'xg':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( $contLangVariant, Language::MONTH_GENITIVE_MESSAGES )
					);
					break;
				case 'd':
					$num = '2';
					break;
				case 'D':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( $contLangVariant, Language::WEEKDAY_ABBREVIATED_MESSAGES )
					);
					break;
				case 'j':
					$num = '1,2';
					break;
				case 'l':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( $contLangVariant, Language::WEEKDAY_MESSAGES )
					);
					break;
				case 'F':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( $contLangVariant, Language::MONTH_MESSAGES )
					);
					break;
				case 'M':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( $contLangVariant, Language::MONTH_ABBREVIATED_MESSAGES )
					);
					break;
				case 'n':
					$num = '1,2';
					break;
				case 'Y':
					$num = '4';
					break;
				case 'xkY':
					$num = '4';
					break;
				case 'G':
					$num = '1,2';
					break;
				case 'H':
					$num = '2';
					break;
				case 'i':
					$num = '2';
					break;
				case '\\':
					// Backslash escaping
					if ( $p < $formatLength - 1 ) {
						$s .= preg_quote( $format[++$p], '/' );
					} else {
						$s .= preg_quote( '\\', '/' );
					}
					break;
				case '"':
					// Quoted literal
					if ( $p < $formatLength - 1 ) {
						$endQuote = strpos( $format, '"', $p + 1 );
						if ( $endQuote === false ) {
							// No terminating quote, assume literal "
							$s .= '"';
						} else {
							$s .= preg_quote( substr( $format, $p + 1, $endQuote - $p - 1 ), '/' );
							$p = $endQuote;
						}
					} else {
						// Quote at end of string, assume literal "
						$s .= '"';
					}
					break;
				default:
					$s .= preg_quote( $format[$p], '/' );
			}
			if ( $num !== false ) {
				$s .= '(' . $digitsRegexp . '{' . $num . '})';
			}
		}

		$tzRegexp = self::regexpAlternateGroup( array_keys( $tzAbbrs ) );

		// Hard-coded parentheses and space like in Parser::pstPass2
		// Ignore some invisible Unicode characters that often sneak into copy-pasted timestamps (T245784)
		// \uNNNN syntax can only be used from PHP 7.3
		return '/' . $s . '[\\x{200E}\\x{200F}]? [\\x{200E}\\x{200F}]?\\(' . $tzRegexp . '\\)/u';
	}

	/**
	 * Get a function that parses timestamps generated using the given date format, based on the result
	 * of matching the regexp returned by getTimestampRegexp()
	 *
	 * @param string $contLangVariant Content language variant
	 * @param string $format Date format, as used by MediaWiki
	 * @param string[]|null $digits Localised digits from 0 to 9, e.g. `[ '0', '1', ..., '9' ]`
	 * @param string $localTimezone Local timezone IANA name, e.g. `America/New_York`
	 * @param array $tzAbbrs Map of localised timezone abbreviations to IANA abbreviations
	 *   for the local timezone, e.g. [ 'EDT' => 'EDT', 'EST' => 'EST' ]
	 * @return callable Parser function
	 */
	private function getTimestampParser(
		string $contLangVariant, string $format, ?array $digits, string $localTimezone, array $tzAbbrs
	) : callable {
		$untransformDigits = function ( string $text ) use ( $digits ) {
			if ( !$digits ) {
				return $text;
			}
			return preg_replace_callback(
				'/[' . implode( '', $digits ) . ']/u',
				function ( array $m ) use ( $digits ) {
					return (string)array_search( $m[0], $digits );
				},
				$text
			);
		};

		$formatLength = strlen( $format );
		$matchingGroups = [];
		for ( $p = 0; $p < $formatLength; $p++ ) {
			$code = $format[$p];
			if ( $code === 'x' && $p < $formatLength - 1 ) {
				$code .= $format[++$p];
			}
			if ( $code === 'xk' && $p < $formatLength - 1 ) {
				$code .= $format[++$p];
			}

			switch ( $code ) {
				case 'xx':
					break;
				case 'xg':
				case 'd':
				case 'j':
				case 'D':
				case 'l':
				case 'F':
				case 'M':
				case 'n':
				case 'Y':
				case 'xkY':
				case 'G':
				case 'H':
				case 'i':
					$matchingGroups[] = $code;
					break;
				case '\\':
					// Backslash escaping
					if ( $p < $formatLength - 1 ) {
						$p++;
					}
					break;
				case '"':
					// Quoted literal
					if ( $p < $formatLength - 1 ) {
						$endQuote = strpos( $format, '"', $p + 1 );
						if ( $endQuote !== false ) {
							$p = $endQuote;
						}
					}
					break;
				default:
					break;
			}
		}

		return function ( array $match ) use (
			$matchingGroups, $untransformDigits, $localTimezone, $tzAbbrs, $contLangVariant
		) {
			if ( is_array( $match[0] ) ) {
				// Strip PREG_OFFSET_CAPTURE data
				unset( $match['offset'] );
				$match = array_map( function ( array $tuple ) {
					return $tuple[0];
				}, $match );
			}
			$year = 0;
			$monthIdx = 0;
			$day = 0;
			$hour = 0;
			$minute = 0;
			foreach ( $matchingGroups as $i => $code ) {
				$text = $match[$i + 1];
				switch ( $code ) {
					case 'xg':
						$monthIdx = array_search(
							$text,
							$this->getMessages( $contLangVariant, Language::MONTH_GENITIVE_MESSAGES )
						);
						break;
					case 'd':
					case 'j':
						$day = intval( $untransformDigits( $text ) );
						break;
					case 'D':
					case 'l':
						// Day of the week - unused
						break;
					case 'F':
						$monthIdx = array_search(
							$text,
							$this->getMessages( $contLangVariant, Language::MONTH_MESSAGES )
						);
						break;
					case 'M':
						$monthIdx = array_search(
							$text,
							$this->getMessages( $contLangVariant, Language::MONTH_ABBREVIATED_MESSAGES )
						);
						break;
					case 'n':
						$monthIdx = intval( $untransformDigits( $text ) ) - 1;
						break;
					case 'Y':
						$year = intval( $untransformDigits( $text ) );
						break;
					case 'xkY':
						// Thai year
						$year = intval( $untransformDigits( $text ) ) - 543;
						break;
					case 'G':
					case 'H':
						$hour = intval( $untransformDigits( $text ) );
						break;
					case 'i':
						$minute = intval( $untransformDigits( $text ) );
						break;
					default:
						// TODO throw NotImplementedException or whatever it's called
						throw new MWException( 'Not implemented' );
				}
			}

			// The last matching group is the timezone abbreviation
			$tzAbbr = $tzAbbrs[ end( $match ) ];

			// Most of the time, the timezone abbreviation is not necessary to parse the date, since we
			// can assume all times are in the wiki's local timezone.
			$date = new DateTime();
			// setTimezone must be called before setDate/setTime
			$date->setTimezone( new DateTimeZone( $localTimezone ) );
			$date->setDate( $year, $monthIdx + 1, $day );
			$date->setTime( $hour, $minute, 0 );

			// But during the "fall back" at the end of DST, some times will happen twice.
			// Since the timezone abbreviation disambiguates the DST/non-DST times, we can detect
			// when PHP chose the wrong one, and then try the other one. It appears that PHP always
			// uses the later (non-DST) hour, but that behavior isn't documented, so we account for both.
			if ( $date->format( 'T' ) !== $tzAbbr ) {
				$altDate = clone $date;
				if ( $date->format( 'I' ) ) {
					// Parsed time is DST, try non-DST by advancing one hour
					$altDate->add( new DateInterval( 'PT1H' ) );
				} else {
					// Parsed time is non-DST, try DST by going back one hour
					$altDate->sub( new DateInterval( 'PT1H' ) );
				}
				if ( $altDate->format( 'T' ) === $tzAbbr ) {
					$date = $altDate;
					$discussionToolsWarning = 'Timestamp has timezone abbreviation for the wrong time';
				} else {
					$discussionToolsWarning = 'Ambiguous time at DST switchover was parsed';
				}
			}

			// Now set the timezone back to UTC for formatting
			$date->setTimezone( new DateTimeZone( 'UTC' ) );
			$date = DateTimeImmutable::createFromMutable( $date );
			if ( isset( $discussionToolsWarning ) ) {
				// @phan-suppress-next-line PhanUndeclaredProperty
				$date->discussionToolsWarning = $discussionToolsWarning;
			}

			return $date;
		};
	}

	/**
	 * Get a regexp that matches timestamps in the local date format, for each language variant.
	 *
	 * This calls getTimestampRegexp() with predefined data for the current wiki.
	 *
	 * @return string[] Regular expressions
	 */
	public function getLocalTimestampRegexps() : array {
		$langConv = MediaWikiServices::getInstance()->getLanguageConverterFactory()
			->getLanguageConverter( $this->language );
		return array_map( function ( $contLangVariant ) {
			return $this->getTimestampRegexp(
				$contLangVariant,
				$this->dateFormat[$contLangVariant],
				'[' . implode( '', $this->digits[$contLangVariant] ) . ']',
				$this->timezones[$contLangVariant]
			);
		}, $langConv->getVariants() );
	}

	/**
	 * Get a function that parses timestamps in the local date format, for each language variant,
	 * based on the result of matching the regexp returned by getLocalTimestampRegexp().
	 *
	 * This calls getTimestampParser() with predefined data for the current wiki.
	 *
	 * @return callable[] Parser functions
	 */
	private function getLocalTimestampParsers() : array {
		$langConv = MediaWikiServices::getInstance()->getLanguageConverterFactory()
			->getLanguageConverter( $this->language );
		return array_map( function ( $contLangVariant ) {
			return $this->getTimestampParser(
				$contLangVariant,
				$this->dateFormat[$contLangVariant],
				$this->digits[$contLangVariant],
				$this->localTimezone,
				$this->timezones[$contLangVariant]
			);
		}, $langConv->getVariants() );
	}

	/**
	 * Given a link node (`<a>`), if it's a link to a user-related page, return their username.
	 *
	 * @param DOMElement $link
	 * @return string|null Username, or null
	 */
	private static function getUsernameFromLink( DOMElement $link ) {
		$username = null;
		$title = CommentUtils::getTitleFromUrl( $link->getAttribute( 'href' ) );
		if ( !$title ) {
			return null;
		}
		if ( $title->getNamespace() === NS_USER || $title->getNamespace() === NS_USER_TALK ) {
			$username = $title->getText();
			if ( strpos( $username, '/' ) !== false ) {
				return null;
			}
		} elseif ( $title->isSpecial( 'Contributions' ) ) {
			$parts = explode( '/', $title->getText(), 2 );
			if ( !isset( $parts[1] ) ) {
				return null;
			}
			// Normalize the username: users may link to their contributions with an unnormalized name
			$userpage = Title::makeTitleSafe( NS_USER, $parts[1] );
			if ( !$userpage ) {
				return null;
			}
			$username = $userpage->getText();
		}
		if ( !$username ) {
			return null;
		}
		if ( IP::isIPv6( $username ) ) {
			// Bot-generated links "Preceding unsigned comment added by" have non-standard case
			$username = strtoupper( $username );
		}
		return $username;
	}

	/**
	 * Find a user signature preceding a timestamp.
	 *
	 * The signature includes the timestamp node.
	 *
	 * A signature must contain at least one link to the user's userpage, discussion page or
	 * contributions (and may contain other links). The link may be nested in other elements.
	 *
	 * This function returns a two-element array. The first element is an array of sibling nodes
	 * comprising the signature, in reverse order (with $timestampNode or its parent node as the last
	 * element). The second element is the username (null for unsigned comments).
	 *
	 * @param DOMText $timestampNode
	 * @param DOMNode|null $until Node to stop searching at
	 * @return array [ nodes, username ]
	 */
	private function findSignature( DOMText $timestampNode, ?DOMNode $until = null ) : array {
		$sigUsername = null;
		$length = 0;
		$lastLinkNode = $timestampNode;

		CommentUtils::linearWalkBackwards(
			$timestampNode,
			function ( string $event, DOMNode $node ) use (
				&$sigUsername, &$lastLinkNode, &$length,
				$until, $timestampNode
			) {
				if ( $event === 'enter' && $node === $until ) {
					return true;
				}
				if ( $length >= self::SIGNATURE_SCAN_LIMIT ) {
					return true;
				}
				if ( CommentUtils::isBlockElement( $node ) ) {
					// Don't allow reaching into preceding paragraphs
					return true;
				}

				if ( $event === 'leave' && $node !== $timestampNode ) {
					$length += $node instanceof DOMText ? mb_strlen( $node->textContent ) : 0;
				}

				// Find the closest link before timestamp that links to the user's user page.
				//
				// Support timestamps being linked to the diff introducing the comment:
				// if the timestamp node is the only child of a link node, use the link node instead
				//
				// Handle links nested in formatting elements.
				if ( $event === 'leave' && $node instanceof DOMElement && strtolower( $node->nodeName ) === 'a' ) {
					$username = self::getUsernameFromLink( $node );
					if ( $username ) {
						// Accept the first link to the user namespace, then only accept links to that user
						if ( $sigUsername === null ) {
							$sigUsername = $username;
						}
						if ( $username === $sigUsername ) {
							$lastLinkNode = $node;
						}
					}
					// Keep looking if a node with links wasn't a link to a user page
					// "Doc James (talk · contribs · email)"
				}
			}
		);

		$range = new ImmutableRange(
			$lastLinkNode->parentNode,
			CommentUtils::childIndexOf( $lastLinkNode ),
			$timestampNode->parentNode,
			CommentUtils::childIndexOf( $timestampNode ) + 1
		);

		// Expand the range so that it covers sibling nodes.
		// This will include any wrapping formatting elements as part of the signature.
		//
		// Helpful accidental feature: users whose signature is not detected in full (due to
		// text formatting) can just wrap it in a <span> to fix that.
		// "Ten Pound Hammer • (What did I screw up now?)"
		// "« Saper // dyskusja »"
		//
		// TODO Not sure if this is actually good, might be better to just use the range...
		$sigNodes = array_reverse( CommentUtils::getCoveredSiblings( $range ) );

		return [ $sigNodes, $sigUsername ];
	}

	/**
	 * Callback for TreeWalker that will skip over nodes where we don't want to detect
	 * comments (or section headings).
	 *
	 * @param DOMNode $node
	 * @return int Appropriate NodeFilter constant
	 */
	public static function acceptOnlyNodesAllowingComments( DOMNode $node ) {
		// The table of contents has a heading that gets erroneously detected as a section
		if ( $node instanceof DOMElement && $node->getAttribute( 'id' ) === 'toc' ) {
			return NodeFilter::FILTER_REJECT;
		}
		// Don't detect comments within headings (but don't reject the headings themselves)
		if ( ( $par = $node->parentNode ) instanceof DOMElement && preg_match( '/^h([1-6])$/i', $par->tagName ) ) {
			return NodeFilter::FILTER_REJECT;
		}
		return NodeFilter::FILTER_ACCEPT;
	}

	/**
	 * Find a timestamps in a given text node
	 *
	 * @param DOMText $node
	 * @param string[] $timestampRegexps
	 * @return array|null Array with the following keys:
	 *   - int 'offset' Length of extra text preceding the node that was used for matching
	 *   - int 'parserIndex' Which of the regexps matched
	 *   - array 'matchData' Regexp match data, which specifies the location of the match,
	 *     and which can be parsed using getLocalTimestampParsers()
	 */
	public function findTimestamp( DOMText $node, array $timestampRegexps ) : ?array {
		$nodeText = '';
		$offset = 0;

		while ( $node ) {
			$nodeText = $node->nodeValue . $nodeText;

			// In Parsoid HTML, entities are represented as a 'mw:Entity' node, rather than normal HTML
			// entities. On Arabic Wikipedia, the "UTC" timezone name contains some non-breaking spaces,
			// which apparently are often turned into &nbsp; entities by buggy editing tools. To handle
			// this, we must piece together the text, so that our regexp can match those timestamps.
			if (
				( $previousSibling = $node->previousSibling ) &&
				$previousSibling instanceof DOMElement &&
				$previousSibling->getAttribute( 'typeof' ) === 'mw:Entity'
			) {
				$nodeText = $previousSibling->firstChild->nodeValue . $nodeText;
				$offset += strlen( $previousSibling->firstChild->nodeValue );

				// If the entity is preceded by more text, do this again
				if (
					$previousSibling->previousSibling &&
					$previousSibling->previousSibling instanceof DOMText
				) {
					$offset += strlen( $previousSibling->previousSibling->nodeValue );
					$node = $previousSibling->previousSibling;
				} else {
					$node = null;
				}
			} else {
				$node = null;
			}
		}

		foreach ( $timestampRegexps as $i => $timestampRegexp ) {
			$matchData = null;
			// Allows us to mimic match.index in #getComments
			if ( preg_match( $timestampRegexp, $nodeText, $matchData, PREG_OFFSET_CAPTURE ) ) {
				return [
					'matchData' => $matchData,
					'offset' => $offset,
					'parserIndex' => $i,
				];
			}
		}
		return null;
	}

	/**
	 * Get all discussion comments (and headings) within a DOM subtree.
	 *
	 * This returns a flat list, use getThreads() to get a tree structure starting at section headings.
	 *
	 * For example, for a MediaWiki discussion like this (we're dealing with HTML DOM here,
	 * the wikitext syntax is just for illustration):
	 *
	 *     == A ==
	 *     B. ~~~~
	 *     : C.
	 *     : C. ~~~~
	 *     :: D. ~~~~
	 *     ::: E. ~~~~
	 *     ::: F. ~~~~
	 *     : G. ~~~~
	 *     H. ~~~~
	 *     : I. ~~~~
	 *
	 * This function would return a structure like:
	 *
	 *     [
	 *       HeadingItem( { level: 0, range: (h2: A)        } ),
	 *       CommentItem( { level: 1, range: (p: B)         } ),
	 *       CommentItem( { level: 2, range: (li: C, li: C) } ),
	 *       CommentItem( { level: 3, range: (li: D)        } ),
	 *       CommentItem( { level: 4, range: (li: E)        } ),
	 *       CommentItem( { level: 4, range: (li: F)        } ),
	 *       CommentItem( { level: 2, range: (li: G)        } ),
	 *       CommentItem( { level: 1, range: (p: H)         } ),
	 *       CommentItem( { level: 2, range: (li: I)        } )
	 *     ]
	 *
	 * @return ThreadItem[] Thread items
	 */
	public function getThreadItems() : array {
		if ( !$this->threadItems ) {
			$this->buildThreads();
		}
		return $this->threadItems;
	}

	/**
	 * Same as getFlatThreadItems, but only returns the CommentItems
	 *
	 * @return CommentItem[] Comment items
	 */
	public function getCommentItems() : array {
		if ( !$this->commentItems ) {
			$this->buildThreads();
		}
		return $this->commentItems;
	}

	/**
	 * Find a ThreadItem by its ID
	 *
	 * @param string $id ID
	 * @return ThreadItem|null Thread item, null if not found
	 */
	public function findCommentById( string $id ) : ?ThreadItem {
		if ( !$this->threadItemsById ) {
			$this->buildThreads();
		}
		return $this->threadItemsById[$id] ?? null;
	}

	/**
	 * @param DOMNode[] $sigNodes
	 * @param array $match
	 * @param DOMText $node
	 * @return ImmutableRange
	 */
	private function adjustSigRange( array $sigNodes, array $match, DOMText $node ) {
		$firstSigNode = end( $sigNodes );
		$lastSigNode = $sigNodes[0];

		// TODO Document why this needs to be so complicated
		$lastSigNodeOffset = $lastSigNode === $node ?
			$match['matchData'][0][1] + strlen( $match['matchData'][0][0] ) - $match['offset'] :
			CommentUtils::childIndexOf( $lastSigNode ) + 1;
		$sigRange = new ImmutableRange(
			$firstSigNode->parentNode,
			CommentUtils::childIndexOf( $firstSigNode ),
			$lastSigNode === $node ? $node : $lastSigNode->parentNode,
			$lastSigNodeOffset
		);

		return $sigRange;
	}

	private function buildThreadItems() : void {
		$timestampRegexps = $this->getLocalTimestampRegexps();
		$commentItems = [];
		$threadItems = [];
		$dfParsers = $this->getLocalTimestampParsers();

		// Placeholder heading in case there are comments in the 0th section
		$range = new ImmutableRange( $this->rootNode, 0, $this->rootNode, 0 );
		$fakeHeading = new HeadingItem( $range, 99, true );
		$fakeHeading->setRootNode( $this->rootNode );

		$curComment = $fakeHeading;
		$curCommentEnd = $range->endContainer;

		$treeWalker = new TreeWalker(
			$this->rootNode,
			NodeFilter::SHOW_ELEMENT | NodeFilter::SHOW_TEXT,
			[ self::class, 'acceptOnlyNodesAllowingComments' ]
		);
		$lastSigNode = null;
		while ( $node = $treeWalker->nextNode() ) {
			if ( $node instanceof DOMElement && preg_match( '/^h([1-6])$/i', $node->tagName, $match ) ) {
				$headingNodeAndOffset = CommentUtils::getHeadlineNodeAndOffset( $node );
				$headingNode = $headingNodeAndOffset['node'];
				$startOffset = $headingNodeAndOffset['offset'];
				$range = new ImmutableRange(
					$headingNode, $startOffset, $headingNode, $headingNode->childNodes->length
				);
				$curComment = new HeadingItem( $range, (int)( $match[ 1 ] ) );
				$curComment->setRootNode( $this->rootNode );
				$threadItems[] = $curComment;
				$curCommentEnd = $node;
			} elseif ( $node instanceof DOMText && ( $match = $this->findTimestamp( $node, $timestampRegexps ) ) ) {
				$warnings = [];
				$foundSignature = $this->findSignature( $node, $lastSigNode );
				$author = $foundSignature[1];
				$lastSigNode = $foundSignature[0][0];

				if ( !$author ) {
					// Ignore timestamps for which we couldn't find a signature. It's probably not a real
					// comment, but just a false match due to a copypasted timestamp.
					continue;
				}

				$sigRanges = [];
				$sigRanges[] = $this->adjustSigRange( $foundSignature[0], $match, $node );

				// Everything from the last comment up to here is the next comment
				$startNode = $this->nextInterestingLeafNode( $curCommentEnd );
				$endNode = $lastSigNode;

				// Skip to the end of the "paragraph". This only looks at tag names and can be fooled by CSS, but
				// avoiding that would be more difficult and slower.
				//
				// If this skips over another potential signature, also skip it in the main TreeWalker loop, to
				// avoid generating multiple comments when there is more than one signature on a single "line".
				// Often this is done when someone edits their comment later and wants to add a note about that.
				// (Or when another person corrects a typo, or strikes out a comment, etc.) Multiple comments
				// within one paragraph/list-item result in a confusing double "Reply" button, and we also have
				// no way to indicate which one you're replying to (this might matter in the future for
				// notifications or something).
				CommentUtils::linearWalk(
					$lastSigNode,
					function ( string $event, DOMNode $n ) use (
						&$endNode, &$sigRanges,
						$treeWalker, $timestampRegexps, $node
					) {
						if ( CommentUtils::isBlockElement( $n ) ) {
							// Stop when entering or leaving a block node
							return true;
						}
						if (
							$event === 'leave' &&
							$n instanceof DOMText && $n !== $node &&
							( $match2 = $this->findTimestamp( $n, $timestampRegexps ) )
						) {
							// If this skips over another potential signature, also skip it in the main TreeWalker loop
							$treeWalker->currentNode = $n;
							// …and add it as another signature to this comment (regardless of the author and timestamp)
							$foundSignature2 = $this->findSignature( $n, $node );
							if ( $foundSignature2[1] ) {
								$sigRanges[] = $this->adjustSigRange( $foundSignature2[0], $match2, $n );
							}
						}
						if ( $event === 'leave' ) {
							// Take the last complete node which we skipped past
							$endNode = $n;
						}
					}
				);

				$length = ( $endNode->nodeType === XML_TEXT_NODE ) ?
					strlen( rtrim( $endNode->nodeValue, "\t\n\f\r " ) ) :
					// PHP bug: childNodes can be null for comment nodes
					// (it should always be a DOMNodeList, even if the node can't have children)
					( $endNode->childNodes ? $endNode->childNodes->length : 0 );
				$range = new ImmutableRange(
					$startNode->parentNode,
					CommentUtils::childIndexOf( $startNode ),
					$endNode,
					$length
				);

				$startLevel = CommentUtils::getIndentLevel( $startNode, $this->rootNode ) + 1;
				$endLevel = CommentUtils::getIndentLevel( $node, $this->rootNode ) + 1;
				if ( $startLevel !== $endLevel ) {
					$warnings[] = 'Comment starts and ends with different indentation';
				}
				// Should this use the indent level of $startNode or $node?
				$level = min( $startLevel, $endLevel );

				$dateTime = $dfParsers[ $match['parserIndex'] ]( $match['matchData'] );
				if ( isset( $dateTime->discussionToolsWarning ) ) {
					$warnings[] = $dateTime->discussionToolsWarning;
				}
				// ISO 8601 date. Almost DateTimeInterface::RFC3339_EXTENDED, but ending with 'Z' instead
				// of '+00:00', like Date#toISOString in JavaScript.
				$dateTimeStr = $dateTime->format( 'Y-m-d\TH:i:s.v\Z' );

				$curComment = new CommentItem(
					$level,
					$range,
					$sigRanges,
					$dateTimeStr,
					$author
				);
				$curComment->setRootNode( $this->rootNode );
				if ( $warnings ) {
					$curComment->addWarnings( $warnings );
				}
				$commentItems[] = $curComment;
				$threadItems[] = $curComment;
				$curCommentEnd = $curComment->getRange()->endContainer;
			}
		}

		// Insert the fake placeholder heading if there are any comments in the 0th section
		// (before the first real heading)
		if ( count( $threadItems ) && !( $threadItems[ 0 ] instanceof HeadingItem ) ) {
			array_unshift( $threadItems, $fakeHeading );
		}

		$this->commentItems = $commentItems;
		$this->threadItems = $threadItems;
	}

	/**
	 * Group discussion comments into threads and associate replies to original messages.
	 *
	 * Each thread must begin with a heading. Original messages in the thread are treated as replies to
	 * its heading. Other replies are associated based on the order and indentation level.
	 *
	 * Note that the objects in `comments` are extended in-place with the additional data.
	 *
	 * For example, for a MediaWiki discussion like this (we're dealing with HTML DOM here,
	 * the wikitext syntax is just for illustration):
	 *
	 *     == A ==
	 *     B. ~~~~
	 *     : C.
	 *     : C. ~~~~
	 *     :: D. ~~~~
	 *     ::: E. ~~~~
	 *     ::: F. ~~~~
	 *     : G. ~~~~
	 *     H. ~~~~
	 *     : I. ~~~~
	 *
	 * This function would return a structure like:
	 *
	 *     [
	 *       HeadingItem( { level: 0, range: (h2: A), replies: [
	 *         CommentItem( { level: 1, range: (p: B), replies: [
	 *           CommentItem( { level: 2, range: (li: C, li: C), replies: [
	 *             CommentItem( { level: 3, range: (li: D), replies: [
	 *               CommentItem( { level: 4, range: (li: E), replies: [] },
	 *               CommentItem( { level: 4, range: (li: F), replies: [] },
	 *             ] },
	 *           ] },
	 *           CommentItem( { level: 2, range: (li: G), replies: [] },
	 *         ] },
	 *         CommentItem( { level: 1, range: (p: H), replies: [
	 *           CommentItem( { level: 2, range: (li: I), replies: [] },
	 *         ] },
	 *       ] } )
	 *     ]
	 *
	 * @return HeadingItem[] Tree structure of comments, top-level items are the headings.
	 */
	public function getThreads() : array {
		if ( !$this->threads ) {
			$this->buildThreads();
		}
		return $this->threads;
	}

	/**
	 * Truncate user generated parts of IDs so full ID always fits within a database field of length 255
	 *
	 * @param string $text Text
	 * @return string Truncated text
	 */
	private function truncateForId( string $text ) : string {
		return $this->language->truncateForDatabase( $text, 80, '' );
	}

	/**
	 * Given a thread item, return an identifier for it that is unique within the page.
	 *
	 * @param ThreadItem $threadItem
	 * @param bool $noDedupe Internal. Don't attempt to de-duplicate
	 * @return string
	 */
	private function computeId( ThreadItem $threadItem, bool $noDedupe = false ) : string {
		$id = null;

		if ( $threadItem instanceof HeadingItem && $threadItem->isPlaceholderHeading() ) {
			// The range points to the root note, using it like below results in silly values
			$id = 'h|';
		} elseif ( $threadItem instanceof HeadingItem ) {
			$headline = CommentUtils::getHeadlineNodeAndOffset( $threadItem->getRange()->startContainer )['node'];
			$id = 'h|' . $this->truncateForId( $headline->getAttribute( 'id' ) ?? '' );
		} elseif ( $threadItem instanceof CommentItem ) {
			$id = 'c|' . $this->truncateForId( $threadItem->getAuthor() ) .
				'|' . $threadItem->getTimestamp();
		} else {
			throw new MWException( 'Unknown ThreadItem type' );
		}

		// If there would be multiple comments with the same ID (i.e. the user left multiple comments
		// in one edit, or within a minute), add the parent ID to disambiguate them.
		$threadItemParent = $threadItem->getParent();
		if ( $threadItemParent instanceof HeadingItem && !$threadItemParent->isPlaceholderHeading() ) {
			$headline = CommentUtils::getHeadlineNodeAndOffset( $threadItemParent->getRange()->startContainer )['node'];
			$id .= '|' . $this->truncateForId( $headline->getAttribute( 'id' ) ?? '' );
		} elseif ( $threadItemParent instanceof CommentItem ) {
			$id .= '|' . $this->truncateForId( $threadItemParent->getAuthor() ) .
				'|' . $threadItemParent->getTimestamp();
		}

		if ( $threadItem instanceof HeadingItem ) {
			// To avoid old threads re-appearing on popular pages when someone uses a vague title
			// (e.g. dozens of threads titled "question" on [[Wikipedia:Help desk]]: https://w.wiki/fbN),
			// include the oldest timestamp in the thread (i.e. date the thread was started) in the
			// heading ID.
			$oldestComment = $this->getThreadStartComment( $threadItem );
			if ( $oldestComment ) {
				$id .= '|' . $oldestComment->getTimestamp();
			}
		}

		if ( !$noDedupe && isset( $this->threadItemsById[$id] ) ) {
			// Well, that's tough
			$threadItem->addWarning( 'Duplicate comment ID' );
			// Finally, disambiguate by adding sequential numbers, to allow replying to both comments
			$number = 1;
			while ( isset( $this->threadItemsById["$id|$number"] ) ) {
				$number++;
			}
			$id = "$id|$number";
		}

		return $id;
	}

	/**
	 * Given a thread item, return an identifier for it like computeId(), generated according to an
	 * older algorithm, so that we can still match IDs from cached data.
	 *
	 * @param ThreadItem $threadItem
	 * @return string|null
	 */
	private function computeLegacyId( ThreadItem $threadItem ) : ?string {
		$id = null;

		if ( $threadItem instanceof HeadingItem && $threadItem->isPlaceholderHeading() ) {
			// The range points to the root note, using it like below results in silly values
			$id = 'h|';
		} elseif ( $threadItem instanceof HeadingItem ) {
			$headline = CommentUtils::getHeadlineNodeAndOffset( $threadItem->getRange()->startContainer )['node'];
			$id = 'h|' . ( $headline->getAttribute( 'id' ) ?? '' );
		} elseif ( $threadItem instanceof CommentItem ) {
			$id = 'c|' . $threadItem->getAuthor() . '|' . $threadItem->getTimestamp();
		} else {
			throw new MWException( 'Unknown ThreadItem type' );
		}

		// If there would be multiple comments with the same ID (i.e. the user left multiple comments
		// in one edit, or within a minute), add the parent ID to disambiguate them.
		$threadItemParent = $threadItem->getParent();
		if ( $threadItemParent instanceof HeadingItem && !$threadItemParent->isPlaceholderHeading() ) {
			$headline = CommentUtils::getHeadlineNodeAndOffset( $threadItemParent->getRange()->startContainer )['node'];
			$id .= '|' . ( $headline->getAttribute( 'id' ) ?? '' );
		} elseif ( $threadItemParent instanceof CommentItem ) {
			$id .= '|' . $threadItemParent->getAuthor() . '|' . $threadItemParent->getTimestamp();
		}

		if ( $threadItem instanceof HeadingItem ) {
			// To avoid old threads re-appearing on popular pages when someone uses a vague title
			// (e.g. dozens of threads titled "question" on [[Wikipedia:Help desk]]: https://w.wiki/fbN),
			// include the oldest timestamp in the thread (i.e. date the thread was started) in the
			// heading ID.
			$oldestComment = $this->getThreadStartComment( $threadItem );
			if ( $oldestComment ) {
				$id .= '|' . $oldestComment->getTimestamp();
			}
		}

		// Legacy IDs are only required if different to the current ID
		if ( $id === $this->computeId( $threadItem, true ) ) {
			return null;
		}

		if ( isset( $this->threadItemsById[$id] ) ) {
			// Well, that's tough
			$threadItem->addWarning( 'Duplicate comment ID' );
			// Finally, disambiguate by adding sequential numbers, to allow replying to both comments
			$number = 1;
			while ( isset( $this->threadItemsById["$id|$number"] ) ) {
				$number++;
			}
			$id = "$id|$number";
		}

		return $id;
	}

	private function buildThreads() : void {
		if ( !$this->threadItems ) {
			$this->buildThreadItems();
		}

		$threads = [];
		$replies = [];
		$this->threadItemsById = [];

		foreach ( $this->threadItems as $threadItem ) {
			if ( count( $replies ) < $threadItem->getLevel() ) {
				// Someone skipped an indentation level (or several). Pretend that the previous reply
				// covers multiple indentation levels, so that following comments get connected to it.
				$threadItem->addWarning( 'Comment skips indentation level' );
				while ( count( $replies ) < $threadItem->getLevel() ) {
					$replies[] = end( $replies );
				}
			}

			if ( $threadItem instanceof HeadingItem ) {
				// New root (thread)
				$threads[] = $threadItem;
				// Attach as a sub-thread to preceding higher-level heading.
				// Any replies will appear in the tree twice, under the main-thread and the sub-thread.
				$maybeParent = count( $threads ) > 1 ? $threads[ count( $threads ) - 2 ] : null;
				while ( $maybeParent && $maybeParent->getHeadingLevel() >= $threadItem->getHeadingLevel() ) {
					$maybeParent = $maybeParent->getParent();
				}
				if ( $maybeParent ) {
					$threadItem->setParent( $maybeParent );
					$maybeParent->addReply( $threadItem );
				}
			} elseif ( isset( $replies[ $threadItem->getLevel() - 1 ] ) ) {
				// Add as a reply to the closest less-nested comment
				$threadItem->setParent( $replies[ $threadItem->getLevel() - 1 ] );
				$threadItem->getParent()->addReply( $threadItem );
			} else {
				$threadItem->addWarning( 'Comment could not be connected to a thread' );
			}

			$replies[ $threadItem->getLevel() ] = $threadItem;
			// Cut off more deeply nested replies
			array_splice( $replies, $threadItem->getLevel() + 1 );
		}

		$this->threads = $threads;

		foreach ( $this->threadItems as $threadItem ) {
			// Set the IDs used to refer to comments and headings.
			// This has to be a separate pass because we don't have the list of replies before
			// this point.
			$id = $this->computeId( $threadItem );
			$threadItem->setId( $id );
			$this->threadItemsById[$id] = $threadItem;
			$legacyId = $this->computeLegacyId( $threadItem );
			$threadItem->setLegacyId( $legacyId );
			if ( $legacyId ) {
				$this->threadItemsById[$legacyId] = $threadItem;
			}
		}
	}

	/**
	 * @param ThreadItem $threadItem
	 * @return CommentItem|null
	 */
	private function getThreadStartComment( ThreadItem $threadItem ) {
		$oldest = null;
		if ( $threadItem instanceof CommentItem ) {
			$oldest = $threadItem;
		}
		// Check all replies. This can't just use the first comment because threads are often summarized
		// at the top when the discussion is closed.
		foreach ( $threadItem->getReplies() as $comment ) {
			// Don't include sub-threads to avoid changing the ID when threads are "merged".
			if ( $comment instanceof CommentItem ) {
				$oldestInReplies = $this->getThreadStartComment( $comment );
				if ( !$oldest || $oldestInReplies->getTimestamp() < $oldest->getTimestamp() ) {
					$oldest = $oldestInReplies;
				}
			}
		}
		return $oldest;
	}
}
