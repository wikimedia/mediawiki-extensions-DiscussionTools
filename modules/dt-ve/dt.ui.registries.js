var commandRegistry, sequenceRegistry;

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
commandRegistry = new ve.ui.CommandRegistry();
importRegistry( ve.ui.commandRegistry, commandRegistry );
sequenceRegistry = new ve.ui.SequenceRegistry();
importRegistry( ve.ui.sequenceRegistry, sequenceRegistry );

// Disable find-and-replace (T263570)
commandRegistry.unregister( 'findAndReplace' );
commandRegistry.unregister( 'findNext' );
commandRegistry.unregister( 'findPrevious' );

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

module.exports = {
	commandRegistry: commandRegistry,
	sequenceRegistry: sequenceRegistry
};
