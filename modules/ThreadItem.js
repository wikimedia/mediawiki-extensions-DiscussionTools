function ThreadItem( type, level, range ) {
	this.type = type;
	this.level = level;
	this.range = range;

	this.id = null;
	this.replies = [];
}

OO.initClass( ThreadItem );

module.exports = ThreadItem;
