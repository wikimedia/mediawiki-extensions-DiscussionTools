/* eslint-disable no-console */
'use strict';

// DiscussionToolsHooks::getLocalData()
var data = require( './data.json' );

function getMessages( msg ) {
	return msg.map( function ( code ) {
		return data.contLangMessages[ code ];
	} );
}

function regexpGroup( regexp ) {
	return '(' + regexp + ')';
}

function regexpAlternateGroup( array ) {
	return '(' + array.map( mw.util.escapeRegExp ).join( '|' ) + ')';
}

// Language::sprintfDate
// This only supports format characters that are used by the default date format in any of
// MediaWiki's languages, namely: D, d, F, G, H, i, j, l, M, n, Y, xg, xkY (and escape characters),
// and only dates when MediaWiki existed, let's say 2000 onwards (Thai dates before 1941 are
// complicated).
function getTimestampRegexp( format, digits ) {
	var s, p, num, code, endQuote;

	s = '';

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

	return s;
}

function getTimestampParser( format, digits, tzOffset ) {
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

	return function ( match ) {
		var
			year = 0,
			monthIdx = 0,
			day = 0,
			hour = 0,
			minute = 0,
			i, code, text;
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

		return new Date( Date.UTC( year, monthIdx, day, hour, minute ) - tzOffset * 60 * 1000 );
	};
}

// Parser::pstPass2
function getLocalTimestampRegexp() {
	var
		df = data.dateFormat,
		digits = mw.config.get( 'wgTranslateNumerals' ) ? data.digits : null,
		dfRegexp = getTimestampRegexp( df, digits ? '[' + digits + ']' : '\\d' ),
		localizedTimezones = data.timezones,
		// TODO: Timezone abbreviations are not unique so we can't do anything useful with this.
		tzRegexp = '(?:' + localizedTimezones.map( mw.util.escapeRegExp ).join( '|' ) + ')',
		regexp = dfRegexp + ' \\(' + tzRegexp + '\\)';
	return regexp;
}

function getLocalTimestampParser() {
	var
		df = data.dateFormat,
		digits = mw.config.get( 'wgTranslateNumerals' ) ? data.digits : null,
		// TODO: Implement DST offsets
		// TODO: Implement timezone validation
		parseFunction = getTimestampParser( df, digits, data.localTimezoneOffset );
	return parseFunction;
}

function findTimestamps( rootNode ) {
	var
		nodes = [],
		treeWalker = rootNode.ownerDocument.createTreeWalker( rootNode, NodeFilter.SHOW_TEXT, null, false ),
		dateRegexp = getLocalTimestampRegexp(),
		node, match;

	while ( ( node = treeWalker.nextNode() ) ) {
		// TODO Multiple matches per node?
		if ( ( match = node.nodeValue.match( dateRegexp ) ) ) {
			nodes.push( [ node, match ] );
		}
	}
	return nodes;
}

function getPageTitleFromHref( href ) {
	var uri, articlePathRegexp, match;

	uri = new mw.Uri( href );
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
			title = getPageTitleFromHref( link.href );
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
		if ( node.tagName && node.tagName.match( /h[1-6]/i ) ) {
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

	// return threads;
	return comments;
}

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
	getComments: getComments,
	groupThreads: groupThreads,
	findSignature: findSignature,
	getAuthors: getAuthors
};
