'use strict';
/* global $:off */

/**
 * @external ThreadItem
 */

var
	utils = require( './utils.js' ),
	codePointLength = require( 'mediawiki.String' ).codePointLength,
	CommentItem = require( './CommentItem.js' ),
	HeadingItem = require( './HeadingItem.js' ),
	// Hooks::getLocalData()
	data = require( './parser/data.json' ),
	moment = require( './lib/moment-timezone/moment-timezone-with-data-1970-2030.js' );

/**
 * Utilities for detecting and parsing components of discussion pages: signatures, timestamps,
 * comments and threads.
 *
 * @class mw.dt.Parser
 */

function Parser( rootNode ) {
	this.rootNode = rootNode;
	this.threadItems = null;
	this.commentItems = null;
	this.threadItemsById = null;
	this.threads = null;
}

OO.initClass( Parser );

/**
 * Get text of localisation messages in content language.
 *
 * @private
 * @param {string} contLangVariant Content language variant
 * @param {string[]} messages Message keys
 * @return {string[]} Message values
 */
function getMessages( contLangVariant, messages ) {
	return messages.map( function ( code ) {
		return data.contLangMessages[ contLangVariant ][ code ];
	} );
}

/**
 * Get a regexp that matches timestamps generated using the given date format.
 *
 * This only supports format characters that are used by the default date format in any of
 * MediaWiki's languages, namely: D, d, F, G, H, i, j, l, M, n, Y, xg, xkY (and escape characters),
 * and only dates when MediaWiki existed, let's say 2000 onwards (Thai dates before 1941 are
 * complicated).
 *
 * @private
 * @param {string} contLangVariant Content language variant
 * @param {string} format Date format, as used by MediaWiki
 * @param {string} digitsRegexp Regular expression matching a single localised digit, e.g. `[0-9]`
 * @param {Object} tzAbbrs Map of localised timezone abbreviations to IANA abbreviations
 *   for the local timezone, e.g. `{EDT: "EDT", EST: "EST"}`
 * @return {string} Regular expression
 */
Parser.prototype.getTimestampRegexp = function ( contLangVariant, format, digitsRegexp, tzAbbrs ) {
	var s, p, num, code, endQuote, tzRegexp, regexp;

	function regexpGroup( r ) {
		return '(' + r + ')';
	}

	function regexpAlternateGroup( array ) {
		return '(' + array.map( mw.util.escapeRegExp ).join( '|' ) + ')';
	}

	s = '';
	// Adapted from Language::sprintfDate()
	for ( p = 0; p < format.length; p++ ) {
		num = false;
		code = format[ p ];
		if ( code === 'x' && p < format.length - 1 ) {
			code += format[ ++p ];
		}
		if ( code === 'xk' && p < format.length - 1 ) {
			code += format[ ++p ];
		}

		switch ( code ) {
			case 'xx':
				s += 'x';
				break;
			case 'xg':
				s += regexpAlternateGroup( getMessages( contLangVariant, [
					'january-gen', 'february-gen', 'march-gen', 'april-gen', 'may-gen', 'june-gen',
					'july-gen', 'august-gen', 'september-gen', 'october-gen', 'november-gen',
					'december-gen'
				] ) );
				break;
			case 'd':
				num = '2';
				break;
			case 'D':
				s += regexpAlternateGroup( getMessages( contLangVariant, [
					'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'
				] ) );
				break;
			case 'j':
				num = '1,2';
				break;
			case 'l':
				s += regexpAlternateGroup( getMessages( contLangVariant, [
					'sunday', 'monday', 'tuesday', 'wednesday', 'thursday',
					'friday', 'saturday'
				] ) );
				break;
			case 'F':
				s += regexpAlternateGroup( getMessages( contLangVariant, [
					'january', 'february', 'march', 'april', 'may_long', 'june',
					'july', 'august', 'september', 'october', 'november',
					'december'
				] ) );
				break;
			case 'M':
				s += regexpAlternateGroup( getMessages( contLangVariant, [
					'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug',
					'sep', 'oct', 'nov', 'dec'
				] ) );
				break;
			case 'n':
				num = '1,2';
				break;
			case 'Y':
				num = '4';
				break;
			case 'xkY':
				num = '4';
				break;
			case 'G':
				num = '1,2';
				break;
			case 'H':
				num = '2';
				break;
			case 'i':
				num = '2';
				break;
			case '\\':
				// Backslash escaping
				if ( p < format.length - 1 ) {
					s += mw.util.escapeRegExp( format[ ++p ] );
				} else {
					s += mw.util.escapeRegExp( '\\' );
				}
				break;
			case '"':
				// Quoted literal
				if ( p < format.length - 1 ) {
					endQuote = format.indexOf( '"', p + 1 );
					if ( endQuote === -1 ) {
						// No terminating quote, assume literal "
						s += '"';
					} else {
						s += mw.util.escapeRegExp( format.substr( p + 1, endQuote - p - 1 ) );
						p = endQuote;
					}
				} else {
					// Quote at end of string, assume literal "
					s += '"';
				}
				break;
			default:
				s += mw.util.escapeRegExp( format[ p ] );
		}
		if ( num !== false ) {
			s += regexpGroup( digitsRegexp + '{' + num + '}' );
		}
	}

	tzRegexp = regexpAlternateGroup( Object.keys( tzAbbrs ) );
	// Hard-coded parentheses and space like in Parser::pstPass2
	// Ignore some invisible Unicode characters that often sneak into copy-pasted timestamps (T245784)
	regexp = s + '[\\u200E\\u200F]? [\\u200E\\u200F]?\\(' + tzRegexp + '\\)';

	return regexp;
};

