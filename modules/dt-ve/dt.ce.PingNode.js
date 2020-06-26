/*!
 * VisualEditor ContentEditable MWPingNode class.
 *
 * @copyright 2011-2020 VisualEditor Team and others; see AUTHORS.txt
 * @license The MIT License (MIT); see LICENSE.txt
 */

/**
 * @external DmMWPingNode
 */

/**
 * ContentEditable MediaWiki ping node.
 *
 * @class
 * @extends ve.ce.LeafNode
 * @mixins ve.ce.FocusableNode
 *
 * @constructor
 * @param {DmMWPingNode} model Model to observe
 * @param {Object} [config] Configuration options
 */
function CeMWPingNode() {
	// Parent constructor
	CeMWPingNode.super.apply( this, arguments );

	// Mixin constructor
	ve.ce.FocusableNode.call( this );
}

/* Inheritance */

OO.inheritClass( CeMWPingNode, ve.ce.LeafNode );

OO.mixinClass( CeMWPingNode, ve.ce.FocusableNode );

/* Static Properties */

CeMWPingNode.static.name = 'mwPing';

CeMWPingNode.static.tagName = 'a';

CeMWPingNode.static.getDescription = function ( model ) {
	return model.getAttribute( 'user' );
};

/* Methods */

/**
 * @inheritdoc
 */
CeMWPingNode.prototype.initialize = function () {
	var model = this.getModel(),
		user = model.getAttribute( 'user' ),
		title = mw.Title.makeTitle( mw.config.get( 'wgNamespaceIds' ).user, user );

	// Parent method
	CeMWPingNode.super.prototype.initialize.call( this );

	// DOM changes
	this.$element
		.addClass( 'dt-ce-mwPingNode' )
		.attr( {
			href: title.getUrl(),
			title: user
		} )
		.text( model.getAttribute( 'user' ) );

	ve.init.platform.linkCache.styleElement(
		title.getPrefixedText(),
		this.$element
	);

};

/* Registration */

ve.ce.nodeFactory.register( CeMWPingNode );
