// Adapted from ve.ui.MWWikitextDataTransferHandlerFactory
function importRegistry( parent, child ) {
	var name;
	// Copy existing items
	for ( name in parent.registry ) {
		child.register( parent.registry[ name ] );
	}
	// Copy any new items when they're added
	parent.on( 'register', function ( n, data ) {
		child.register( data );
	} );
}

// Create new registries so that we can override the behavior for signatures
// without affecting normal VisualEditor.
var commandRegistry = new ve.ui.CommandRegistry();
importRegistry( ve.ui.commandRegistry, commandRegistry );
var sequenceRegistry = new ve.ui.SequenceRegistry();
importRegistry( ve.ui.sequenceRegistry, sequenceRegistry );

var wikitextCommandRegistry = new ve.ui.MWWikitextCommandRegistry( commandRegistry );
importRegistry( ve.ui.wikitextCommandRegistry, wikitextCommandRegistry );
var wikitextSequenceRegistry = new ve.ui.SequenceRegistry();
importRegistry( ve.ui.wikitextSequenceRegistry, wikitextSequenceRegistry );

// Disable find-and-replace (T263570)
commandRegistry.unregister( 'findAndReplace' );
commandRegistry.unregister( 'findNext' );
commandRegistry.unregister( 'findPrevious' );
wikitextCommandRegistry.unregister( 'findAndReplace' );
wikitextCommandRegistry.unregister( 'findNext' );
wikitextCommandRegistry.unregister( 'findPrevious' );

// Command to insert signature node. Unlike normal VisualEditor, we want to select
// the node (collapseToEnd=false), because we want to show its context menu.
commandRegistry.unregister( 'mwSignature' );
commandRegistry.register(
	new ve.ui.Command( 'dtMwSignature', 'content', 'insert', {
		args: [
			[
				{ type: 'dtMwSignature' },
				{ type: '/dtMwSignature' }
			],
			// annotate
			false,
			// collapseToEnd
			false
		],
		supportedSelections: [ 'linear' ]
	} )
);
// Unlike normal VisualEditor, this is registered regardless of the namespace.
sequenceRegistry.unregister( 'wikitextSignature' );
sequenceRegistry.register(
	new ve.ui.Sequence( 'dtWikitextSignature', 'dtMwSignature', '~~~~', 4 )
);

// TODO: Show a warning when typing ~~~~ in wikitext mode?

// Show wikitext warnings for disabled sequences (disabled via excludeCommand):

// insertTable
sequenceRegistry.register(
	new ve.ui.Sequence( 'wikitextTable', 'mwWikitextWarning', '{|' )
);
ve.ui.commandHelpRegistry.unregister( 'table' );

// transclusionFromSequence
sequenceRegistry.register(
	new ve.ui.Sequence( 'wikitextTemplate', 'mwWikitextWarning', '{{' )
);
ve.ui.commandHelpRegistry.unregister( 'template' );

// blockquoteWrap
sequenceRegistry.register(
	new ve.ui.Sequence( 'wikitextDescription', 'mwWikitextWarning', [ { type: 'paragraph' }, ':' ] )
);
ve.ui.commandHelpRegistry.unregister( 'blockquote' );

// heading1-6
// This sequence doesn't usually have a command as we don't know what
// heading level is required, but for warnings this doesn't matter.
sequenceRegistry.register(
	new ve.ui.Sequence( 'wikitextHeading', 'mwWikitextWarning', [ { type: 'paragraph' }, '=', '=' ] )
);
ve.ui.commandHelpRegistry.unregister( 'heading2' );

module.exports = {
	commandRegistry: commandRegistry,
	sequenceRegistry: sequenceRegistry,
	wikitextCommandRegistry: wikitextCommandRegistry,
	wikitextSequenceRegistry: wikitextSequenceRegistry
};