/**
 * Get a function that parses timestamps generated using the given date format, based on the result
 * of matching the regexp returned by #getTimestampRegexp.
 *
 * @private
 * @param {string} contLangVariant Content language variant
 * @param {string} format Date format, as used by MediaWiki
 * @param {string[]|null} digits Localised digits from 0 to 9, e.g. `[ '0', '1', ..., '9' ]`
 * @param {string} localTimezone Local timezone IANA name, e.g. `America/New_York`
 * @param {Object} tzAbbrs Map of localised timezone abbreviations to IANA abbreviations
 *   for the local timezone, e.g. `{EDT: "EDT", EST: "EST"}`
 * @return {TimestampParser} Timestamp parser function
 */
Parser.prototype.getTimestampParser = function ( contLangVariant, format, digits, localTimezone, tzAbbrs ) {
	var p, code, endQuote, matchingGroups = [];
	for ( p = 0; p < format.length; p++ ) {
		code = format[ p ];
		if ( code === 'x' && p < format.length - 1 ) {
			code += format[ ++p ];
		}
		if ( code === 'xk' && p < format.length - 1 ) {
			code += format[ ++p ];
		}

		switch ( code ) {
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
				matchingGroups.push( code );
				break;
			case '\\':
				// Backslash escaping
				if ( p < format.length - 1 ) {
					++p;
				}
				break;
			case '"':
				// Quoted literal
				if ( p < format.length - 1 ) {
					endQuote = format.indexOf( '"', p + 1 );
					if ( endQuote !== -1 ) {
						p = endQuote;
					}
				}
				break;
			default:
				break;
		}
	}

	function untransformDigits( text ) {
		if ( !digits ) {
			return text;
		}
		return text.replace(
			new RegExp( '[' + digits.join( '' ) + ']', 'g' ),
			function ( m ) {
				return digits.indexOf( m );
			}
		);
	}

	/**
	 * @typedef {function(Array):moment} TimestampParser
	 */

	/**
	 * Timestamp parser
	 *
	 * @param {Array} match RegExp match data
	 * @return {moment} Moment date object
	 */
	return function timestampParser( match ) {
		var
			year = 0,
			monthIdx = 0,
			day = 0,
			hour = 0,
			minute = 0,
			tzAbbr,
			i, code2, text,
			date;
		for ( i = 0; i < matchingGroups.length; i++ ) {
			code2 = matchingGroups[ i ];
			text = match[ i + 1 ];

			switch ( code2 ) {
				case 'xg':
					monthIdx = getMessages( contLangVariant, [
						'january-gen', 'february-gen', 'march-gen', 'april-gen', 'may-gen', 'june-gen',
						'july-gen', 'august-gen', 'september-gen', 'october-gen', 'november-gen',
						'december-gen'
					] ).indexOf( text );
					break;
				case 'd':
				case 'j':
					day = Number( untransformDigits( text ) );
					break;
				case 'D':
				case 'l':
					// Day of the week - unused
					break;
				case 'F':
					monthIdx = getMessages( contLangVariant, [
						'january', 'february', 'march', 'april', 'may_long', 'june',
						'july', 'august', 'september', 'october', 'november',
						'december'
					] ).indexOf( text );
					break;
				case 'M':
					monthIdx = getMessages( contLangVariant, [
						'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug',
						'sep', 'oct', 'nov', 'dec'
					] ).indexOf( text );
					break;
				case 'n':
					monthIdx = Number( untransformDigits( text ) ) - 1;
					break;
				case 'Y':
					year = Number( untransformDigits( text ) );
					break;
				case 'xkY':
					// Thai year
					year = Number( untransformDigits( text ) ) - 543;
					break;
				case 'G':
				case 'H':
					hour = Number( untransformDigits( text ) );
					break;
				case 'i':
					minute = Number( untransformDigits( text ) );
					break;
				default:
					throw new Error( 'Not implemented' );
			}
		}
		// The last matching group is the timezone abbreviation
		tzAbbr = tzAbbrs[ match[ match.length - 1 ] ];

		// Most of the time, the timezone abbreviation is not necessary to parse the date, since we
		// can assume all times are in the wiki's local timezone.
		date = moment.tz( [ year, monthIdx, day, hour, minute ], localTimezone );

		// But during the "fall back" at the end of DST, some times will happen twice. Per the docs,
		// "Moment Timezone handles this by always using the earlier instance of a duplicated hour."
		// https://momentjs.com/timezone/docs/#/using-timezones/parsing-ambiguous-inputs/

		// Since the timezone abbreviation disambiguates the DST/non-DST times, we can detect when
		// that behavior was incorrect...
		if ( date.zoneAbbr() !== tzAbbr ) {
			// ...and force the correct parsing. I can't find proper documentation for this feature,
			// but this pull request explains it: https://github.com/moment/moment-timezone/pull/101
			moment.tz.moveAmbiguousForward = true;
			date = moment.tz( [ year, monthIdx, day, hour, minute ], localTimezone );
			moment.tz.moveAmbiguousForward = false;
			if ( date.zoneAbbr() !== tzAbbr ) {
				// This should not be possible for "genuine" timestamps generated by MediaWiki.
				// But bots and humans get it wrong when marking up unsigned comments…
				// https://pl.wikipedia.org/w/index.php?title=Wikipedia:Kawiarenka/Artykuły&diff=prev&oldid=54772606
				date.discussionToolsWarning = 'Timestamp has timezone abbreviation for the wrong time';
			} else {
				date.discussionToolsWarning = 'Ambiguous time at DST switchover was parsed';
			}
		}

		return date;
	};
};

