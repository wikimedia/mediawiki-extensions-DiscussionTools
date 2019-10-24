/* eslint-disable no-console */
'use strict';

// DiscussionToolsHooks::getLocalData()
var
	data = require( './data.json' ),
	moment = require( './lib/moment-timezone/moment-timezone-with-data-1970-2030.js' );

/**
 * Utilities for detecting and parsing components of discussion pages: signatures, timestamps,
 * comments and threads.
 *
 * @class mw.dt.parser
 */

/**
 * Get text of localisation messages in content language.
 *
 * @private
 * @param {string[]} messages
 * @return {string[]}
 */
function getMessages( messages ) {
	return messages.map( function ( code ) {
		return data.contLangMessages[ code ];
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
 * @param {string} format Date format, as used by MediaWiki
 * @param {string} digits Regular expression matching a single localised digit, e.g. `[0-9]`
 * @param {Object} tzAbbrs Map of localised timezone abbreviations to IANA abbreviations
 *   for the local timezone, e.g. `{EDT: "EDT", EST: "EST"}`
 * @return {string} Regular expression
 */
function getTimestampRegexp( format, digits, tzAbbrs ) {
	var s, p, num, code, endQuote, tzRegexp, regexp;

	function regexpGroup( regexp ) {
		return '(' + regexp + ')';
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
				s += regexpAlternateGroup( getMessages( [
					'january-gen', 'february-gen', 'march-gen', 'april-gen', 'may-gen', 'june-gen',
					'july-gen', 'august-gen', 'september-gen', 'october-gen', 'november-gen',
					'december-gen'
				] ) );
				break;
			case 'd':
				num = '2';
				break;
			case 'D':
				s += regexpAlternateGroup( getMessages( [
					'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'
				] ) );
				break;
			case 'j':
				num = '1,2';
				break;
			case 'l':
				s += regexpAlternateGroup( getMessages( [
					'sunday', 'monday', 'tuesday', 'wednesday', 'thursday',
					'friday', 'saturday'
				] ) );
				break;
			case 'F':
				s += regexpAlternateGroup( getMessages( [
					'january', 'february', 'march', 'april', 'may_long', 'june',
					'july', 'august', 'september', 'october', 'november',
					'december'
				] ) );
				break;
			case 'M':
				s += regexpAlternateGroup( getMessages( [
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
			s += regexpGroup( digits + '{' + num + '}' );
		}
	}

	tzRegexp = regexpAlternateGroup( Object.keys( tzAbbrs ) );
	// Hardcoded parentheses and space like in Parser::pstPass2
	regexp = s + ' \\(' + tzRegexp + '\\)';

	return regexp;
}

/**
 * Get a function that parses timestamps generated using the given date format, based on the result
 * of matching the regexp returned by #getTimestampRegexp.
 *
 * @param {string} format Date format, as used by MediaWiki
 * @param {string} digits Localised digits from 0 to 9, e.g. `0123456789`
 * @param {string} localTimezone Local timezone IANA name, e.g. `America/New_York`
 * @param {Object} tzAbbrs Map of localised timezone abbreviations to IANA abbreviations
 *   for the local timezone, e.g. `{EDT: "EDT", EST: "EST"}`
 * @return {Function} Parser function
 * @return {Array} return.match Regexp match data
 * @return {Object} return.return Moment object
 */
function getTimestampParser( format, digits, localTimezone, tzAbbrs ) {
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
			new RegExp( '[' + digits + ']', 'g' ),
			function ( m ) {
				return digits.indexOf( m );
			}
		);
	}

	return function timestampParser( match ) {
		var
			year = 0,
			monthIdx = 0,
			day = 0,
			hour = 0,
			minute = 0,
			tzAbbr,
			i, code, text,
			date;
		for ( i = 0; i < matchingGroups.length; i++ ) {
			code = matchingGroups[ i ];
			text = match[ i + 1 ];

			switch ( code ) {
				case 'xg':
					monthIdx = getMessages( [
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
					monthIdx = getMessages( [
						'january', 'february', 'march', 'april', 'may_long', 'june',
						'july', 'august', 'september', 'october', 'november',
						'december'
					] ).indexOf( text );
					break;
				case 'M':
					monthIdx = getMessages( [
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
		tzAbbr = tzAbbrs[ match[ i + 1 ] ];

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
				console.log( 'Timestamp has timezone abbreviation for the wrong time: ' + match[ 0 ] );
			} else {
				console.log( 'Ambiguous time at DST switchover was parsed: ' + match[ 0 ] );
			}
		}

		return date;
	};
}

/**
 * Get a regexp that matches timestamps in the local date format.
 *
 * This calls #getTimestampRegexp with predefined data for the current wiki.
 *
 * @private
 * @return {string} Regular expression
 */
function getLocalTimestampRegexp() {
	var
		df = data.dateFormat,
		digitsRegexp = mw.config.get( 'wgTranslateNumerals' ) ? '[' + data.digits + ']' : '\\d',
		dfRegexp = getTimestampRegexp( df, digitsRegexp, data.timezones );
	return dfRegexp;
}

/**
 * Get a function that parses timestamps in the local date format, based on the result
 * of matching the regexp returned by #getLocalTimestampRegexp.
 *
 * This calls #getTimestampParser with predefined data for the current wiki.
 *
 * @private
 * @return {Function} Parser function
 * @return {Array} return.match Regexp match data
 * @return {Date} return.return
 */
function getLocalTimestampParser() {
	var
		df = data.dateFormat,
		digits = mw.config.get( 'wgTranslateNumerals' ) ? data.digits : null,
		parseFunction = getTimestampParser( df, digits, data.localTimezone, data.timezones );
	return parseFunction;
}

/**
 * Find all timestamps within a DOM subtree.
 *
 * @param {Node} rootNode Node to search
 * @return {Array[]} Results. Each result is a two-element array.
 * @return {Text} return.0 Text node containing the timestamp
 * @return {Array} return.1 Regexp match data, which specifies the location of the match, and which
 *   can be parsed using #getLocalTimestampParser
 */
function findTimestamps( rootNode ) {
	var
		matches = [],
		treeWalker = rootNode.ownerDocument.createTreeWalker( rootNode, NodeFilter.SHOW_TEXT, null, false ),
		dateRegexp = getLocalTimestampRegexp(),
		node, match;

	while ( ( node = treeWalker.nextNode() ) ) {
		// Technically, there could be multiple matches in a single text node. However, the ultimate
		// point of this is to find the signatures which precede the timestamps, and any later
		// timestamps in the text node can't be directly preceded by a signature (as we require them to
		// have links), so we only concern ourselves with the first match.
		if ( ( match = node.nodeValue.match( dateRegexp ) ) ) {
			matches.push( [ node, match ] );
		}
	}
	return matches;
}

/**
 * Get the MediaWiki page title from an URI.
 *
 * @private
 * @param {string} uri
 * @return {string|null} Page title, or null if this isn't a link to a page
 */
function getPageTitleFromUri( uri ) {
	var articlePathRegexp, match;

	uri = new mw.Uri( uri );
	articlePathRegexp = new RegExp(
		mw.util.escapeRegExp( mw.config.get( 'wgArticlePath' ) )
			.replace( mw.util.escapeRegExp( '$1' ), '(.*)' )
	);

	if ( ( match = uri.path.match( articlePathRegexp ) ) ) {
		return decodeURIComponent( match[ 1 ] );
	}
	if ( uri.query.title ) {
		return uri.query.title;
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
 * @return {Array} Result, a two-element array
 * @return {Node[]} return.0 Sibling nodes comprising the signature (with `timestampNode`
 *   as the last element)
 * @return {string|null} return.1 Username, null for unsigned comments
 */
function findSignature( timestampNode ) {
	var
		node = timestampNode,
		sigNodes = [ node ],
		sigUsername = null,
		length = 0,
		lastLinkNode = timestampNode,
		links, nodes;
	while ( ( node = node.previousSibling ) && length < data.signatureScanLimit ) {
		sigNodes.push( node );
		length += ( node.textContent || '' ).length;
		if ( !node.tagName ) {
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
		// Use .some() rather than .every() to permit vanity links
		// "TonyTheTiger (T / C / WP:FOUR / WP:CHICAGO / WP:WAWARD)"
		// eslint-disable-next-line no-loop-func
		if ( links.some( function ( link ) {
			var username, title, mwTitle;
			title = getPageTitleFromUri( link.href );
			if ( !title ) {
				return false;
			}
			mwTitle = mw.Title.newFromText( title );
			if (
				mwTitle.getNamespaceId() === mw.config.get( 'wgNamespaceIds' ).user ||
				mwTitle.getNamespaceId() === mw.config.get( 'wgNamespaceIds' ).user_talk
			) {
				username = mwTitle.getMainText();
			} else if (
				mwTitle.getNamespaceId() === mw.config.get( 'wgNamespaceIds' ).special &&
				mwTitle.getMainText().split( '/' )[ 0 ] === data.specialContributionsName
			) {
				username = mwTitle.getMainText().split( '/' )[ 1 ];
			}
			if ( !username ) {
				return false;
			}
			if ( mw.util.isIPv6Address( username ) ) {
				// Canonicalize links
				// Bot-generated links "Preceding unsigned comment added by" are wrong
				username = username.toUpperCase();
			}

			// Check that every link points to the same user
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
}

/**
 * Get the indent level of a node, relative to its ancestor node.
 *
 * The indent level is the number of lists inside of which it is nested.
 *
 * @private
 * @param {Node} node
 * @param {Node} rootNode Node to stop counting at
 * @return {number}
 */
function getIndentLevel( node, rootNode ) {
	var indent = 0;
	while ( ( node = node.parentNode ) ) {
		if ( node === rootNode ) {
			break;
		}
		if ( node.tagName.toLowerCase() === 'li' || node.tagName.toLowerCase() === 'dl' ) {
			indent++;
		}
	}
	return indent;
}

/**
 * Return the next leaf node in the tree order that is not an empty or whitespace-only text node.
 *
 * In other words, this returns a Text node with content other than whitespace, or an Element node
 * with no children, that follows the given node in the HTML source.
 *
 * @private
 * @param {Node} node Node to start searching at. If it isn't a leaf node, its children are ignored.
 * @param {Node} rootNode Node to stop searching at
 * @return {Node|null}
 */
function nextInterestingLeafNode( node, rootNode ) {
	var treeWalker = rootNode.ownerDocument.createTreeWalker(
		rootNode,
		// eslint-disable-next-line no-bitwise
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		function ( n ) {
			// Ignore this node and its descendants
			if ( n === node || n.parentNode === node ) {
				return NodeFilter.FILTER_REJECT;
			}
			if ( n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '' ) {
				return NodeFilter.FILTER_ACCEPT;
			}
			if ( n.nodeType === Node.ELEMENT_NODE && !n.firstChild ) {
				return NodeFilter.FILTER_ACCEPT;
			}
			return NodeFilter.FILTER_SKIP;
		},
		false
	);
	treeWalker.currentNode = node;
	treeWalker.nextNode();
	return treeWalker.currentNode;
}

/**
 * Get all discussion comments (and headings) within a DOM subtree.
 *
 * This returns a flat list, use #groupThreads to associate replies to original messages and get a
 * tree structure starting at section headings.
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
 *       { type: 'heading', level: 0, range: (h2: A)        },
 *       { type: 'comment', level: 1, range: (p: B)         },
 *       { type: 'comment', level: 2, range: (li: C, li: C) },
 *       { type: 'comment', level: 3, range: (li: D)        },
 *       { type: 'comment', level: 4, range: (li: E)        },
 *       { type: 'comment', level: 4, range: (li: F)        },
 *       { type: 'comment', level: 2, range: (li: G)        },
 *       { type: 'comment', level: 1, range: (p: H)         },
 *       { type: 'comment', level: 2, range: (li: I)        }
 *     ]
 *
 * @param {Node} rootNode
 * @return {Object[]} Results. Each result is an object.
 * @return {string} return.type `heading` or `comment`
 * @return {Range} return.range The extent of the comment, including the signature and timestamp.
 *   Comments can start or end in the middle of a DOM node.
 * @return {number} return.level Indentation level of the comment. Headings are `0`, comments start
 *   at `1`.
 * @return {Object} [return.timestamp] Timestamp (Moment object), undefined for headings
 * @return {string|null} [return.author] Comment author's username, null for unsigned comments,
 *   undefined for headings
 */
function getComments( rootNode ) {
	var
		dfParser = getLocalTimestampParser(),
		comments = [],
		timestamps, nextTimestamp, treeWalker,
		node, range, curComment, startNode, match, startLevel, endLevel;

	timestamps = findTimestamps( rootNode );

	treeWalker = rootNode.ownerDocument.createTreeWalker(
		rootNode,
		// eslint-disable-next-line no-bitwise
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		null,
		false
	);

	nextTimestamp = 0;
	while ( ( node = treeWalker.nextNode() ) ) {
		if ( node.tagName && node.tagName.match( /^h[1-6]$/i ) ) {
			range = rootNode.ownerDocument.createRange();
			range.selectNodeContents( node );
			curComment = {
				type: 'heading',
				range: range,
				level: 0
			};
			comments.push( curComment );
		} else if ( timestamps[ nextTimestamp ] && node === timestamps[ nextTimestamp ][ 0 ] ) {
			// Everything from last comment up to here is the next comment
			startNode = nextInterestingLeafNode( curComment.range.endContainer, rootNode );
			range = rootNode.ownerDocument.createRange();
			range.setStartBefore( startNode );
			match = timestamps[ nextTimestamp ][ 1 ];
			range.setEnd( node, match.index + match[ 0 ].length );

			startLevel = getIndentLevel( startNode, rootNode ) + 1;
			endLevel = getIndentLevel( node, rootNode ) + 1;
			if ( startLevel !== endLevel ) {
				console.log( 'Comment starts and ends with different indentation', startNode, node );
			}

			curComment = {
				type: 'comment',
				timestamp: dfParser( match ),
				author: findSignature( node )[ 1 ],
				range: range,
				// Should this use the indent level of `startNode` or `node`?
				level: Math.min( startLevel, endLevel )
			};
			comments.push( curComment );
			nextTimestamp++;
		}
	}

	return comments;
}

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
 *       { type: 'heading', level: 0, range: (h2: A), replies: [
 *         { type: 'comment', level: 1, range: (p: B), replies: [
 *           { type: 'comment', level: 2, range: (li: C, li: C), replies: [
 *             { type: 'comment', level: 3, range: (li: D), replies: [
 *               { type: 'comment', level: 4, range: (li: E), replies: [] },
 *               { type: 'comment', level: 4, range: (li: F), replies: [] },
 *             ] },
 *           ] },
 *           { type: 'comment', level: 2, range: (li: G), replies: [] },
 *         ] },
 *         { type: 'comment', level: 1, range: (p: H), replies: [
 *           { type: 'comment', level: 2, range: (li: I), replies: [] },
 *         ] },
 *       ] },
 *     ]
 *
 * @param {Object} comments Result of #getComments
 * @return {Object[]} Tree structure of comments, using the same objects as `comments`. Top-level
 *   items are the headings. The following properties are added:
 * @return {Object[]} return.replies Comment objects which are replies to this comment
 * @return {Object|null} return.parent Comment object which this is a reply to (null for headings)
 */
function groupThreads( comments ) {
	var
		threads = [],
		replies = [],
		i, comment;

	for ( i = 0; i < comments.length; i++ ) {
		comment = comments[ i ];
		// This modifies the original objects in `comments`!
		comment.replies = [];
		comment.parent = null;

		if ( replies.length < comment.level ) {
			// Someone skipped an indentation level (or several). Pretend that the previous reply
			// covers multiple indentation levels, so that following comments get connected to it.
			console.log( 'Comment skips indentation level', comment.range );
			while ( replies.length < comment.level ) {
				replies[ replies.length ] = replies[ replies.length - 1 ];
			}
		}

		if ( comment.level === 0 ) {
			// new root (thread)
			threads.push( comment );
		} else if ( replies[ comment.level - 1 ] ) {
			// add as a reply to closest less nested comment
			replies[ comment.level - 1 ].replies.push( comment );
			comment.parent = replies[ comment.level - 1 ];
		} else {
			console.log( 'Comment could not be connected to a thread', comment.range );
		}

		replies[ comment.level ] = comment;
		// cut off more deeply nested replies
		replies.length = comment.level + 1;
	}

	return threads;
}

/**
 * Get the list of authors involved in a comment and its replies.
 *
 * You probably want to pass a thread root here (a heading).
 *
 * @param {Object} comment Comment object, as returned by #groupThreads
 * @return {Object} Object with comment author usernames as keys
 */
function getAuthors( comment ) {
	var authors = {};
	if ( comment.author ) {
		authors[ comment.author ] = true;
	}
	// Get the set of authors in the same format from each reply, and merge them all
	authors = comment.replies.map( getAuthors ).reduce( function ( a, b ) {
		return $.extend( a, b );
	}, authors );
	return authors;
}

module.exports = {
	findTimestamps: findTimestamps,
	getLocalTimestampParser: getLocalTimestampParser,
	getTimestampRegexp: getTimestampRegexp,
	getComments: getComments,
	groupThreads: groupThreads,
	findSignature: findSignature,
	getAuthors: getAuthors
};
