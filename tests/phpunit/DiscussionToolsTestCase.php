<?php

use MediaWiki\MediaWikiServices;

/**
 * @coversDefaultClass DiscussionToolsCommentModifier
 */
class DiscussionToolsTestCase extends MediaWikiTestCase {

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
	 * @return array
	 */
	protected static function getJson( string $relativePath ) : array {
		$json = json_decode(
			// TODO: Move cases out of /qunit
			file_get_contents( __DIR__ . '/../qunit/' . $relativePath ),
			true
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
		// TODO: Move cases out of /qunit
		$html = file_get_contents( __DIR__ . '/../qunit/' . $relativePath );

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
	 * @return DiscussionToolsCommentParser
	 */
	protected static function createParser( array $data ) : DiscussionToolsCommentParser {
		$services = MediaWikiServices::getInstance();
		return new DiscussionToolsCommentParser(
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