/**
 * Get a regexp that matches timestamps in the local date format, for each language variant.
 *
 * This calls #getTimestampRegexp with predefined data for the current wiki.
 *
 * @private
 * @return {string[]} Regular expressions
 */
Parser.prototype.getLocalTimestampRegexps = function () {
	var parser = this;
	return Object.keys( data.dateFormat ).map( function ( contLangVariant ) {
		return parser.getTimestampRegexp(
			contLangVariant,
			data.dateFormat[ contLangVariant ],
			'[' + data.digits[ contLangVariant ].join( '' ) + ']',
			data.timezones[ contLangVariant ]
		);
	} );
};

/**
 * Get a function that parses timestamps in the local date format, for each language variant,
 * based on the result of matching the regexps returned by #getLocalTimestampRegexps.
 *
 * This calls #getTimestampParser with predefined data for the current wiki.
 *
 * @private
 * @return {TimestampParser[]} Timestamp parser functions
 */
Parser.prototype.getLocalTimestampParsers = function () {
	var parser = this;
	return Object.keys( data.dateFormat ).map( function ( contLangVariant ) {
		return parser.getTimestampParser(
			contLangVariant,
			data.dateFormat[ contLangVariant ],
			data.digits[ contLangVariant ],
			data.localTimezone,
			data.timezones[ contLangVariant ]
		);
	} );
};

/**
 * Callback for document.createTreeWalker that will skip over nodes where we don't want to detect
 * comments (or section headings).
 *
 * @param {Node} node
 * @return {number} Appropriate NodeFilter constant
 */
function acceptOnlyNodesAllowingComments( node ) {
	// The table of contents has a heading that gets erroneously detected as a section
	if ( node.id === 'toc' ) {
		return NodeFilter.FILTER_REJECT;
	}
	return NodeFilter.FILTER_ACCEPT;
}

/**
 * Find a timestamp in a given text node
 *
 * @private
 * @param {Text} node Text node
 * @param {string[]} timestampRegexps Timestamp regexps
 * @return {Object|null} Object with the following keys:
 *   - {number} offset Length of extra text preceding the node that was used for matching
 *   - {number} parserIndex Which of the regexps matched
 *   - {Array} matchData Regexp match data, which specifies the location of the match,
 *     and which can be parsed using #getLocalTimestampParsers
 */
