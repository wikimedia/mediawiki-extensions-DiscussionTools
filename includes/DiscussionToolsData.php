<?php
/**
 * DiscussionTools data generators
 *
 * @file
 * @ingroup Extensions
 * @license MIT
 */

use MediaWiki\MediaWikiServices;

class DiscussionToolsData {
	/**
	 * Part of the 'ext.discussionTools.init' module.
	 *
	 * We need all of this data *in content language*. Some of it is already available in JS, but only
	 * in client language, so it's useless for us (e.g. digit transform table, month name messages).
	 *
	 * @param ResourceLoaderContext $context
	 * @param Config $config
	 * @param string|null $langCode
	 * @return array
	 */
	public static function getLocalData(
		ResourceLoaderContext $context, Config $config, $langCode = null
	) {
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

		$data['specialContributionsName'] = MediaWikiServices::getInstance()
			->getSpecialPageFactory()->getLocalNameFor( 'Contributions' );

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
			Language::WEEKDAY_MESSAGES,
			Language::WEEKDAY_ABBREVIATED_MESSAGES,
			Language::MONTH_MESSAGES,
			Language::MONTH_GENITIVE_MESSAGES,
			Language::MONTH_ABBREVIATED_MESSAGES
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
