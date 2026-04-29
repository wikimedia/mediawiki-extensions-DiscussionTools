<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\Tests\Api\ApiTestCase;
use MediaWiki\Title\Title;

/**
 * @group medium
 * @group Database
 * @covers \MediaWiki\Extension\DiscussionTools\ApiDiscussionToolsEdit
 */
class ApiDiscussionToolsEditTest extends ApiTestCase {

	public function testExecuteApiDiscussionEditForAddTopic(): void {
		$title = Title::newFromText( 'Talk:' . __METHOD__ );
		$page = $this->getNonexistingTestPage( $title );
		$performer = $this->getTestSysop()->getUser();

		$params = [
			'action' => 'discussiontoolsedit',
			'paction' => 'addtopic',
			'page' => $page->getTitle()->getFullText(),
			'wikitext' => 'Testing',
			'summary' => 'Test summary',
			'sectiontitle' => 'Test',
		];

		[ $result ] = $this->doApiRequestWithToken( $params, null, $performer );

		$this->assertNotEmpty( $result['discussiontoolsedit'] );
		$this->assertArrayHasKey( 'result', $result['discussiontoolsedit'] );
		$this->assertSame( 'success', $result['discussiontoolsedit']['result'] );
		$this->assertArrayHasKey( 'newrevid', $result['discussiontoolsedit'] );

		$newRevision = $this->getServiceContainer()->getRevisionLookup()->getRevisionById(
			$result['discussiontoolsedit']['newrevid']
		);
		$this->assertNotNull( $newRevision );
		$this->assertTrue( $title->isSamePageAs( $newRevision->getPage() ) );
		$this->assertSame( 'Test summary', $newRevision->getComment()->text );
		$pageWikitext = $newRevision->getContent( SlotRecord::MAIN )->getWikitextForTransclusion();
		$this->assertStringStartsWith( "== Test ==\n\nTesting", $pageWikitext );
		$this->assertStringContainsString( $performer->getUserPage()->getFullText(), $pageWikitext );
	}

	public function testExecuteApiDiscussionEditForAddComment(): void {
		$title = Title::newFromText( 'Talk:' . __METHOD__ );
		$page = $this->getNonexistingTestPage( $title );
		$performer = $this->getTestSysop()->getUser();

		$this->editPage( $page, "== Test ==\n\nexisting comment ~~~~\n" );
		$existingRevision = $page->getRevisionRecord();

		$contentThreadItemSetStatus = HookUtils::parseRevisionParsoidHtml( $existingRevision, __METHOD__ );
		$this->assertStatusGood( $contentThreadItemSetStatus );
		$commentId = $contentThreadItemSetStatus->getValueOrThrow()->getCommentItems()[0]->getId();

		$params = [
			'action' => 'discussiontoolsedit',
			'paction' => 'addcomment',
			'page' => $page->getTitle()->getFullText(),
			'wikitext' => 'New comment',
			'summary' => 'Test summary',
			'commentid' => $commentId,
		];

		[ $result ] = $this->doApiRequestWithToken( $params, null, $performer );

		$this->assertNotEmpty( $result['discussiontoolsedit'] );
		$this->assertArrayHasKey( 'result', $result['discussiontoolsedit'] );
		$this->assertSame( 'success', $result['discussiontoolsedit']['result'] );
		$this->assertArrayHasKey( 'newrevid', $result['discussiontoolsedit'] );

		$newRevision = $this->getServiceContainer()->getRevisionLookup()->getRevisionById(
			$result['discussiontoolsedit']['newrevid']
		);
		$this->assertNotNull( $newRevision );
		$this->assertTrue( $title->isSamePageAs( $newRevision->getPage() ) );
		$this->assertSame( 'Test summary', $newRevision->getComment()->text );
		$pageWikitext = $newRevision->getContent( SlotRecord::MAIN )->getWikitextForTransclusion();
		$this->assertStringStartsWith( "== Test ==", $pageWikitext );
		$this->assertStringContainsString( "existing comment", $pageWikitext );
		$this->assertStringContainsString( "\n:New comment", $pageWikitext );
		$this->assertStringContainsString( $performer->getUserPage()->getFullText(), $pageWikitext );
	}

}
