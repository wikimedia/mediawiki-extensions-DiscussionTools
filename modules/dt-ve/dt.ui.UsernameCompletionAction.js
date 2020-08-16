/*!
 * VisualEditor UserInterface MWUsernameCompletionAction class.
 *
 * @copyright 2011-2019 VisualEditor Team and others; see http://ve.mit-license.org
 */

/**
 * MWUsernameCompletionAction action.
 *
 * Controls autocompletion of usernames
 *
 * @class
 * @extends ve.ui.CompletionAction
 * @constructor
 * @param {ve.ui.Surface} surface Surface to act on
 */
function MWUsernameCompletionAction( surface ) {
	var action = this;

	// Parent constructor
	MWUsernameCompletionAction.super.call( this, surface );

	this.api = new mw.Api( { parameters: { formatversion: 2 } } );
	this.searchedPrefixes = {};
	this.localUsers = [];
	this.ipUsers = [];
	this.surface.authors.forEach( function ( user ) {
		if ( mw.util.isIPAddress( user ) ) {
			action.ipUsers.push( user );
		} else {
			action.localUsers.push( user );
		}
	} );
	this.remoteUsers = [];
}

/* Inheritance */

OO.inheritClass( MWUsernameCompletionAction, ve.ui.CompletionAction );

/* Static Properties */

MWUsernameCompletionAction.static.name = 'mwUsernameCompletion';

MWUsernameCompletionAction.static.methods = OO.copy( MWUsernameCompletionAction.static.methods );
MWUsernameCompletionAction.static.methods.push( 'insertAndOpen' );

/* Methods */

MWUsernameCompletionAction.prototype.insertAndOpen = function () {
	// This is opening a window in a slightly weird way, so the normal logging
	// doesn't catch it. This assumes that the only way to get here is from
	// the tool. If we add other paths, we'd need to change the logging.
	ve.track(
		'activity.' + this.constructor.static.name,
		{ action: 'window-open-from-tool' }
	);
	this.surface.getModel().getFragment().insertContent( '@' ).collapseToEnd().select();
	return this.open();
};

MWUsernameCompletionAction.prototype.getSuggestions = function ( input ) {
	var apiPromise,
		capitalizedInput = input.length > 0 && input[ 0 ].toUpperCase() + input.slice( 1 ),
		action = this;

	this.api.abort(); // Abort all unfinished API requests
	if ( capitalizedInput && !this.searchedPrefixes[ capitalizedInput ] ) {
		apiPromise = this.api.get( {
			action: 'query',
			list: 'allusers',
			// Prefix of list=allusers is case sensitive, and users are stored in the DB capitalized, so:
			auprefix: capitalizedInput,
			aulimit: this.limit
		} ).then( function ( response ) {
			var suggestions = response.query.allusers.map( function ( user ) {
				return user.name;
			} ).filter( function ( username ) {
				// API doesn't return IPs
				return action.localUsers.indexOf( username ) === -1 &&
					action.remoteUsers.indexOf( username ) === -1;
			} );

			action.remoteUsers.push.apply( action.remoteUsers, suggestions );
			action.remoteUsers.sort();

			action.searchedPrefixes[ capitalizedInput ] = true;
		} );
	} else {
		apiPromise = ve.createDeferred().resolve().promise();
	}

	return apiPromise.then( function () {
		// By concatenating on-thread authors and remote-fetched authors, both
		// sorted alphabetically, we'll get our suggestion popup sorted so all
		// on-thread matches come first.
		return action.filterSuggestionsForInput(
			action.localUsers
				// Show no remote users if no input provided
				.concat( capitalizedInput ? action.remoteUsers : [] ),
			// TODO: Consider showing IP users
			// * Change link to Special:Contributions/<ip> (localised)
			// * Let users know that mentioning an IP will not create a notification?
			// .concat( this.ipUsers )
			input
		);
	} );
};

MWUsernameCompletionAction.prototype.getHeaderLabel = function ( input, suggestions ) {
	var $query;
	if ( suggestions === undefined ) {
		$query = $( '<span>' ).text( input );
		return mw.message( 'discussiontools-replywidget-mention-tool-header', $query ).parseDom();
	}
};

MWUsernameCompletionAction.prototype.insertCompletion = function ( word, range ) {
	var fragment,
		prefix = mw.msg( 'discussiontools-replywidget-mention-prefix' ),
		title = mw.Title.newFromText( word, mw.config.get( 'wgNamespaceIds' ).user );

	if ( this.surface.getMode() === 'source' ) {
		// TODO: this should be configurable per-wiki so that e.g. custom templates can be used
		word = prefix + '[[' + title.getPrefixedText() + '|' + word + ']]';
		return MWUsernameCompletionAction.super.prototype.insertCompletion.call( this, word, range );
	}

	fragment = this.surface.getModel().getLinearFragment( range );
	fragment.removeContent().insertContent( [
		{ type: 'mwPing', attributes: { user: word } },
		{ type: '/mwPing' }
	] );

	fragment.collapseToStart().insertContent( prefix );

	return fragment;
};

MWUsernameCompletionAction.prototype.shouldAbandon = function ( input ) {
	// TODO: need to consider whether pending loads from server are happening here
	return MWUsernameCompletionAction.super.prototype.shouldAbandon.apply( this, arguments ) && input.split( /\s+/ ).length > 2;
};

/* Registration */

ve.ui.actionFactory.register( MWUsernameCompletionAction );

ve.ui.commandRegistry.register(
	new ve.ui.Command(
		'openMWUsernameCompletions', MWUsernameCompletionAction.static.name, 'open',
		{ supportedSelections: [ 'linear' ] }
	)
);
ve.ui.commandRegistry.register(
	new ve.ui.Command(
		'insertAndOpenMWUsernameCompletions', MWUsernameCompletionAction.static.name, 'insertAndOpen',
		{ supportedSelections: [ 'linear' ] }
	)
);
ve.ui.sequenceRegistry.register(
	new ve.ui.Sequence( 'autocompleteMWUsernames', 'openMWUsernameCompletions', '@', 0, false, false, true, true )
);
ve.ui.wikitextSequenceRegistry.register(
	new ve.ui.Sequence( 'autocompleteMWUsernamesWikitext', 'openMWUsernameCompletions', '@', 0, false, false, true, true )
);

module.exports = MWUsernameCompletionAction;
