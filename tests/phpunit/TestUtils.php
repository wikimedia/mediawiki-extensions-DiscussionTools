<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\CommentParser;
use MediaWiki\MediaWikiServices;
use Wikimedia\Parsoid\DOM\Document;
use Wikimedia\Parsoid\Utils\DOMCompat;
use Wikimedia\Parsoid\Utils\DOMUtils;

trait TestUtils {

	/**
	 * Create a Document from a string
	 *
	 * @param string $html
	 * @return Document
	 */
	protected static function createDocument( string $html ): Document {
		$doc = DOMUtils::parseHTML( $html );
		return $doc;
	}

	/**
	 * Get text from path
	 *
	 * @param string $relativePath
	 * @return string
	 */
	protected static function getText( string $relativePath ): string {
		return file_get_contents( __DIR__ . '/../' . $relativePath );
	}

	/**
	 * Write text to path
	 *
	 * @param string $relativePath
	 * @param string $text
	 */
	protected static function overwriteTextFile( string $relativePath, string $text ): void {
		file_put_contents( __DIR__ . '/../' . $relativePath, $text );
	}

	/**
	 * Get parsed JSON from path
	 *
	 * @param string $relativePath
	 * @param bool $assoc See json_decode()
	 * @return array
	 */
	protected static function getJson( string $relativePath, bool $assoc = true ): array {
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
	protected static function overwriteJsonFile( string $relativePath, array $data ): void {
		$json = json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		// Tabs instead of 4 spaces
		$json = preg_replace( '/(?:\G|^) {4}/m', "\t", $json );
		file_put_contents( __DIR__ . '/' . $relativePath, $json . "\n" );
	}

	/**
	 * Get HTML from path
	 *
	 * @param string $relativePath
	 * @return string
	 */
	protected static function getHtml( string $relativePath ): string {
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
	 * @param Document $doc
	 * @param string $origRelPath
	 */
	protected static function overwriteHtmlFile( string $relPath, Document $doc, string $origRelPath ): void {
		// Do not use $doc->saveHtml(), it outputs an awful soup of HTML entities for documents with
		// non-ASCII characters
		$html = file_get_contents( __DIR__ . '/../' . $origRelPath );

		// Replace the body tag only in full Parsoid docs
		if ( strpos( $html, '<body' ) !== false ) {
			$innerHtml = DOMCompat::getInnerHTML( DOMCompat::getBody( $doc )->firstChild );
			$html = preg_replace(
				'`(<body[^>]*>)(.*)(</body>)`s',
				// Quote \ and $ in the replacement text
				'$1' . strtr( $innerHtml, [ '\\' => '\\\\', '$' => '\\$' ] ) . '$3',
				$html
			);
		} else {
			$html = DOMCompat::getInnerHTML( DOMCompat::getBody( $doc ) );
		}

		file_put_contents( __DIR__ . '/../' . $relPath, $html );
	}

	/**
	 * Create a comment parser
	 *
	 * @param array $data
	 * @return CommentParser
	 */
	public static function createParser( array $data ): CommentParser {
		$services = MediaWikiServices::getInstance();
		return new CommentParser(
			$services->getContentLanguage(),
			$services->getMainConfig(),
			new MockLanguageData( $data )
		);
	}
}
