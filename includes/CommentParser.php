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
use DOMXPath;
use IP;
use Language;
use MediaWiki\MediaWikiServices;
use stdClass;
use Title;

// TODO maybe make a class for ranges?
// TODO make a class for comments
// TODO clean up static vs non-static

// TODO consider rewriting as single traversal, without XPath
// TODO consider making timestamp parsing not a returned function

class CommentParser {
	private const SIGNATURE_SCAN_LIMIT = 100;

	/**
	 * @param Language $language Content language
	 * @param Config $config
	 * @param array $data
	 */
	public function __construct( Language $language, Config $config, array $data = [] ) {
		$this->language = $language;
		$this->config = $config;
		$this->dateFormat = $this->language->getDateFormatString(
			'both',
			$this->language->dateFormat( false )
		);
		// TODO: We probably shouldn't assume that each digit can be represented by a single BMP
		// codepoint in every language (although it seems to be true right now).
		$this->digits = $this->config->get( 'TranslateNumerals' ) ?
			$this->language->formatNum( '0123456789', true ) :
			null;
		$this->digitsRegexp = $this->config->get( 'TranslateNumerals' ) ?
			'[' . $this->language->formatNum( '0123456789', true ) . ']' :
			'\\d';
		// TODO: Instead of passing data used for mocking, mock the methods that fetch the data.
		$this->data = $data;
		$this->localTimezone = $this->config->get( 'Localtimezone' );
		$this->timezoneAbbrs = $this->computeTimezoneAbbrs();
	}

	public static function newFromGlobalState() : CommentParser {
		return new static(
			MediaWikiServices::getInstance()->getContentLanguage(),
			MediaWikiServices::getInstance()->getMainConfig()
		);
	}

	/**
	 * Build the timezone abbreviations map for the local timezone.
	 * @return array Associative array mapping localized timezone abbreviations to IANA abbreviations
	 */
	private function computeTimezoneAbbrs() : array {
		// Return only timezone abbreviations for the local timezone (there will often be two, for
		// non-DST and DST timestamps, and sometimes more due to historical data, but that's okay).
		$timezoneAbbrs = array_keys( array_filter(
			DateTimeZone::listAbbreviations(),
			function ( $timezones ) {
				foreach ( $timezones as $tz ) {
					if ( $tz['timezone_id'] === $this->localTimezone ) {
						return true;
					}
				}
				return false;
			}
		) );
		return array_combine(
			array_map( function ( $tzMsg ) {
				// MWTimestamp::getTimezoneMessage()
				// Parser::pstPass2()
				// Messages used here: 'timezone-utc' and so on
				$key = 'timezone-' . strtolower( trim( $tzMsg ) );
				$msg = wfMessage( $key )->inLanguage( $this->language );
				// TODO: This probably causes a similar issue to https://phabricator.wikimedia.org/T221294,
				// but we *must* check the message existence in the database, because the messages are not
				// actually defined by MediaWiki core for any timezone other than UTC...
				if ( $msg->exists() ) {
					return $this->getMessages( [ $key ] )[0];
				}
				return strtoupper( $tzMsg );
			}, $timezoneAbbrs ),
			array_map( 'strtoupper', $timezoneAbbrs )
		);
	}

	/**
	 * Get a MediaWiki page title from a URL
	 * @param string $url
	 * @return Title|null
	 */
	private function getTitleFromUrl( string $url ) : ?Title {
		// TODO: Set the correct base in the document?
		if ( strpos( $url, './' ) === 0 ) {
			$url = 'https://local/wiki/' . substr( $url, 2 );
		} elseif ( strpos( $url, '://' ) === false ) {
			$url = 'https://local' . $url;
		}
		$bits = wfParseUrl( $url );
		$query = wfCgiToArray( $bits['query'] ?? '' );
		if ( isset( $query['title'] ) ) {
			return Title::newFromText( $query['title'] );
		}

		$articlePathRegexp = '/' . str_replace(
			preg_quote( '$1', '/' ),
			'(.*)',
			preg_quote( $this->config->get( 'ArticlePath' ), '/' )
		) . '/';
		$matches = null;
		if ( preg_match( $articlePathRegexp, $url, $matches ) ) {
			return Title::newFromText( urldecode( $matches[1] ) );
		}
		return null;
	}

