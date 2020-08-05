<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use DOMDocument;
use DOMElement;
use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\MediaWikiServices;
use MediaWikiTestCase;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

abstract class CommentTestCase extends MediaWikiTestCase {

	/**
	 * Create a DOMDocument from a string
	 *
	 * @param string $html
	 * @return DOMDocument
	 */
	protected static function createDocument( string $html ) : DOMDocument {
		$doc = DOMUtils::parseHTML( $html );
		$doc->preserveWhiteSpace = false;
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
	 * Write JSON to path
	 *
	 * @param string $relativePath
	 * @param array $data
	 */
	protected static function overwriteJsonFile( string $relativePath, array $data ) : void {
		$json = json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		// 2 spaces instead of 4
		$json = preg_replace( '/^( +)\1/m', '$1', $json );
		file_put_contents( __DIR__ . '/' . $relativePath, $json . "\n" );
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
			preg_match( '`(<body[^>]*>)(.*)(</body>)`s', $html, $match );
			$html = "<div>$match[2]</div>";
		}

		return $html;
	}

	/**
	 * Write HTML to path
	 *
	 * @param string $relPath
	 * @param DOMDocument $doc
	 * @param string $origRelPath
	 */
	protected static function overwriteHtmlFile( string $relPath, DOMDocument $doc, string $origRelPath ) : void {
		// Do not use $doc->saveHtml(), it outputs an awful soup of HTML entities for documents with
		// non-ASCII characters
		$html = file_get_contents( __DIR__ . '/../' . $origRelativePath );

		// Replace the body tag only in full Parsoid docs
		if ( strpos( $html, '<body' ) !== false ) {
			$innerHtml = DOMCompat::getInnerHTML( $doc->getElementsByTagName( 'body' )->item( 0 )->firstChild );
			$html = preg_replace(
				'`(<body[^>]*>)(.*)(</body>)`s',
				// Quote \ and $ in the replacement text
				'$1' . strtr( $innerHtml, [ '\\' => '\\\\', '$' => '\\$' ] ) . '$3',
				$html
			);
		} else {
			$html = DOMCompat::getInnerHTML( $doc->getElementsByTagName( 'body' )->item( 0 ) );
		}

		file_put_contents( __DIR__ . '/../' . $relativePath, $html );
	}

	/**
	 * Create a comment pareser
	 *
	 * @param DOMElement $rootNode
	 * @param array $data
	 * @return CommentParser
	 */
	protected static function createParser( DOMElement $rootNode, array $data ) : CommentParser {
		$services = MediaWikiServices::getInstance();
		return new CommentParser(
			$rootNode,
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
