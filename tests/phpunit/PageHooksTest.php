<?php

namespace MediaWiki\Extension\DiscussionTools\Tests;

use MediaWiki\Context\RequestContext;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Page\Article;
use MediaWiki\Registration\ExtensionRegistry;
use MediaWiki\Request\FauxRequest;
use MediaWiki\Title\Title;
use MediaWikiIntegrationTestCase;

/**
 * @covers \MediaWiki\Extension\DiscussionTools\Hooks\PageHooks
 * @group Database
 */
class PageHooksTest extends MediaWikiIntegrationTestCase {

	private function sharedAddEmptyStateSetup() {
		$subjectTitle = Title::newFromText( __METHOD__ );
		$talkTitle = Title::newFromText( 'Talk:' . __METHOD__ );

		// Fulfill conditions of HookUtils::shouldDisplayEmptyState
		if ( ExtensionRegistry::getInstance()->isLoaded( 'Liquid Threads' ) ) {
			$this->overrideConfigValue( 'LqtTalkPages', false );
		}
		$this->editPage( $subjectTitle, "" );

		// Sanity check, to avoid confusing error messages later if the test fails
		$this->assertTrue( $subjectTitle->exists() );
		$this->assertFalse( $talkTitle->exists() );

		return $talkTitle;
	}

	private function createEmptyStateContext( Title $talkTitle, string $viewerIp ): RequestContext {
		$context = new RequestContext();
		$context->setRequest( new FauxRequest() );
		$context->setTitle( $talkTitle );
		$context->setUser( $this->getServiceContainer()->getUserFactory()->newAnonymous( $viewerIp ) );
		$context->setLanguage( $this->getServiceContainer()->getLanguageFactory()->getLanguage( 'qqx' ) );
		return $context;
	}

	// Use a fixed anonymous IP for ordinary empty-state tests.
	// Override it when the viewer's identity matters.
	private function sharedAddEmptyStateView( $talkTitle, string $viewerIp = '192.0.2.1' ) {
		$context = $this->createEmptyStateContext( $talkTitle, $viewerIp );
		// Sanity check, to avoid confusing error messages later if the test fails
		$this->assertTrue( HookUtils::shouldDisplayEmptyState( $context ) );

		$article = Article::newFromTitle( $talkTitle, $context );
		$article->view();

		$html = $context->getOutput()->getHTML();
		$this->assertSame(
			1,
			substr_count( $html, '(discussiontools-emptystate-desc' ),
			"Empty state message appears exactly once"
		);
		return $html;
	}

	public function testAddEmptyState_MissingPage() {
		$talkTitle = $this->sharedAddEmptyStateSetup();

		$this->sharedAddEmptyStateView( $talkTitle );
	}

	public function testMissingTalkPageForArticleAllowsCache() {
		$this->overrideConfigValue( 'UseCdn', true );
		$talkTitle = $this->sharedAddEmptyStateSetup();
		$context = $this->createEmptyStateContext( $talkTitle, '192.0.2.1' );
		$expectedCacheControl = 's-maxage=300, must-revalidate, max-age=0';

		$this->assertTrue( HookUtils::shouldDisplayEmptyState( $context ) );
		$article = Article::newFromTitle( $talkTitle, $context );
		$article->view();
		$output = $context->getOutput();
		$output->setCdnMaxage( 300 );
		$output->sendCacheControl();
		$this->assertSame(
			$expectedCacheControl,
			$context->getRequest()->response()->getHeader( 'Cache-Control' )
		);
	}

	public function testMissingTalkPageForRegisteredUserAllowsCache() {
		$this->overrideConfigValue( 'UseCdn', true );
		$talkTitle = $this->getTestUser()->getUser()->getTalkPage();
		$this->assertFalse( $talkTitle->exists() );
		$context = $this->createEmptyStateContext( $talkTitle, '192.0.2.1' );
		$expectedCacheControl = 's-maxage=300, must-revalidate, max-age=0';

		$this->assertTrue( HookUtils::shouldDisplayEmptyState( $context ) );
		$article = Article::newFromTitle( $talkTitle, $context );
		$article->view();
		$output = $context->getOutput();
		$output->setCdnMaxage( 300 );
		$output->sendCacheControl();
		$this->assertSame(
			$expectedCacheControl,
			$context->getRequest()->response()->getHeader( 'Cache-Control' )
		);
	}

