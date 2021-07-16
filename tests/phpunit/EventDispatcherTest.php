<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Page\PageIdentityValue;
use MediaWiki\Revision\MutableRevisionRecord;
use MediaWiki\User\UserIdentityValue;
use RawMessage;

/**
 * @coversDefaultClass \MediaWiki\Extension\DiscussionTools\Notifications\EventDispatcher
 *
 * @group DiscussionTools
 */
class EventDispatcherTest extends IntegrationTestCase {

	/**
	 * @dataProvider provideGenerateCases
	 * @covers ::generateEventsFromParsers
	 */
	public function testGenerateEventsFromParsers(
		string $rev1, string $rev2, string $authorUsername, string $expected
	): void {
		$wikitext1 = self::getText( $rev1 );
		$wikitext2 = self::getText( $rev2 );
		$expectedEvents = self::getJson( $expected, false );
		$config = self::getJson( "../data/enwiki-config.json" );
		$data = self::getJson( "../data/enwiki-data.json" );

		$dom1 = ( new RawMessage( $wikitext1 ) )->parse();
		$doc1 = self::createDocument( $dom1 );
		$body1 = $doc1->getElementsByTagName( 'body' )->item( 0 );

		$dom2 = ( new RawMessage( $wikitext2 ) )->parse();
		$doc2 = self::createDocument( $dom2 );
		$body2 = $doc2->getElementsByTagName( 'body' )->item( 0 );

		$this->setupEnv( $config, $data );
		$parser1 = self::createParser( $body1, $data );
		$parser2 = self::createParser( $body2, $data );

		$events = [];

		$fakeUser = new UserIdentityValue( 0, $authorUsername );
		$fakeTitle = new PageIdentityValue( 0, NS_TALK, __CLASS__, PageIdentityValue::LOCAL );
		$fakeRevRecord = new MutableRevisionRecord( $fakeTitle );
		MockEventDispatcher::generateEventsFromParsers(
			$events, $parser1, $parser2, $fakeRevRecord, $fakeTitle, $fakeUser
		);

		foreach ( $events as &$event ) {
			$event = json_decode( json_encode( $event ), false );
		}

		// Optionally write updated content to the JSON files
		if ( getenv( 'DISCUSSIONTOOLS_OVERWRITE_TESTS' ) ) {
			self::overwriteJsonFile( $expected, $events );
		}

		self::assertEquals( $expectedEvents, $events );
	}