Parser.prototype.findTimestamp = function ( node, timestampRegexps ) {
	var matchData, i,
		nodeText = '',
		offset = 0;
	while ( node ) {
		nodeText = node.nodeValue + nodeText;

		// In Parsoid HTML, entities are represented as a 'mw:Entity' node, rather than normal HTML
		// entities. On Arabic Wikipedia, the "UTC" timezone name contains some non-breaking spaces,
		// which apparently are often turned into &nbsp; entities by buggy editing tools. To handle
		// this, we must piece together the text, so that our regexp can match those timestamps.
		if (
			node.previousSibling &&
			node.previousSibling.nodeType === Node.ELEMENT_NODE &&
			node.previousSibling.getAttribute( 'typeof' ) === 'mw:Entity'
		) {
			nodeText = node.previousSibling.firstChild.nodeValue + nodeText;
			offset += node.previousSibling.firstChild.nodeValue.length;

			// If the entity is followed by more text, do this again
			if (
				node.previousSibling.previousSibling &&
				node.previousSibling.previousSibling.nodeType === Node.TEXT_NODE
			) {
				offset += node.previousSibling.previousSibling.nodeValue.length;
				node = node.previousSibling.previousSibling;
			} else {
				node = null;
			}
		} else {
			node = null;
		}
	}

	for ( i = 0; i < timestampRegexps.length; i++ ) {
		// Technically, there could be multiple matches in a single text node. However, the ultimate
		// point of this is to find the signatures which precede the timestamps, and any later
		// timestamps in the text node can't be directly preceded by a signature (as we require them to
		// have links), so we only concern ourselves with the first match.
		matchData = nodeText.match( timestampRegexps[ i ] );
		if ( matchData ) {
			return {
				matchData: matchData,
				offset: offset,
				parserIndex: i
			};
		}
	}
	return null;
};

/**
 * Get a MediaWiki page title from a URL.
 *
 * @private
 * @param {string} url
 * @return {mw.Title|null} Page title, or null if this isn't a link to a page
 */
function getTitleFromUrl( url ) {
	var articlePathRegexp, match;

	try {
		url = new mw.Uri( url );
	} catch ( err ) {
		// T106244: URL encoded values using fallback 8-bit encoding (invalid UTF-8) cause mediawiki.Uri to crash
		return null;
	}
	if ( url.query.title ) {
		return mw.Title.newFromText( url.query.title );
	}

	articlePathRegexp = new RegExp(
		mw.util.escapeRegExp( mw.config.get( 'wgArticlePath' ) )
			.replace( mw.util.escapeRegExp( '$1' ), '(.*)' )
	);
	if ( ( match = url.path.match( articlePathRegexp ) ) ) {
		return mw.Title.newFromText( decodeURIComponent( match[ 1 ] ) );
	}

	return null;
}

/**
 * Find a user signature preceding a timestamp.
 *
 * The signature includes the timestamp node.
 *
 * A signature must contain at least one link to the user's userpage, discussion page or
 * contributions (and may contain other links). The link may be nested in other elements.
 *
 * @private
 * @param {Text} timestampNode Text node
 * @param {Node} [until] Node to stop searching at
 * @return {Array} Result, a tuple contaning:
 *  - {Node[]} Sibling nodes comprising the signature, in reverse order (with
 *   `timestampNode` or its parent node as the first element)
 *  - {string|null} Username, null for unsigned comments
 */
