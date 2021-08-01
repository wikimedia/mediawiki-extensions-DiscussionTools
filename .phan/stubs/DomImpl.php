<?php
# For now, type check against the PHP `dom` extension.
# Eventually we'll want to type check against IDLeDOM, as Parsoid does.
// phpcs:disable Generic.Files.LineLength.TooLong

class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\Attr", "Wikimedia\\Parsoid\\DOM\\Attr" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\CharacterData", "Wikimedia\\Parsoid\\DOM\\CharacterData" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\Comment", "Wikimedia\\Parsoid\\DOM\\Comment" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\Document", "Wikimedia\\Parsoid\\DOM\\Document" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\DocumentFragment", "Wikimedia\\Parsoid\\DOM\\DocumentFragment" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\DocumentType", "Wikimedia\\Parsoid\\DOM\\DocumentType" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\DOMException", "Wikimedia\\Parsoid\\DOM\\DOMException" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\DOMParser", "Wikimedia\\Parsoid\\DOM\\DOMParser" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\Element", "Wikimedia\\Parsoid\\DOM\\Element" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\Node", "Wikimedia\\Parsoid\\DOM\\Node" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\NodeList", "Wikimedia\\Parsoid\\DOM\\NodeList" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\ProcessingInstruction", "Wikimedia\\Parsoid\\DOM\\ProcessingInstruction" );
class_alias( "Wikimedia\\Parsoid\\DOM\\Compat\\Text", "Wikimedia\\Parsoid\\DOM\\Text" );