	public function provideGenerateCases(): array {
		return [
			// Several simple edits adding replies by different users.
			[
				'cases/EventDispatcher/simple/rev1.txt',
				'cases/EventDispatcher/simple/rev2.txt',
				'Z',
				'../cases/EventDispatcher/simple/rev2.json',
			],
			[
				'cases/EventDispatcher/simple/rev2.txt',
				'cases/EventDispatcher/simple/rev3.txt',
				'Z',
				'../cases/EventDispatcher/simple/rev3.json',
			],
			[
				'cases/EventDispatcher/simple/rev3.txt',
				'cases/EventDispatcher/simple/rev4.txt',
				'Y',
				'../cases/EventDispatcher/simple/rev4.json',
			],
			[
				'cases/EventDispatcher/simple/rev4.txt',
				'cases/EventDispatcher/simple/rev5.txt',
				'X',
				'../cases/EventDispatcher/simple/rev5.json',
			],
			// Adding a new section with heading and a top-level comment.
			[
				'cases/EventDispatcher/newsection/rev1.txt',
				'cases/EventDispatcher/newsection/rev2.txt',
				'Z',
				'../cases/EventDispatcher/newsection/rev2.json',
			],
			// Adding multiple replies in one edit.
			[
				'cases/EventDispatcher/multiple/rev1.txt',
				'cases/EventDispatcher/multiple/rev2.txt',
				'Z',
				'../cases/EventDispatcher/multiple/rev2.json',
			],
			// Adding comments in section 0 (before first heading). These do not generate notifications,
			// because the interface doesn't allow subscribing to it.
			[
				'cases/EventDispatcher/section0/rev1.txt',
				'cases/EventDispatcher/section0/rev2.txt',
				'X',
				'../cases/EventDispatcher/section0/rev2.json',
			],
			[
				'cases/EventDispatcher/section0/rev2.txt',
				'cases/EventDispatcher/section0/rev3.txt',
				'Y',
				'../cases/EventDispatcher/section0/rev3.json',
			],
			// Adding a comment in a previously empty section.
			[
				'cases/EventDispatcher/emptysection/rev1.txt',
				'cases/EventDispatcher/emptysection/rev2.txt',
				'Y',
				'../cases/EventDispatcher/emptysection/rev2.json',
			],
			// Adding comments in sub-sections, where the parent section has no comments (except in
			// sub-sections). These do not generate notifications because of the fix for T286736,
			// but maybe they should?
			[
				'cases/EventDispatcher/subsection-empty/rev1.txt',
				'cases/EventDispatcher/subsection-empty/rev2.txt',
				'Z',
				'../cases/EventDispatcher/subsection-empty/rev2.json',
			],
			[
				'cases/EventDispatcher/subsection-empty/rev2.txt',
				'cases/EventDispatcher/subsection-empty/rev3.txt',
				'Z',
				'../cases/EventDispatcher/subsection-empty/rev3.json',
			],
			// Adding comments in sub-sections, where the parent section also has comments.
			[
				'cases/EventDispatcher/subsection/rev1.txt',
				'cases/EventDispatcher/subsection/rev2.txt',
				'Z',
				'../cases/EventDispatcher/subsection/rev2.json',
			],
			[
				'cases/EventDispatcher/subsection/rev2.txt',
				'cases/EventDispatcher/subsection/rev3.txt',
				'Z',
				'../cases/EventDispatcher/subsection/rev3.json',
			],
			[
				'cases/EventDispatcher/subsection/rev3.txt',
				'cases/EventDispatcher/subsection/rev4.txt',
				'Z',
				'../cases/EventDispatcher/subsection/rev4.json',
			],
			// Edits that do not add comments, and do not generate notifications.
			[
				// Copying a discussion from another page (note the author of revision)
				'cases/EventDispatcher/notcomments/rev1.txt',
				'cases/EventDispatcher/notcomments/rev2.txt',
				'Z',
				'../cases/EventDispatcher/notcomments/rev2.json',
			],
			[
				// Editing a comment
				'cases/EventDispatcher/notcomments/rev2.txt',
				'cases/EventDispatcher/notcomments/rev3.txt',
				'X',
				'../cases/EventDispatcher/notcomments/rev3.json',
			],
			[
				// Editing page intro section
				'cases/EventDispatcher/notcomments/rev3.txt',
				'cases/EventDispatcher/notcomments/rev4.txt',
				'X',
				'../cases/EventDispatcher/notcomments/rev4.json',
			],
			// Multiple edits within a minute adding comments by the same user.
			// See T285528#7177220 for more detail about each case.
			[
				'cases/EventDispatcher/sametime/rev1.txt',
				'cases/EventDispatcher/sametime/rev2.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev2.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2.txt',
				'cases/EventDispatcher/sametime/rev3-case1.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3-case1.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2.txt',
				'cases/EventDispatcher/sametime/rev3-case2.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3-case2.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2.txt',
				'cases/EventDispatcher/sametime/rev3-case3.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3-case3.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2.txt',
				'cases/EventDispatcher/sametime/rev3-case4.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3-case4.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2.txt',
				'cases/EventDispatcher/sametime/rev3-case5.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3-case5.json',
			],
			[
				'cases/EventDispatcher/sametime/rev1b.txt',
				'cases/EventDispatcher/sametime/rev2b.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev2b.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2b.txt',
				'cases/EventDispatcher/sametime/rev3b-case6.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3b-case6.json',
			],
			[
				'cases/EventDispatcher/sametime/rev2b.txt',
				'cases/EventDispatcher/sametime/rev3b-case7.txt',
				'Z',
				'../cases/EventDispatcher/sametime/rev3b-case7.json',
			],
		];
	}

}
