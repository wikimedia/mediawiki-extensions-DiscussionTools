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
	public static function getLocalData( ResourceLoaderContext $context, Config $config, $langCode = null ) {
		if ( $langCode ) {
			$lang = Language::factory( $langCode );
		} else {
			$lang = MediaWikiServices::getInstance()->getContentLanguage();
		}

		$data = [];

		$data['dateFormat'] = $lang->getDateFormatString( 'both', $lang->dateFormat( false ) );

		// TODO: We probably shouldn't assume that each digit can be represented by a single BMP
		// codepoint in every language (although it seems to be true right now).
		$data['digits'] = $lang->formatNum( '0123456789', true );

		// ApiQuerySiteinfo
		$data['localTimezone'] = $config->get( 'Localtimezone' );

		$data['specialContributionsName'] = SpecialPageFactory::getLocalNameFor( 'Contributions' );

		$localTimezone = $config->get( 'Localtimezone' );
		// Return only timezone abbreviations for the local timezone (there will often be two, for
		// non-DST and DST timestamps, and sometimes more due to historical data, but that's okay).
		$timezoneAbbrs = array_keys( array_filter(
			timezone_abbreviations_list(),
			function ( $timezones ) use ( $localTimezone ) {
				foreach ( $timezones as $tz ) {
					if ( $tz['timezone_id'] === $localTimezone ) {
						return true;
					}
				}
				return false;
			}
		) );
		$data['timezones'] = array_combine(
			array_map( function ( $tzMsg ) use ( $lang ) {
				// MWTimestamp::getTimezoneMessage()
				// Parser::pstPass2()
				// Messages used here: 'timezone-utc' and so on
				$key = 'timezone-' . strtolower( trim( $tzMsg ) );
				$msg = wfMessage( $key )->inLanguage( $lang );
				// TODO: This probably causes a similar issue to https://phabricator.wikimedia.org/T221294,
				// but we *must* check the message existence in the database, because the messages are not
				// actually defined by MediaWiki core for any timezone other than UTC...
				if ( $msg->exists() ) {
					return $msg->text();
				}
				return strtoupper( $tzMsg );
			}, $timezoneAbbrs ),
			array_map( 'strtoupper', $timezoneAbbrs )
		);

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
			array_map( function ( $key ) use ( $lang ) {
				return wfMessage( $key )->inLanguage( $lang )->text();
			}, $messagesKeys )
		);

		// How far backwards we look for a signature associated with a timestamp before giving up.
		// Note that this is not a hard limit on the length of signatures we detect.
		$data['signatureScanLimit'] = 100;

		return $data;
	}
}