	/**
	 * Return the next leaf node in the tree order that is not an empty or whitespace-only text node.
	 *
	 * In other words, this returns a text node with content other than whitespace, or an element node
	 * with no children, that follows the given node.
	 *
	 * @param DOMNode $node Node to start searching at. This node's children are ignored.
	 * @param DOMElement $rootNode Node to stop searching at
	 * @return DOMNode|null
	 */
	private function nextInterestingLeafNode( DOMNode $node, DOMElement $rootNode ) : ?DOMNode {
		$n = $node;
		do {
			if ( $n->firstChild && ( $node === $rootNode || $n !== $node ) ) {
				$n = $n->firstChild;
			} elseif ( $n->nextSibling ) {
				$n = $n->nextSibling;
			} else {
				while ( $n && $n !== $rootNode && !$n->nextSibling ) {
					$n = $n->parentNode;
				}
				$n = $n->nextSibling;
			}

			if (
				$n && (
					(
						$n->nodeType === XML_TEXT_NODE &&
						CommentUtils::htmlTrim( $n->nodeValue ) !== ''
					) ||
					(
						$n->nodeType === XML_CDATA_SECTION_NODE &&
						CommentUtils::htmlTrim( $n->nodeValue ) !== ''
					) ||
					( $n->nodeType === XML_ELEMENT_NODE && !$n->firstChild )
				)
			) {
				return $n;
			}
		} while ( $n && $n !== $rootNode );
		return null;
	}

	/**
	 * @param string[] $values Values to match
	 * @return string Regular expression
	 */
	private static function regexpAlternateGroup( array $values ) : string {
		return '(' . implode( '|', array_map( function ( $x ) {
			return preg_quote( $x, '/' );
		}, $values ) ) . ')';
	}

	/**
	 * @param string[] $messageKeys Message keys
	 * @return string[] Message values
	 */
	private function getMessages( array $messageKeys ) : array {
		return array_map( function ( $key ) {
			return isset( $this->data['contLangMessages'][$key] ) ?
				$this->data['contLangMessages'][$key] :
				wfMessage( $key )->inLanguage( $this->language )->text();
		}, $messageKeys );
	}

