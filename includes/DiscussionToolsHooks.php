<?php
/**
 * DiscussionTools extension hooks
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

use MediaWiki\MediaWikiServices;

class DiscussionToolsHooks {
	/**
	 * Adds DiscussionTools JS to the output.
	 *
	 * This is attached to the MediaWiki 'BeforePageDisplay' hook.
	 *
	 * @param OutputPage $output The page view.
	 * @param Skin $skin The skin that's going to build the UI.
	 */
	public static function onBeforePageDisplay( OutputPage $output, Skin $skin ) {
		$title = $output->getTitle();
		if (
			// Only wikitext pages (e.g. not Flow boards)
			$title->getContentModel() === CONTENT_MODEL_WIKITEXT &&
			$title->isTalkPage()
			// TODO: Allow non talk pages to be treated as talk pages
			// using a magic word.
		) {
			$output->addModules( [
				'ext.discussionTools.init'
			] );
		}
	}

	/**
	 * Part of the 'ext.discussionTools.init' module.
	 *
	 * We need all of this data *in content language*. Some of it is already available in JS, but only
	 * in client language, so it's useless for us (e.g. digit transform table, month name messages).
	 *
	 * @return array
	 */
	public static function getLocalData() {
		$lang = MediaWikiServices::getInstance()->getContentLanguage();
		$config = MediaWikiServices::getInstance()->getMainConfig();

		$data = [];

		$data['dateFormat'] = $lang->getDateFormatString( 'both', $lang->dateFormat( false ) );

		// TODO: We probably shouldn't assume that each digit can be represented by a single BMP
		// codepoint in every language (although it seems to be true right now).
		$data['digits'] = $lang->formatNum( '0123456789', true );

		// ApiQuerySiteinfo
		$data['localTimezone'] = $config->get( 'Localtimezone' );
		// This changes magically with DST
		$data['localTimezoneOffset'] = (int)$config->get( 'LocalTZoffset' );

		$data['specialContributionsName'] = SpecialPageFactory::getLocalNameFor( 'Contributions' );

		// TODO: This should only include abbreviations for $wgLocaltimezone, but timezones can have
		// multiple abbreviations (non-DST and DST) and we can't get them easily? For example CET and
		// CEST for 'Europe/Warsaw'.
		$data['timezones'] = array_map( function ( $tzMsg ) {
			// MWTimestamp::getTimezoneMessage()
			// Parser::pstPass2()
			// Messages used here: 'timezone-utc' and so on
			$key = 'timezone-' . strtolower( trim( $tzMsg ) );
			$msg = wfMessage( $key )->inContentLanguage();
			// TODO: This probably causes a similar issue to https://phabricator.wikimedia.org/T221294,
			// but we *must* check the message existence in the database, because the messages are not
			// actually defined by MediaWiki core for any timezone other than UTC...
			if ( $msg->exists() ) {
				return $msg->text();
			}

			return strtoupper( $tzMsg );
		}, array_keys( timezone_abbreviations_list() ) );

		// Messages in content language
		$messagesKeys = array_merge(
			Language::$mWeekdayMsgs,
			Language::$mWeekdayAbbrevMsgs,
			Language::$mMonthMsgs,
			Language::$mMonthGenMsgs,
			Language::$mMonthAbbrevMsgs
		);
		$data['contLangMessages'] = array_combine(
			$messagesKeys,
			array_map( function ( $key ) {
				return wfMessage( $key )->inContentLanguage()->text();
			}, $messagesKeys )
		);

		// How far backwards we look for a signature associated with a timestamp before giving up.
		// Note that this is not a hard limit on the length of signatures we detect.
		$data['signatureScanLimit'] = 100;

		return $data;
	}
}