Parser.prototype.findSignature = function ( timestampNode, until ) {
	var node, sigNodes, sigUsername, length, lastLinkNode, links, nodes;

	// Support timestamps being linked to the diff introducing the comment:
	// if the timestamp node is the only child of a link node, use the link node instead
	if (
		!timestampNode.previousSibling && !timestampNode.nextSibling &&
		timestampNode.parentNode.nodeName.toLowerCase() === 'a'
	) {
		timestampNode = timestampNode.parentNode;
	}

	node = timestampNode;
	sigNodes = [ node ];
	sigUsername = null;
	length = 0;
	lastLinkNode = timestampNode;

	while ( ( node = node.previousSibling ) && length < data.signatureScanLimit && node !== until ) {
		sigNodes.push( node );
		length += node.textContent ? codePointLength( node.textContent ) : 0;
		if ( node.nodeType !== Node.ELEMENT_NODE ) {
			continue;
		}
		links = [];
		if ( node.tagName.toLowerCase() === 'a' ) {
			links.push( node );
		} else {
			// Handle links nested in formatting elements.
			// Helpful accidental feature: users whose signature is not detected in full (due to
			// text formatting) can just wrap it in a <span> to fix that.
			// "Ten Pound Hammer • (What did I screw up now?)"
			// "« Saper // dyskusja »"
			nodes = node.getElementsByTagName( 'a' );
			links.push.apply( links, nodes );
		}
		if ( !links.length ) {
			continue;
		}
		// Find the closest link before timestamp that links to the user's user page.
		// Use .some() rather than .every() to permit vanity links
		// "TonyTheTiger (T / C / WP:FOUR / WP:CHICAGO / WP:WAWARD)"
		// eslint-disable-next-line no-loop-func
		if ( links.reverse().some( function ( link ) {
			var username, title;
			title = getTitleFromUrl( link.href );
			if ( !title ) {
				return false;
			}
			if (
				title.getNamespaceId() === mw.config.get( 'wgNamespaceIds' ).user ||
				title.getNamespaceId() === mw.config.get( 'wgNamespaceIds' ).user_talk
			) {
				username = title.getMainText();
				if ( username.indexOf( '/' ) !== -1 ) {
					return false;
				}
			} else if (
				title.getNamespaceId() === mw.config.get( 'wgNamespaceIds' ).special &&
				title.getMainText().split( '/' )[ 0 ] === data.specialContributionsName
			) {
				username = title.getMainText().split( '/' )[ 1 ];
				// Normalize the username: users may link to their contributions with an unnormalized name
				username = mw.Title.makeTitle( mw.config.get( 'wgNamespaceIds' ).user, username ).getMainText();
			}
			if ( !username ) {
				return false;
			}
			if ( mw.util.isIPv6Address( username ) ) {
				// Bot-generated links "Preceding unsigned comment added by" have non-standard case
				username = username.toUpperCase();
			}

			// Accept the first link to the user namespace, then only accept links to that user
			if ( !sigUsername ) {
				sigUsername = username;
			}
			return username === sigUsername;
		} ) ) {
			lastLinkNode = node;
		}
		// Keep looking if a node with links wasn't a link to a user page
		// "Doc James (talk · contribs · email)"
	}
	// Pop excess text nodes
	while ( sigNodes[ sigNodes.length - 1 ] !== lastLinkNode ) {
		sigNodes.pop();
	}
	return [ sigNodes, sigUsername ];
};

/**
 * Return the next leaf node in the tree order that is likely a part of a discussion comment,
 * rather than some boring "separator" element.
 *
 * Currently, this can return a Text node with content other than whitespace, or an `<img>` node.
 *
 * @private
 * @param {Node} node Node to start searching at. If it isn't a leaf node, its children are ignored.
 * @return {Node}
 */
Parser.prototype.nextInterestingLeafNode = function ( node ) {
	var treeWalker,
		rootNode = this.rootNode;

	treeWalker = rootNode.ownerDocument.createTreeWalker(
		rootNode,
		// eslint-disable-next-line no-bitwise
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		function ( n ) {
			// Ignore this node and its descendants
			// (unless it's the root node, this is a special case for "fakeHeading" handling)
			if ( node !== rootNode && ( n === node || n.parentNode === node ) ) {
				return NodeFilter.FILTER_REJECT;
			}
			if (
				( n.nodeType === Node.TEXT_NODE && utils.htmlTrim( n.textContent ) !== '' ) ||
				( n.nodeType === Node.CDATA_SECTION_NODE && utils.htmlTrim( n.textContent ) !== '' ) ||
				( n.nodeType === Node.ELEMENT_NODE && n.nodeName.toLowerCase() === 'img' )
			) {
				return NodeFilter.FILTER_ACCEPT;
			}
			return NodeFilter.FILTER_SKIP;
		},
		false
	);
	treeWalker.currentNode = node;
	treeWalker.nextNode();
	if ( !treeWalker.currentNode ) {
		throw new Error( 'nextInterestingLeafNode not found' );
	}
	return treeWalker.currentNode;
};

/**
 * Get all discussion comments (and headings) within a DOM subtree.
 *
 * This returns a flat list, use #getThreads to get a tree structure starting at section headings.
 *
 * For example, for a MediaWiki discussion like this (we're dealing with HTML DOM here, the wikitext
 * syntax is just for illustration):
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
 * @param {HTMLElement} rootNode
 * @return {ThreadItem[]} Thread items
 */
Parser.prototype.getThreadItems = function () {
	if ( !this.threadItems ) {
		this.buildThreads();
	}
	return this.threadItems;
};

/**
 * Same as getFlatThreadItems, but only returns the CommentItems
 *
 * @return {CommentItem[]} Comment items
 */
Parser.prototype.getCommentItems = function () {
	if ( !this.commentItems ) {
		this.buildThreads();
	}
	return this.commentItems;
};

/**
 * Find a ThreadItem by its ID
 *
 * @param {string} id ID
 * @return {ThreadItem|null} Thread item, null if not found
 */
