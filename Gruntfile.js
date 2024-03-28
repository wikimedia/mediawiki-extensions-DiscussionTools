'use strict';

module.exports = function ( grunt ) {
	const conf = grunt.file.readJSON( 'extension.json' );
	grunt.loadNpmTasks( 'grunt-banana-checker' );
	grunt.loadNpmTasks( 'grunt-eslint' );
	grunt.loadNpmTasks( 'grunt-stylelint' );
	grunt.loadNpmTasks( 'grunt-tyops' );

	grunt.initConfig( {
		eslint: {
			options: {
				cache: true,
				fix: grunt.option( 'fix' )
			},
			all: '.'
		},
		stylelint: {
			all: [
				'*.{css,less}',
				'modules/**/*.{css,less}'
			]
		},
		tyops: {
			options: {
				typos: 'typos.json'
			},
			src: [
				'**/*.{js,json,less,css,txt,php,md,sh}',
				'!package-lock.json',
				'!typos.json',
				'!i18n/**',
				'i18n/en.json',
				'i18n/qqq.json',
				'!lib/**',
				'!{docs,node_modules,vendor}/**',
				'!.git/**'
			]
		},
		banana: conf.MessagesDirs
	} );

	grunt.registerTask( 'test', [ 'tyops', 'eslint', 'stylelint', 'banana' ] );
	grunt.registerTask( 'default', 'test' );
};
