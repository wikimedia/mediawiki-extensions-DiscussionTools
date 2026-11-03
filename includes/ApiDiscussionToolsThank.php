<?php

namespace MediaWiki\Extension\DiscussionTools;

use MediaWiki\Api\ApiBase;
use MediaWiki\Api\ApiMain;
use MediaWiki\Api\ApiUsageException;
use MediaWiki\Extension\DiscussionTools\Hooks\HookUtils;
use MediaWiki\Extension\DiscussionTools\ThreadItem\ContentCommentItem;
use MediaWiki\Extension\Notifications\Model\Event;
use MediaWiki\Extension\Thanks\Api\ApiThank;
use MediaWiki\Extension\Thanks\Storage\LogStore;
use MediaWiki\Extension\VisualEditor\ApiParsoidTrait;
use MediaWiki\Permissions\PermissionManager;
use MediaWiki\Revision\RevisionLookup;
use MediaWiki\Title\Title;
use MediaWiki\User\TempUser\TempUserDetailsLookup;
use MediaWiki\User\UserFactory;
use Wikimedia\ParamValidator\ParamValidator;

/**
 * API module to send DiscussionTools comment thanks notifications
 *
 * @ingroup API
 * @ingroup Extensions
 */
class ApiDiscussionToolsThank extends ApiThank {

	use ApiDiscussionToolsTrait;
	use ApiParsoidTrait;

	public function __construct(
		ApiMain $main,
		string $action,
		PermissionManager $permissionManager,
		LogStore $storage,
		private readonly RevisionLookup $revisionLookup,
		private readonly UserFactory $userFactory,
		TempUserDetailsLookup $tempUserDetailsLookup,
	) {
		parent::__construct( $main, $action, $permissionManager, $storage, $tempUserDetailsLookup );
	}

	/**
	 * @inheritDoc
	 * @throws ApiUsageException
	 */
	public function execute() {
		$user = $this->getUser();
		$this->dieOnBadUser( $user );
		$this->dieOnUserBlockedFromThanks( $user );

		$params = $this->extractRequestParams();

		$title = Title::newFromText( $params['page'] );
		$commentId = $params['commentid'];

		if ( !$title ) {
			$this->dieWithError( [ 'apierror-invalidtitle', wfEscapeWikiText( $params['page'] ) ] );
		}

		// TODO: Using the data in the permalinks database would be much
		// faster, we just wouldn't have the comment content.

		// Support oldid?
		$revision = $this->revisionLookup->getRevisionByTitle( $title );
		if ( !$revision ) {
			throw ApiUsageException::newWithMessage(
				$this,
				[ 'apierror-missingrev-title', wfEscapeWikiText( $title->getPrefixedText() ) ],
				'nosuchrevid'
			);
		}
		$status = HookUtils::parseRevisionParsoidHtml( $revision, __METHOD__ );
		if ( !$status->isOK() ) {
			$this->dieStatus( $status );
		}
		$threadItemSet = $status->getValueOrThrow();

		$comment = $threadItemSet->findCommentById( $commentId );

		if ( !$comment || !( $comment instanceof ContentCommentItem ) ) {
			$this->dieWithError( [ 'apierror-discussiontools-commentid-notfound', $commentId ] );
		}

		// Thanks are stored by comment name, which stays the same when the heading is renamed
		// or the comment is moved to another section, unlike the comment ID. Older thanks were
		// stored by comment ID, so check both to prevent thanking the same comment twice.
		$request = $user->getRequest();
		if (
			$request->getSessionData( "discussiontools-thanked-{$comment->getName()}" ) ||
			$request->getSessionData( "discussiontools-thanked-{$comment->getId()}" )
		) {
			$this->markResultSuccess( $comment->getAuthor() );
			return;
		}

		$uniqueId = "discussiontools-{$comment->getName()}";
		// Do one last check to make sure we haven't sent Thanks before
		if (
			$this->haveAlreadyThanked( $user, $uniqueId ) ||
			$this->haveAlreadyThanked( $user, "discussiontools-{$comment->getId()}" )
		) {
			// Pretend the thanks were sent
			$this->markResultSuccess( $comment->getAuthor() );
			return;
		}

		$recipient = $this->userFactory->newFromName( $comment->getAuthor() );
		if ( !$recipient || !$recipient->getId() ) {
			$this->dieWithError( 'thanks-error-invalidrecipient', 'invalidrecipient' );
		}

		$this->dieOnBadRecipient( $user, $recipient );

		$heading = $comment->getSubscribableHeading();
		if ( !$heading ) {
			$heading = $comment->getHeading();
		}

		// Create the notification via Echo extension
		Event::create( [
			'type' => 'dt-thank',
			'title' => $title,
			'extra' => [
				'comment-id' => $comment->getId(),
				'comment-name' => $comment->getName(),
				'content' => $comment->getBodyText( true ),
				'section-title' => $heading->getLinkableTitle(),
				'thanked-user-id' => $recipient->getId(),
				'revid' => $revision->getId(),
			],
			'agent' => $user,
		] );

		// And mark the thank in session for a cheaper check to prevent duplicates (T48690).
		$request->setSessionData( "discussiontools-thanked-{$comment->getName()}", true );
		// Set success message.
		$this->markResultSuccess( $recipient->getName() );
		$this->logThanks( $user, $recipient, $uniqueId );
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams() {
		return [
			'page' => [
				ParamValidator::PARAM_REQUIRED => true,
				// Message will exist if DiscussionTools is installed as VE is a dependency
				ApiBase::PARAM_HELP_MSG => 'apihelp-visualeditoredit-param-page',
			],
			'commentid' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => 'string',
			],
			'token' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => 'string',
			],
		];
	}
}