Parser.prototype.findCommentById = function ( id ) {
	if ( !this.threadItemsById ) {
		this.buildThreads();
	}
	return this.threadItemsById[ id ] || null;
};

Parser.prototype.buildThreadItems = function () {
	var
		dfParsers = this.getLocalTimestampParsers(),
		timestampRegexps = this.getLocalTimestampRegexps(),
		commentItems = [],
		threadItems = [],
		treeWalker,
		node, range, fakeHeading, curComment, headingNodeAndOffset, headingNode, startOffset,
		foundSignature, firstSigNode, lastSigNode, sigRange, author, startNode, endNode, length,
		match, lastSigNodeOffset, startLevel, endLevel, level, dateTime, warnings;

	treeWalker = this.rootNode.ownerDocument.createTreeWalker(
		this.rootNode,
		// eslint-disable-next-line no-bitwise
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		acceptOnlyNodesAllowingComments,
		false
	);

	// Placeholder heading in case there are comments in the 0th section
	range = {
		startContainer: this.rootNode,
		startOffset: 0,
		endContainer: this.rootNode,
		endOffset: 0
	};
	fakeHeading = new HeadingItem( range, 99, true );
	fakeHeading.rootNode = this.rootNode;

	curComment = fakeHeading;

	while ( ( node = treeWalker.nextNode() ) ) {
		if ( node.tagName && ( match = node.tagName.match( /^h([1-6])$/i ) ) ) {
			headingNodeAndOffset = this.getHeadlineNodeAndOffset( node );
			headingNode = headingNodeAndOffset.node;
			startOffset = headingNodeAndOffset.offset;
			range = {
				startContainer: headingNode,
				startOffset: startOffset,
				endContainer: headingNode,
				endOffset: headingNode.childNodes.length
			};
			curComment = new HeadingItem( range, +match[ 1 ] );
			curComment.rootNode = this.rootNode;
			threadItems.push( curComment );
		} else if ( node.nodeType === Node.TEXT_NODE && ( match = this.findTimestamp( node, timestampRegexps ) ) ) {
			warnings = [];
			foundSignature = this.findSignature( node, lastSigNode );
			author = foundSignature[ 1 ];
			firstSigNode = foundSignature[ 0 ][ foundSignature[ 0 ].length - 1 ];
			lastSigNode = foundSignature[ 0 ][ 0 ];

			if ( !author ) {
				// Ignore timestamps for which we couldn't find a signature. It's probably not a real
				// comment, but just a false match due to a copypasted timestamp.
				continue;
			}

			lastSigNodeOffset = lastSigNode === node ?
				match.matchData.index + match.matchData[ 0 ].length - match.offset :
				utils.childIndexOf( lastSigNode ) + 1;
			sigRange = {
				startContainer: firstSigNode.parentNode,
				startOffset: utils.childIndexOf( firstSigNode ),
				endContainer: lastSigNode === node ? node : lastSigNode.parentNode,
				endOffset: lastSigNodeOffset
			};

			// Everything from the last comment up to here is the next comment
			startNode = this.nextInterestingLeafNode( curComment.range.endContainer );
			endNode = lastSigNode;
			// Skip to the end of the "paragraph". This only looks at tag names and can be fooled by CSS, but
			// avoiding that would be more difficult and slower.
			while ( endNode.nextSibling && !( endNode.nextSibling instanceof HTMLElement && ve.isBlockElement( endNode.nextSibling ) ) ) {
				endNode = endNode.nextSibling;
			}

			if ( endNode === lastSigNode ) {
				range = {
					startContainer: startNode.parentNode,
					startOffset: utils.childIndexOf( startNode ),
					endContainer: sigRange.endContainer,
					endOffset: sigRange.endOffset
				};
			} else {
				length = endNode.nodeType === Node.TEXT_NODE ?
					endNode.textContent.replace( /[\t\n\f\r ]+$/, '' ).length :
					endNode.childNodes.length;
				range = {
					startContainer: startNode.parentNode,
					startOffset: utils.childIndexOf( startNode ),
					endContainer: endNode,
					endOffset: length
				};
			}

			startLevel = utils.getIndentLevel( startNode, this.rootNode ) + 1;
			endLevel = utils.getIndentLevel( node, this.rootNode ) + 1;
			if ( startLevel !== endLevel ) {
				warnings.push( 'Comment starts and ends with different indentation' );
			}
			// Should this use the indent level of `startNode` or `node`?
			level = Math.min( startLevel, endLevel );

			dateTime = dfParsers[ match.parserIndex ]( match.matchData );
			if ( dateTime.discussionToolsWarning ) {
				warnings.push( dateTime.discussionToolsWarning );
			}

			// Avoid generating multiple comments when there is more than one signature on a single "line".
			// Often this is done when someone edits their comment later and wants to add a note about that.
			// (Or when another person corrects a typo, or strikes out a comment, etc.) Multiple comments
			// within one paragraph/list-item result in a confusing double "Reply" button, and we also have
			// no way to indicate which one you're replying to (this might matter in the future for
			// notifications or something).
			if (
				curComment instanceof CommentItem &&
				( utils.closestElement( node, [ 'li', 'dd', 'p' ] ) || node.parentNode ) ===
					( utils.closestElement( curComment.range.endContainer, [ 'li', 'dd', 'p' ] ) || curComment.range.endContainer.parentNode )
			) {
				// Merge this with the previous comment. Use that comment's author and timestamp.
				curComment.signatureRanges.push( sigRange );

				if (
					curComment.range.endContainer === range.endContainer &&
					curComment.range.endOffset <= range.endOffset
				) {
					// We've already skipped over this signature, and the `range` and `level` are messed up,
					// because that causes `startNode` to be after `endNode`
					continue;
				}

				curComment.range.endContainer = range.endContainer;
				curComment.range.endOffset = range.endOffset;
				curComment.level = Math.min( level, curComment.level );

				continue;
			}

			curComment = new CommentItem(
				level,
				range,
				[ sigRange ],
				dateTime,
				author
			);
			curComment.rootNode = this.rootNode;
			if ( warnings.length ) {
				curComment.warnings = warnings;
			}
			commentItems.push( curComment );
			threadItems.push( curComment );
		}
	}

	// Insert the fake placeholder heading if there are any comments in the 0th section
	// (before the first real heading)
	if ( threadItems.length && !( threadItems[ 0 ] instanceof HeadingItem ) ) {
		threadItems.unshift( fakeHeading );
	}

	this.commentItems = commentItems;
	this.threadItems = threadItems;
};