	/**
	 * Get a regexp that matches timestamps generated using the given date format.
	 *
	 * This only supports format characters that are used by the default date format in any of
	 * MediaWiki's languages, namely: D, d, F, G, H, i, j, l, M, n, Y, xg, xkY (and escape characters),
	 * and only dates when MediaWiki existed, let's say 2000 onwards (Thai dates before 1941 are
	 * complicated).
	 *
	 * @param string $format Date format
	 * @param string $digitsRegexp Regular expression matching a single localized digit, e.g. '[0-9]'
	 * @param array $tzAbbrs Associative array mapping localized timezone abbreviations to
	 *   IANA abbrevations, for the local timezone, e.g. [ 'EDT' => 'EDT', 'EST' => 'EST' ]
	 * @return string Regular expression
	 */
	private function getTimestampRegexp(
		string $format, string $digitsRegexp, array $tzAbbrs
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
				case 'xx' :
					$s .= 'x';
					break;
				case 'xg':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( Language::MONTH_GENITIVE_MESSAGES )
					);
					break;
				case 'd':
					$num = '2';
					break;
				case 'D':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( Language::WEEKDAY_ABBREVIATED_MESSAGES )
					);
					break;
				case 'j':
					$num = '1,2';
					break;
				case 'l':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( Language::WEEKDAY_MESSAGES )
					);
					break;
				case 'F':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( Language::MONTH_MESSAGES )
					);
					break;
				case 'M':
					$s .= self::regexpAlternateGroup(
						$this->getMessages( Language::MONTH_ABBREVIATED_MESSAGES )
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
						# Quote at end of string, assume literal "
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

		// Hardcoded parentheses and space like in Parser::pstPass2
		// Ignore some invisible Unicode characters that often sneak into copypasted timestamps (T245784)
		// \uNNNN syntax can only be used from PHP 7.3
		return '/' . $s . '[\\x{200E}\\x{200F}]? [\\x{200E}\\x{200F}]?\\(' . $tzRegexp . '\\)/u';
	}

	/**
	 * Get a function that parses timestamps generated using the given date format, based on the result
	 * of matching the regexp returned by getTimestampRegexp()
	 *
	 * @param string $format Date format, as used by MediaWiki
	 * @param string|null $digits Localised digits from 0 to 9, e.g. `0123456789`
	 * @param string $localTimezone Local timezone IANA name, e.g. `America/New_York`
	 * @param array $tzAbbrs Map of localised timezone abbreviations to IANA abbreviations
	 *   for the local timezone, e.g. [ 'EDT' => 'EDT', 'EST' => 'EST' ]
	 * @return function Parser function
	 */
	private function getTimestampParser(
		string $format, ?string $digits, string $localTimezone, array $tzAbbrs
	) : callable {
		$untransformDigits = function ( string $text ) use ( $digits ) {
			if ( !$digits ) {
				return $text;
			}
			return preg_replace_callback(
				'/[' . $digits . ']/',
				function ( $m ) use ( $digits ) {
					return strpos( $digits, $m[0] );
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
			$matchingGroups, $untransformDigits, $localTimezone, $tzAbbrs
		) {
			if ( is_array( $match[0] ) ) {
				// Strip PREG_OFFSET_CAPTURE data
				$match = array_map( function ( $tuple ) {
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
						$monthIdx = array_search( $text, $this->getMessages( Language::MONTH_GENITIVE_MESSAGES ) );
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
						$monthIdx = array_search( $text, $this->getMessages( Language::MONTH_MESSAGES ) );
						break;
					case 'M':
						$monthIdx = array_search( $text, $this->getMessages( Language::MONTH_ABBREVIATED_MESSAGES ) );
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
				}
				// else: neither DST nor non-DST gives us the expected timezone
				// TODO log a warning in this case?
			}

			// Now set the timezone back to UTC for formatting
			$date->setTimezone( new DateTimeZone( 'UTC' ) );
			$date = DateTimeImmutable::createFromMutable( $date );

			return $date;
		};
	}

	/**
	 * Get a regular expression that matches timestamps in the local date format.
	 *
	 * This calls getTimestampRegexp() with predefined data for the current wiki.
	 *
	 * @return string Regular expression
	 */
	public function getLocalTimestampRegexp() : string {
		return self::getTimestampRegexp(
			$this->dateFormat,
			$this->digitsRegexp,
			$this->timezoneAbbrs
		);
	}

	/**
	 * Get a function that parses timestamps in the local date format, based on the result
	 * of matching the regexp returned by getLocalTimestampRegexp().
	 *
	 * This calls getTimestampParser() with predefined data for the current wiki.
	 *
	 * @return function Parser function
	 */
	private function getLocalTimestampParser() : callable {
		return $this->getTimestampParser(
			$this->dateFormat,
			$this->digits,
			$this->localTimezone,
			$this->timezoneAbbrs
		);
	}

	/**
	 * Get the indent level of $node, relative to $rootNode.
	 *
	 * The indent level is the number of lists inside of which it is nested.
	 *
	 * @param DOMNode $node
	 * @param DOMElement $rootNode
	 * @return int
	 */
	private function getIndentLevel( DOMNode $node, DOMElement $rootNode ) : int {
		$indent = 0;
		while ( $node ) {
			if ( $node === $rootNode ) {
				break;
			}
			$nodeName = strtolower( $node->nodeName );
			if ( $nodeName === 'li' || $nodeName === 'dd' ) {
				$indent++;
			}
			$node = $node->parentNode;
		}
		return $indent;
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
	 * comprising the signature, with $timestampNode as the last element. The second element
	 * is the username (null for unsigned comments).
	 *
	 * @param DOMText $timestampNode Text node
	 * @param DOMNode|null $until Node to stop searching at
	 * @return array [ nodes, username ]
	 */
	private function findSignature( DOMText $timestampNode, ?DOMNode $until = null ) : array {
		$node = $timestampNode;
		$sigNodes = [ $node ];
		$sigUsername = null;
		$length = 0;
		$lastLinkNode = $timestampNode;
		while (
			( $node = $node->previousSibling ) && $length < self::SIGNATURE_SCAN_LIMIT && $node !== $until
		) {
			$sigNodes[] = $node;
			$length += $node->textContent ? strlen( $node->textContent ) : 0;
			if ( $node->nodeType === XML_TEXT_NODE ) {
				// FIXME use proper constant, or proper isText check
				continue;
			}

			$links = [];
			if ( strtolower( $node->nodeName ) === 'a' ) {
				$links = [ $node ];
			} elseif ( $node->nodeType === XML_ELEMENT_NODE ) {
				// Handle links nested in formatting elements.
				// Helpful accidental feature: users whose signature is not detected in full (due to
				// text formatting) can just wrap it in a <span> to fix that.
				// "Ten Pound Hammer • (What did I screw up now?)"
				// "« Saper // dyskusja »"
				$links = $node->getElementsByTagName( 'a' );
			}
			if ( !count( $links ) ) {
				continue;
			}

			// Find the earliest link that links to the user's user page
			foreach ( $links as $link ) {
				$username = null;
				$title = $this->getTitleFromUrl( $link->getAttribute( 'href' ) );
				if ( !$title ) {
					continue;
				}
				if ( $title->getNamespace() === NS_USER || $title->getNamespace() === NS_USER_TALK ) {
					$username = $title->getText();
					if ( strpos( $username, '/' ) !== false ) {
						continue;
					}
				} elseif ( $title->isSpecial( 'Contributions' ) ) {
					$parts = explode( '/', $title->getText(), 2 );
					if ( !isset( $parts[1] ) ) {
						continue;
					}
					// Normalize the username: users may link to their contributions with an unnormalized name
					$userpage = Title::makeTitleSafe( NS_USER, $parts[1] );
					if ( !$userpage ) {
						continue;
					}
					$username = $userpage->getText();
				}
				if ( !$username ) {
					continue;
				}
				if ( IP::isIPv6( $username ) ) {
					// Bot-generated links "Preceding unsigned comment added by" have non-standard case
					$username = strtoupper( $username );
				}

				// Accept the first link to the user namespace, then only accept links to that user
				if ( $sigUsername === null ) {
					$sigUsername = $username;
				}
				if ( $username === $sigUsername ) {
					$lastLinkNode = $node;
					break;
				}
			}
			// Keep looking if a node with links wasn't a link to a user page
			// "Doc James (talk · contribs · email)"
		}
		// Pop excess text nodes
		while ( end( $sigNodes ) !== $lastLinkNode ) {
			array_pop( $sigNodes );
		}
		return [ $sigNodes, $sigUsername ];
	}

	/**
	 * Find all timestamps within a DOM subtree.
	 *
	 * @param DOMElement $rootNode
	 * @return array Array of [node, matchData] pairs
	 */
	public function findTimestamps( DOMElement $rootNode ) : array {
		$xpath = new DOMXPath( $rootNode->ownerDocument );
		$textNodes = $xpath->query( '//text()', $rootNode );
		$matches = [];
		$timestampRegex = self::getLocalTimestampRegexp();
		foreach ( $textNodes as $node ) {
			$startNode = $node;
			$nodeText = '';

			while ( $node ) {
				$nodeText .= $node->nodeValue;

				// In Parsoid HTML, entities are represented as a 'mw:Entity' node, rather than normal HTML
				// entities. On Arabic Wikipedia, the "UTC" timezone name contains some non-breaking spaces,
				// which apparently are often turned into &nbsp; entities by buggy editing tools. To handle
				// this, we must piece together the text, so that our regexp can match those timestamps.
				if (
					$node->nextSibling &&
					$node->nextSibling->nodeType === XML_ELEMENT_NODE &&
					$node->nextSibling->getAttribute( 'typeof' ) === 'mw:Entity'
				) {
					$nodeText .= $node->nextSibling->firstChild->nodeValue;

					// If the entity is followed by more text, do this again
					if (
						$node->nextSibling->nextSibling &&
						$node->nextSibling->nextSibling->nodeType === XML_TEXT_NODE
					) {
						$node = $node->nextSibling->nextSibling;
					} else {
						$node = null;
					}
				} else {
					$node = null;
				}
			}

			$matchData = null;
			// Allows us to mimic match.index in #getComments
			if ( preg_match( $timestampRegex, $nodeText, $matchData, PREG_OFFSET_CAPTURE ) ) {
				$matches[] = [ $startNode, $matchData ];
			}
		}
		return $matches;
	}

	/**
	 * Get all discussion comments (and headings) within a DOM subtree.
	 *
	 * This returns a flat list, use groupThreads() to associate replies to original messages and
	 * get a tree structure starting at section headings.
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
	 *       [ 'type' => 'heading', 'level' => 0, 'range' => (h2: A)        },
	 *       [ 'type' => 'comment', 'level' => 1, 'range' => (p: B)         },
	 *       [ 'type' => 'comment', 'level' => 2, 'range' => (li: C, li: C) },
	 *       [ 'type' => 'comment', 'level' => 3, 'range' => (li: D)        },
	 *       [ 'type' => 'comment', 'level' => 4, 'range' => (li: E)        },
	 *       [ 'type' => 'comment', 'level' => 4, 'range' => (li: F)        },
	 *       [ 'type' => 'comment', 'level' => 2, 'range' => (li: G)        },
	 *       [ 'type' => 'comment', 'level' => 1, 'range' => (p: H)         },
	 *       [ 'type' => 'comment', 'level' => 2, 'range' => (li: I)        }
	 *     ]
	 *
	 * The elements of the array are stdClass objects with the following fields:
	 * - 'type' (string): 'heading' or 'comment'
	 * - 'range' (array): The extent of the comment, including the signature and timestamp.
	 *                    Comments can start or end in the middle of a DOM node.
	 *                    Keys: 'startContainer', 'startOffset', 'endContainer' and 'endOffset'
	 * - 'level' (int): Indentation level of the comment. Headings are 0, comments start at 1.
	 * - 'timestamp' (string): Timestamp (TODO in what format?). Not set for headings.
	 * - 'author' (string|null): Comment author's username, null for unsigned comments.
	 *                           Not set for headings.
	 *
	 * @param DOMElement $rootNode
	 * @return stdClass[] Results. Each result is an object.
	 */
	public function getComments( DOMElement $rootNode ) : array {
		$timestamps = $this->findTimestamps( $rootNode );

		$xpath = new DOMXPath( $rootNode->ownerDocument );
		$allNodes = $xpath->query( '//text()|//node()', $rootNode );
		$tocNode = $rootNode->ownerDocument->getElementById( 'toc' );
		$comments = [];
		$dfParser = $this->getLocalTimestampParser();

		// Placeholder heading in case there are comments in the 0th section
		$range = (object)[
			'startContainer' => $rootNode,
			'startOffset' => 0,
			'endContainer' => $rootNode,
			'endOffset' => 0
		];
		$fakeHeading = (object)[
			'placeholderHeading' => true,
			'type' => 'heading',
			'range' => $range,
			'level' => 0
		];

		$curComment = $fakeHeading;

		$nextTimestamp = 0;
		foreach ( $allNodes as $node ) {
			// Skip nodes inside <div id="toc">
			if ( $tocNode && CommentUtils::contains( $tocNode, $node ) ) {
				continue;
			}

			if ( $node->nodeType === XML_ELEMENT_NODE && preg_match( '/^h[1-6]$/i', $node->nodeName ) ) {
				$range = (object)[
					'startContainer' => $node,
					'startOffset' => 0,
					'endContainer' => $node,
					'endOffset' => $node->childNodes->length
				];
				$curComment = (object)[
					'type' => 'heading',
					'range' => $range,
					'level' => 0
				];
				$comments[] = $curComment;
			} elseif ( isset( $timestamps[$nextTimestamp] ) && $node === $timestamps[$nextTimestamp][0] ) {
				$foundSignature = $this->findSignature( $node, $curComment->range->endContainer );
				$author = $foundSignature[1];
				$firstSigNode = end( $foundSignature[0] );

				if ( !$author ) {
					// Ignore timestamps for which we couldn't find a signature. It's probably not a real
					// comment, but just a false match due to a copypasted timestamp.
					$nextTimestamp++;
					continue;
				}

				// Everything from the last comment up to here is the next comment
				$startNode = $this->nextInterestingLeafNode( $curComment->range->endContainer, $rootNode );
				$match = $timestamps[$nextTimestamp][1];
				$range = (object)[
					'startContainer' => $startNode->parentNode,
					'startOffset' => CommentUtils::childIndexOf( $startNode ),
					'endContainer' => $node,
					'endOffset' => $match[0][1] + strlen( $match[0][0] )
				];
				$sigRange = (object)[
					'startContainer' => $firstSigNode->parentNode,
					'startOffset' => CommentUtils::childIndexOf( $firstSigNode ),
					'endContainer' => $node,
					'endOffset' => $match[0][1] + strlen( $match[0][0] )
				];

				$startLevel = $this->getIndentLevel( $startNode, $rootNode ) + 1;
				$endLevel = $this->getIndentLevel( $node, $rootNode ) + 1;
				if ( $startLevel !== $endLevel ) {
					// TODO warn: 'Comment starts and ends with different indentation'
				}

				// Avoid generating multiple comments when there is more than one signature on a single "line".
				// Often this is done when someone edits their comment later and wants to add a note about that.
				// (Or when another person corrects a typo, or strikes out a comment, etc.) Multiple comments
				// within one paragraph/listitem result in a confusing double "Reply" button, and we also have
				// no way to indicate which one you're replying to (this might matter in the future for
				// notifications or something).
				if (
					$curComment->type === 'comment' &&
					(
						CommentUtils::closestElement(
							$node, [ 'li', 'dd', 'p' ]
						) ?? $node->parentNode
					) ===
					(
						CommentUtils::closestElement(
							$curComment->range->endContainer, [ 'li', 'dd', 'p' ]
						) ?? $curComment->range->endContainer->parentNode
					)
				) {
					// Merge this with the previous comment. Use that comment's author and timestamp.
					$curComment->range->endContainer = $range->endContainer;
					$curComment->range->endOffset = $range->endOffset;
					$curComment->signatureRanges[] = $sigRange;
					$curComment->level = min( min( $startLevel, $endLevel ), $curComment->level );

					$nextTimestamp++;
					continue;
				}

				$curComment = (object)[
					'type' => 'comment',
					// Almost DateTimeInterface::RFC3339_EXTENDED
					'timestamp' => $dfParser( $match )->format( 'Y-m-d\TH:i:s.v\Z' ),
					'author' => $author,
					'range' => $range,
					'signatureRanges' => [ $sigRange ],
					// Should this use the indent level of $startNode or $node?
					'level' => min( $startLevel, $endLevel )
				];
				$comments[] = $curComment;
				$nextTimestamp++;
			}
		}

		// Insert the fake placeholder heading if there are any comments in the 0th section
		// (before the first real heading)
		if ( count( $comments ) && $comments[ 0 ]->type !== 'heading' ) {
			array_unshift( $comments, $fakeHeading );
		}

		return $comments;
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
	 *       [ 'type' => 'heading', 'level' => 0, 'range' => (h2: A), 'replies' => [
	 *         [ 'type' => 'comment', 'level' => 1, 'range' => (p: B), 'replies' => [
	 *           [ 'type' => 'comment', 'level' => 2, 'range' => (li: C, li: C), 'replies' => [
	 *             [ 'type' => 'comment', 'level' => 3, 'range' => (li: D), 'replies' => [
	 *               [ 'type' => 'comment', 'level' => 4, 'range' => (li: E), 'replies' => [] ],
	 *               [ 'type' => 'comment', 'level' => 4, 'range' => (li: F), 'replies': [] ],
	 *             ] ],
	 *           ] ],
	 *           [ 'type' => 'comment', 'level' => 2, 'range' => (li: G), 'replies' => [] ],
	 *         ] ],
	 *         [ 'type' => 'comment', 'level' => 1, 'range' => (p: H), 'replies' => [
	 *           [ 'type' => 'comment', 'level' => 2, 'range' => (li: I), 'replies' => [] ],
	 *         ] ],
	 *       ] ],
	 *     ]
	 *
	 * @param stdClass[] &$comments Result of #getComments, will be modified to add more properties
	 * @return stdClass[] Tree structure of comments, using the same objects as `comments`. Top-level
	 *   items are the headings. The following properties are added:
	 *   - id: Unique ID (within the page) for this comment, intended to be used to
	 *         find this comment in other revisions of the same page
	 *   - replies: Comment objects which are replies to this comment
	 *   - parent: Comment object which this is a reply to (null for headings)
	 */
	public function groupThreads( array &$comments ) : array {
		$threads = [];
		$replies = [];
		$commentsById = [];

		foreach ( $comments as &$comment ) {
			if ( $comment->level === 0 ) {
				// We don't need ids for section headings right now, but we might in the future
				// e.g. if we allow replying directly to sections (adding top-level comments)
				$id = null;
			} else {
				$id = ( $comment->author ?? '' ) . '|' . $comment->timestamp;

				// If there would be multiple comments with the same ID (i.e. the user left multiple comments
				// in one edit, or within a minute), append sequential numbers
				$number = 0;
				while ( isset( $commentsById["$id|$number"] ) ) {
					$number++;
				}
				$id = "$id|$number";
			}
			if ( $id !== null ) {
				$commentsById[$id] = $comment;
			}

			// This modifies the original objects in $comments!
			$comment->id = $id;
			$comment->replies = [];
			$comment->parent = null;

			if ( count( $replies ) < $comment->level ) {
				// Someone skipped an indentation level (or several). Pretend that the previous reply
				// covers multiple indentation levels, so that following comments get connected to it.
				// TODO warn: 'Comment skips indentation level'
				while ( count( $replies ) < $comment->level ) {
					// FIXME this will clone the reply, not just set a reference
					$replies[] = end( $replies );
				}
			}

			if ( $comment->level === 0 ) {
				// New root (thread)
				$threads[] = $comment;
			} elseif ( isset( $replies[ $comment->level - 1 ] ) ) {
				// Add as a reply to the closest less-nested comment
				$comment->parent = $replies[ $comment->level - 1 ];
				$comment->parent->replies[] = $comment;
			} else {
				// TODO warn: 'Comment could not be connected to a thread'
			}

			$replies[ $comment->level ] = $comment;
			// Cut off more deeply nested replies
			// TODO look up if there's a more convenient function to truncate arrays
			array_splice( $replies, $comment->level + 1, count( $replies ) - $comment->level - 1 );
		}

		return $threads;
	}

	/**
	 * Get the list of authors involved in a comment and its replies.
	 *
	 * You probably want to pass a thread root here (a heading).
	 *
	 * @param stdClass $comment Comment object, as returned by #groupThreads
	 * @return string[] Author usernames
	 */
	public function getAuthors( stdClass $comment ) : array {
		$authors = [];
		$getAuthorSet = function ( $comment ) use ( &$authors, &$getAuthorSet ) {
			if ( $comment->author ?? false ) {
				$authors[ $comment->author ] = true;
			}
			// Get the set of authors in the same format from each reply
			array_map( $getAuthorSet, $comment->replies );
		};

		$getAuthorSet( $comment );

		ksort( $authors );
		return array_keys( $authors );
	}

	/**
	 * Get the name of the page from which this comment is transcluded (if any).
	 *
	 * @param stdClass $comment Comment object, as returned by #groupThreads
	 * @return string|bool `false` if this comment is not transcluded. A string if it's transcluded
	 *   from a single page (the page title, in text form with spaces). `true` if it's transcluded, but
	 *   we can't determine the source.
	 */
	public function getTranscludedFrom( stdClass $comment ) {
		// If some template is used within the comment (e.g. {{ping|…}} or {{tl|…}}), that *does not* mean
		// the comment is transcluded. We only want to consider comments to be transcluded if the wrapper
		// element (usually <li> or <p>) is marked as part of a transclusion.
		// TODO: This seems to work fine but I'm having a hard time explaining why it is correct...
		$node = $comment->range->endContainer;

		// Find the node containing information about the transclusion:
		// 1. Find the closest ancestor with an 'about' attribute
		// 2. Find the main node of the about-group (first sibling with the same 'about' attribute)
		// 3. If this is an mw:Transclusion node, return it; otherwise, go to step 1
		while ( $node ) {
			// 1.
			if (
				$node->nodeType === XML_ELEMENT_NODE &&
				$node->getAttribute( 'about' ) &&
				preg_match( '/^#mwt\d+$/', $node->getAttribute( 'about' ) )
			) {
				$about = $node->getAttribute( 'about' );

				// 2.
				while (
					$node->previousSibling &&
					$node->previousSibling->nodeType === XML_ELEMENT_NODE &&
					$node->previousSibling->getAttribute( 'about' ) === $about
				) {
					$node = $node->previousSibling;
				}

				// 3.
				if (
					$node->getAttribute( 'typeof' ) &&
					inArray( 'mw:Transclusion', explode( ' ', $node->getAttribute( 'typeof' ) ) )
				) {
					break;
				}
			}

			$node = $node->parentNode;
		}

		if ( !$node ) {
			// No mw:Transclusion node found, this comment is not transcluded
			return false;
		}

		$dataMw = json_decode( $node->getAttribute( 'data-mw' ), true );

		// Only return a page name if this is a simple single-template transclusion.
		if (
			$dataMw['parts'] &&
			count( $dataMw['parts'] ) === 1 &&
			$dataMw['parts'][0]['template'] &&
			$dataMw['parts'][0]['template']['target']['href']
		) {
			// TODO: Slice off the './' prefix and convert to text form (underscores to spaces, URL-decoded)
			return $dataMw['parts'][0]['template']['target']['href'];
		}

		// Multi-template transclusion, or a parser function call, or template-affected wikitext outside
		// of a template call, or a mix of the above
		return true;
	}
}