	/**
	 * @dataProvider provideIpCases
	 */
	public function testMissingTalkPageForIpDisablesCache(
		string $ip,
		string $viewerIp,
		string $expectedMessageVariant,
		bool $expectedButtonPresent,
		string $expectedCacheControl
	) {
		$this->overrideConfigValue( 'UseCdn', true );
		$talkTitle = Title::makeTitle( NS_USER_TALK, $ip );
		$this->assertFalse( $talkTitle->exists() );
		$context = $this->createEmptyStateContext( $talkTitle, $viewerIp );

		$this->assertTrue( HookUtils::shouldDisplayEmptyState( $context ) );
		$article = Article::newFromTitle( $talkTitle, $context );
		$article->view();
		$html = $context->getOutput()->getHTML();
		$output = $context->getOutput();
		$output->setCdnMaxage( 300 );
		$output->sendCacheControl();
		$this->assertSame(
			$expectedCacheControl,
			$context->getRequest()->response()->getHeader( 'Cache-Control' )
		);
		$this->assertStringContainsString(
			'(discussiontools-emptystate-title-' . $expectedMessageVariant, $html
		);
		$this->assertStringContainsString(
			'(discussiontools-emptystate-desc-' . $expectedMessageVariant, $html
		);
		$this->assertSame(
			$expectedButtonPresent,
			str_contains( $html, '(discussiontools-emptystate-button)' ),
			'Presence of the Start a discussion button'
		);
	}

	public static function provideIpCases(): array {
		return [
			'own IPv4' => [
				'ip' => '192.0.2.1',
				'viewerIp' => '192.0.2.1',
				'expectedMessageVariant' => 'self-anon',
				'expectedButtonPresent' => false,
				'expectedCacheControl' => 'no-cache, no-store, max-age=0, must-revalidate',
			],
			'other IPv4' => [
				'ip' => '192.0.2.1',
				'viewerIp' => '192.0.2.2',
				'expectedMessageVariant' => 'user-anon',
				'expectedButtonPresent' => true,
				'expectedCacheControl' => 'no-cache, no-store, max-age=0, must-revalidate',
			],
			'own IPv6' => [
				'ip' => '2001:DB8:0:0:0:0:0:1',
				'viewerIp' => '2001:DB8:0:0:0:0:0:1',
				'expectedMessageVariant' => 'self-anon',
				'expectedButtonPresent' => false,
				'expectedCacheControl' => 'no-cache, no-store, max-age=0, must-revalidate',
			],
			'other IPv6' => [
				'ip' => '2001:DB8:0:0:0:0:0:1',
				'viewerIp' => '2001:DB8:0:0:0:0:0:2',
				'expectedMessageVariant' => 'user-anon',
				'expectedButtonPresent' => true,
				'expectedCacheControl' => 'no-cache, no-store, max-age=0, must-revalidate',
			],
		];
	}

	public function testAddEmptyState_ExistingPage() {
		$talkTitle = $this->sharedAddEmptyStateSetup();

		$this->editPage( $talkTitle, "" );
		$this->assertTrue( $talkTitle->exists() );

		$this->sharedAddEmptyStateView( $talkTitle );
	}

	public function testAddEmptyState_MissingPage_Talkpageheader() {
		$this->editPage( 'MediaWiki:Talkpageheader', 'TALKPAGEHEADER' );
		$talkTitle = $this->sharedAddEmptyStateSetup();

		$html = $this->sharedAddEmptyStateView( $talkTitle );
		$this->assertStringContainsString( '(talkpageheader)', $html );
	}

	public function testAddEmptyState_ExistingPage_Talkpageheader() {
		$this->editPage( 'MediaWiki:Talkpageheader', 'TALKPAGEHEADER' );
		$talkTitle = $this->sharedAddEmptyStateSetup();

		$this->editPage( $talkTitle, "" );
		$this->assertTrue( $talkTitle->exists() );

		$html = $this->sharedAddEmptyStateView( $talkTitle );
		$this->assertStringContainsString( '(talkpageheader)', $html );
	}

}
