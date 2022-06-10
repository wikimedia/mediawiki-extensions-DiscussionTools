/**
 * MemoryStorage creates a wrapper around mw.SafeStorage objects, duplicating
 * their contents in memory, so that even if the underlying storage mechanism
 * fails (e.g. quota exceeded), the storage can be relied on before the
 * page has been reloaded.
 *
 * @example
 * var sessionStorage = new MemoryStorage( mw.storage.session.store );
 * var localStorage = new MemoryStorage( mw.storage.store );
 *
 * @class
 * @extends mw.SafeStorage
 * @param {Object} store
 */
function MemoryStorage() {
	this.data = {};

	// Parent constructor
	MemoryStorage.super.apply( this, arguments );
}

// HACK: SafeStorage is not exposed as a public API, but we can
// access it as the constructor of mw.storage.
var SafeStorage = mw.storage.constructor;

/* Inheritance */

OO.inheritClass( MemoryStorage, SafeStorage );

/* Methods */

/**
 * @inheritdoc
 */
MemoryStorage.prototype.get = function ( key ) {
	if ( Object.prototype.hasOwnProperty.call( this.data, key ) ) {
		return this.data[ key ];
	} else {
		// Parent method
		return MemoryStorage.super.prototype.get.apply( this, arguments );
	}
};

/**
 * @inheritdoc
 */
MemoryStorage.prototype.set = function ( key, value ) {
	// Parent method
	MemoryStorage.super.prototype.set.apply( this, arguments );

	this.data[ key ] = value;
	return true;
};

/**
 * @inheritdoc
 */
MemoryStorage.prototype.remove = function ( key ) {
	// Parent method
	MemoryStorage.super.prototype.remove.apply( this, arguments );

	delete this.data[ key ];
	return true;
};

module.exports = MemoryStorage;
