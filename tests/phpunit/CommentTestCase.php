<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use DOMDocument;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\MediaWikiServices;
use MediaWikiTestCase;

abstract class CommentTestCase extends MediaWikiTestCase {

	/**
	 * Create a DOMDocument from a string
	 *
	 * @param string $html
	 * @return DOMDocument
	 */
	protected static function createDocument( string $html ) : DOMDocument {
		$doc = new DOMDocument();
		$doc->preserveWhiteSpace = false;
		$doc->loadHTML( '<?xml encoding="utf-8" ?>' . $html, LIBXML_NOERROR );
		return $doc;
	}

	/**
	 * Get parsed JSON from path
	 *
	 * @param string $relativePath
	 * @param bool $assoc See json_decode()
	 * @return array
	 */
	protected static function getJson( string $relativePath, bool $assoc = true ) : array {
		$json = json_decode(
			file_get_contents( __DIR__ . '/' . $relativePath ),
			$assoc
		);
		return $json;
	}

	/**
	 * Get HTML from path
	 *
	 * @param string $relativePath
	 * @return string
	 */
	protected static function getHtml( string $relativePath ) : string {
		$html = file_get_contents( __DIR__ . '/../' . $relativePath );

		// Remove all but the body tags from full Parsoid docs
		if ( strpos( $html, '<body' ) !== false ) {
			preg_match( '`<body[^>]*>(.*)</body>`s', $html, $match );
			$html = "<div>$match[1]</div>";
		}

		return $html;
	}

	/**
	 * Create a comment pareser
	 *
	 * @param array $data
	 * @return CommentParser
	 */
	protected static function createParser( array $data ) : CommentParser {
		$services = MediaWikiServices::getInstance();
		return new CommentParser(
			$services->getContentLanguage(),
			$services->getMainConfig(),
			$data
		);
	}

	/**
	 * Setup the MW environment
	 *
	 * @param array $config
	 * @param array $data
	 */
	protected function setupEnv( array $config, array $data ) : void {
		$this->setMwGlobals( $config );
		$this->setMwGlobals( [
			'wgArticlePath' => $config['wgArticlePath'],
			'wgNamespaceAliases' => $config['wgNamespaceIds'],
			// TODO: Move this to $config
			'wgLocaltimezone' => $data['localTimezone']
		] );
		$this->setUserLang( $config['wgContentLang'] );
		$this->setContentLang( $config['wgContentLang'] );
	}
}
