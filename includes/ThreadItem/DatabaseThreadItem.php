<?php

namespace MediaWiki\Extension\DiscussionTools\ThreadItem;

use JsonSerializable;

class DatabaseThreadItem implements JsonSerializable, ThreadItem {
	use ThreadItemTrait;

	/** @var string */
	private $type;
	/** @var string */
	private $name;
	/** @var string */
	private $id;
	/** @var DatabaseThreadItem|null */
	private $parent;
	/** @var DatabaseThreadItem[] */
	private $replies = [];
	/** @var string|bool */
	private $transcludedFrom;
	/** @var int */
	private $level;

	/**
	 * @param string $type
	 * @param string $name
	 * @param string $id
	 * @param DatabaseThreadItem|null $parent
	 * @param bool|string $transcludedFrom
	 * @param int $level
	 */
	public function __construct(
		string $type, string $name, string $id, ?DatabaseThreadItem $parent, $transcludedFrom, int $level
	) {
		$this->name = $name;
		$this->id = $id;
		$this->type = $type;
		$this->parent = $parent;
		$this->transcludedFrom = $transcludedFrom;
		$this->level = $level;
	}

	/**
	 * @inheritDoc
	 */
	public function getName(): string {
		return $this->name;
	}

	/**
	 * @param DatabaseThreadItem $reply Reply comment
	 */
	public function addReply( DatabaseThreadItem $reply ): void {
		$this->replies[] = $reply;
	}

	/**
	 * @inheritDoc
	 */
	public function getId(): string {
		return $this->id;
	}

	/**
	 * @inheritDoc
	 */
	public function getType(): string {
		return $this->type;
	}

	/**
	 * @inheritDoc
	 * @return DatabaseThreadItem|null
	 */
	public function getParent(): ?ThreadItem {
		return $this->parent;
	}

	/**
	 * @inheritDoc
	 * @return DatabaseThreadItem[]
	 */
	public function getReplies(): array {
		return $this->replies;
	}

	/**
	 * @inheritDoc
	 */
	public function getTranscludedFrom() {
		return $this->transcludedFrom;
	}

	/**
	 * @inheritDoc
	 */
	public function getLevel(): int {
		return $this->level;
	}
}