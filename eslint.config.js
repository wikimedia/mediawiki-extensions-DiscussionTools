'use strict';

const { defineConfig, globalIgnores } = require( 'eslint/config' );
const wikimedia = require( 'eslint-config-wikimedia/flat' );

// Shared by modules and tests (was modules/.eslintrc.json)
const sharedConfig = {
	languageOptions: {
		globals: {
			ve: 'readonly',
			RangeFix: 'readonly'
		}
	},
	rules: {
		'max-len': 'off'
	},
	settings: {
		jsdoc: {
			preferredTypes: {
				CommentController: 'CommentController',
				CommentDetails: 'CommentDetails',
				CommentItem: 'CommentItem',
				DmMWPingNode: 'DmMWPingNode',
				HeadingItem: 'HeadingItem',
				MemoryStorage: 'MemoryStorage',
				moment: 'moment',
				ReplyWidget: 'ReplyWidget',
				ThreadItemSet: 'ThreadItemSet',
				ThreadItem: 'ThreadItem'
			}
		}
	}
};

// Directories with their own config, which other configs don't apply to.
// These were directories with `"root": true` in .eslintrc.json.
const rootDirs = {
	modules: [ 'modules/**' ],
	tests: [ 'tests/qunit/**' ]
};

module.exports = defineConfig( [
	globalIgnores( [
		// Upstream code
		'**/lib/*',
		'**/lib/*/',
		'!**/lib/foreign-resources.*',

		// Build
		'vendor/',
		'coverage/',
		'docs/',

		// Language files written automatically by TranslateWiki
		'i18n/**/*.json',
		'!i18n/**/en.json',
		'!i18n/**/qqq.json'
	] ),

	// Gruntfile.js, build scripts, etc.
	{
		ignores: Object.values( rootDirs ).flat(),
		extends: [ wikimedia( 'server', 'mediawiki' ) ]
	},
	{
		files: [ '.svgo.config.mjs' ],
		languageOptions: {
			sourceType: 'module'
		},
		settings: {
			// Allow import() in types
			jsdoc: { mode: 'typescript' }
		}
	},

	// Code which runs in MediaWiki
	{
		files: rootDirs.modules,
		extends: [ wikimedia( 'client', 'jquery', 'mediawiki' ), sharedConfig ]
	},

	// QUnit tests (was tests/qunit/.eslintrc.json)
	{
		files: rootDirs.tests,
		extends: [ wikimedia( 'client', 'jquery', 'mediawiki', 'qunit' ), sharedConfig ],
		rules: {
			'security/detect-non-literal-require': 'off'
		}
	}
] );