/**
 * Group discussion comments into threads and associate replies to original messages.
 *
 * Each thread must begin with a heading. Original messages in the thread are treated as replies to
 * its heading. Other replies are associated based on the order and indentation level.
 *
 * Note that the objects in `comments` are extended in-place with the additional data.
 *
 * For example, for a MediaWiki discussion like this (we're dealing with HTML DOM here, the wikitext
 * syntax is just for illustration):
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
 * @return {HeadingItem[]} Tree structure of comments, top-level items are the headings.
 */
Parser.prototype.getThreads = function () {
	if ( !this.threads ) {
		this.buildThreads();
	}
	return this.threads;
};

/**
 * Given a heading node, return the node on which the ID attribute is set.
 *
 * Also returns the offset within that node where the heading text starts.
 *
 * @param {HTMLElement} heading Heading node (`<h1>`-`<h6>`)
 * @return {Array} Array containing a 'node' (HTMLElement) and offset (number)
 */
Parser.prototype.getHeadlineNodeAndOffset = function ( heading ) {
	// This code assumes that $wgFragmentMode is [ 'html5', 'legacy' ] or [ 'html5' ]
	var headline = heading,
		offset = 0;

	if ( headline.getAttribute( 'data-mw-comment-start' ) ) {
		headline = headline.parentNode;
	}

	if ( !headline.getAttribute( 'id' ) ) {
		// PHP HTML: Find the child with .mw-headline
		headline = headline.querySelector( '.mw-headline' );
		if ( headline ) {
			if ( headline.querySelector( '.mw-headline-number' ) ) {
				offset = 1;
			}
		} else {
			headline = heading;
		}
	}

	return {
		node: headline,
		offset: offset
	};
};

/**
 * Given a thread item, return an identifier for it that is unique within the page.
 *
 * @param {ThreadItem} threadItem
 * @return {string|null}
 */
