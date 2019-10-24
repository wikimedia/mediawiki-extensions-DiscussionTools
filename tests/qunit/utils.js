module.exports = {};

/**
 * Create a QUnit environment that will automatically restore the parser data at the end of every
 * test, so that we can use #overrideParserData without thinking about cleaning it up.
 *
 * @return {Object}
 */
module.exports.newEnvironment = function () {
	var originalParserData = $.extend(
		{},
		mw.loader.moduleRegistry[ 'ext.discussionTools.parser' ].packageExports[ 'data.json' ]
	);
	return QUnit.newMwEnvironment( {
		afterEach: function () {
			module.exports.overrideParserData( originalParserData );
		}
	} );
};

/**
 * Override the parser data with the given data. Used for testing different languages etc.
 *
 * @param {Object} data
 */
module.exports.overrideParserData = function ( data ) {
	$.extend(
		mw.loader.moduleRegistry[ 'ext.discussionTools.parser' ].packageExports[ 'data.json' ],
		data
	);
};
