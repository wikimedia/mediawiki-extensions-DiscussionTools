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

	this.api = new mw.Api( { formatversion: 2 } );
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

/* Methods */

MWUsernameCompletionAction.prototype.open = function () {
	var surfaceModel = this.surface.getModel(),
		data = surfaceModel.getDocument().data,
		offset = surfaceModel.getSelection().getRange(),
		// The character before the @:
		precedingCharacterOffset = new ve.Range(
			offset.from - MWUsernameCompletionAction.static.triggerLength - 1,
			offset.from - MWUsernameCompletionAction.static.triggerLength
		),
		precedingCharacter = data.getText( false, precedingCharacterOffset );

	// This is fundamentally "don't trigger on email addresses"
	if ( precedingCharacter && !precedingCharacter.match( /\s/ ) ) {
		return false;
	}

	return MWUsernameCompletionAction.super.prototype.open.apply( this, arguments );
};

MWUsernameCompletionAction.prototype.getSuggestions = function ( input ) {
	var capitalizedInput = input.length > 0 && input[ 0 ].toUpperCase() + input.slice( 1 ),
		action = this;

	this.api.abort(); // Abort all unfinished API requests
	if ( capitalizedInput && !this.searchedPrefixes[ capitalizedInput ] ) {
		this.api.get( {
			action: 'query',
			list: 'allusers',
			// Prefix of list=allusers is case sensitive, and users are stored in the DB capitalized, so:
			auprefix: capitalizedInput,
			aulimit: this.limit
		} ).done( function ( response ) {
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
	}

	return ve.createDeferred().resolve(
		// By concatenating on-thread authors and remote-fetched authors, both
		// sorted alphabetically, we'll get our suggestion popup sorted so all
		// on-thread matches come first.
		this.filterSuggestionsForInput(
			this.localUsers
				// Show no remote users if no input provided
				.concat( capitalizedInput ? this.remoteUsers : [] ),
			// TODO: Consider showing IP users
			// * Change link to Special:Contributions/<ip> (localised)
			// * Let users know that mentioning an IP will not create a notification?
			// .concat( this.ipUsers )
			input
		)
	).promise();
};

MWUsernameCompletionAction.prototype.insertCompletion = function ( word, range ) {
	var fragment,
		// TODO: Allow output customisation (T250332)
		prefix = '@',
		title = mw.Title.newFromText( word, mw.config.get( 'wgNamespaceIds' ).user ),
		annotation = ve.dm.MWInternalLinkAnnotation.static.newFromTitle( title );
	if ( this.surface.getMode() === 'source' ) {
		// TODO: this should be configurable per-wiki so that e.g. custom templates can be used
		word = prefix + '[[' + title.getPrefixedText() + '|' + word + ']]';
		return MWUsernameCompletionAction.super.prototype.insertCompletion.call( this, word, range );
	}
	fragment = MWUsernameCompletionAction.super.prototype.insertCompletion.apply( this, arguments )
		.annotateContent( 'clear', 'link' ).annotateContent( 'clear', 'link/mwInternal' )
		.annotateContent( 'set', annotation );

	fragment.collapseToStart().insertContent( '@' );

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
		'showMWUsernameCompletions', MWUsernameCompletionAction.static.name, 'open',
		{ supportedSelections: [ 'linear' ] }
	)
);
ve.ui.sequenceRegistry.register(
	new ve.ui.Sequence( 'autocompleteMWUsernames', 'showMWUsernameCompletions', '@', 0, false, false, true )
);
ve.ui.wikitextSequenceRegistry.register(
	new ve.ui.Sequence( 'autocompleteMWUsernamesWikitext', 'showMWUsernameCompletions', '@', 0, false, false, true )
);

module.exports = MWUsernameCompletionAction;