Parser.prototype.computeId = function ( threadItem ) {
	var id, number, headline, threadItemParent, timestamp;

	if ( threadItem instanceof HeadingItem && threadItem.placeholderHeading ) {
		// The range points to the root note, using it like below results in silly values
		id = 'h|';
	} else if ( threadItem instanceof HeadingItem ) {
		headline = this.getHeadlineNodeAndOffset( threadItem.range.startContainer ).node;
		id = 'h|' + ( headline.getAttribute( 'id' ) || '' );
	} else if ( threadItem instanceof CommentItem ) {
		id = 'c|' + ( threadItem.author || '' ) + '|' + threadItem.timestamp.toISOString();
	} else {
		throw new Error( 'Unknown ThreadItem type' );
	}

	// If there would be multiple comments with the same ID (i.e. the user left multiple comments
	// in one edit, or within a minute), append sequential numbers
	threadItemParent = threadItem.parent;
	if ( threadItemParent instanceof HeadingItem && !threadItemParent.placeholderHeading ) {
		headline = this.getHeadlineNodeAndOffset( threadItemParent.range.startContainer ).node;
		id += '|' + ( headline.getAttribute( 'id' ) || '' );
	} else if ( threadItemParent instanceof CommentItem ) {
		id += '|' + ( threadItemParent.author || '' ) + '|' + threadItemParent.timestamp.toISOString();
	}

	if ( threadItem instanceof HeadingItem ) {
		// To avoid old threads re-appearing on popular pages when someone uses a vague title
		// (e.g. dozens of threads titled "question" on [[Wikipedia:Help desk]]: https://w.wiki/fbN),
		// include the oldest timestamp in the thread (i.e. date the thread was started) in the
		// heading ID.
		timestamp = this.getThreadStartTimestamp( threadItem );
		if ( timestamp ) {
			id += '|' + timestamp.toISOString();
		}
	}

	if ( this.threadItemsById[ id ] ) {
		// Well, that's tough
		threadItem.warnings.push( 'Duplicate comment ID' );
		// Finally, disambiguate by adding sequential numbers, to allow replying to both comments
		number = 1;
		while ( this.threadItemsById[ id + '|' + number ] ) {
			number++;
		}
		id = id + '|' + number;
	}

	return id;
};

Parser.prototype.buildThreads = function () {
	var
		threads = [],
		replies = [],
		i, threadItem, id, maybeParent;

	if ( !this.threadItems ) {
		this.buildThreadItems();
	}

	this.threadItemsById = {};
	for ( i = 0; i < this.threadItems.length; i++ ) {
		threadItem = this.threadItems[ i ];

		if ( replies.length < threadItem.level ) {
			// Someone skipped an indentation level (or several). Pretend that the previous reply
			// covers multiple indentation levels, so that following comments get connected to it.
			threadItem.warnings.push( 'Comment skips indentation level' );
			while ( replies.length < threadItem.level ) {
				replies[ replies.length ] = replies[ replies.length - 1 ];
			}
		}

		if ( threadItem instanceof HeadingItem ) {
			// New root (thread)
			threads.push( threadItem );
			// Attach as a sub-thread to preceding higher-level heading.
			// Any replies will appear in the tree twice, under the main-thread and the sub-thread.
			maybeParent = threads.length > 1 ? threads[ threads.length - 2 ] : null;
			while ( maybeParent && maybeParent.headingLevel >= threadItem.headingLevel ) {
				maybeParent = maybeParent.parent;
			}
			if ( maybeParent ) {
				threadItem.parent = maybeParent;
				maybeParent.replies.push( threadItem );
			}
		} else if ( replies[ threadItem.level - 1 ] ) {
			// Add as a reply to the closest less-nested comment
			threadItem.parent = replies[ threadItem.level - 1 ];
			threadItem.parent.replies.push( threadItem );
		} else {
			threadItem.warnings.push( 'Comment could not be connected to a thread' );
		}

		replies[ threadItem.level ] = threadItem;
		// Cut off more deeply nested replies
		replies.length = threadItem.level + 1;
	}

	this.threads = threads;

	for ( i = 0; i < this.threadItems.length; i++ ) {
		threadItem = this.threadItems[ i ];

		// Set the IDs used to refer to comments and headings.
		// This has to be a separate pass because we don't have the list of replies before
		// this point.
		id = this.computeId( threadItem );
		if ( id ) {
			this.threadItemsById[ id ] = threadItem;
		}
		threadItem.id = id;
	}
};

/**
 * @param {ThreadItem} threadItem
 * @return {moment|null}
 */
Parser.prototype.getThreadStartTimestamp = function ( threadItem ) {
	var i, comment, timestampInReplies,
		timestamp = null;
	if ( threadItem instanceof CommentItem ) {
		timestamp = threadItem.timestamp;
	}
	// Check all replies. This can't just use the first comment because threads are often summarized
	// at the top when the discussion is closed.
	for ( i = 0; i < threadItem.replies.length; i++ ) {
		comment = threadItem.replies[ i ];
		// Don't include sub-threads to avoid changing the ID when threads are "merged".
		if ( comment instanceof CommentItem ) {
			timestampInReplies = this.getThreadStartTimestamp( comment );
			if ( !timestamp || timestampInReplies.isBefore( timestamp ) ) {
				timestamp = timestampInReplies;
			}
		}
	}
	return timestamp;
};

module.exports = Parser;
