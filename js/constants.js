'use strict';

// ---------------------------------------------------------------------------
// Map geometry
// ---------------------------------------------------------------------------
const TILE_SIZE   = 32;
const MAP_WIDTH   = 25;
const MAP_HEIGHT  = 20;

// ---------------------------------------------------------------------------
// Tile type IDs
// ---------------------------------------------------------------------------
const TILE = Object.freeze({
  GRASS:    0,   // Surface walkable ground
  BUILDING: 1,   // Impassable building wall/facade
  SHOP:     2,   // Shop door – press E to buy upgrades & sell gems
  BAR:      3,   // Bar door  – press E to talk to the girl
  DOCTOR:   4,   // Doctor building door – press E to heal / buy extra hearts
  MINE_ENT: 5,   // Mine entrance (right side of surface)
  DIRT:     6,   // Unexcavated mine tile (hides content)
  EMPTY:    7,   // Mined-out open space
  GEM_LOW:  8,   // Revealed low-value gem  (Emerald)
  GEM_MED:  9,   // Revealed medium-value gem (Sapphire)
  GEM_HIGH: 10,  // Revealed high-value gem  (Ruby)
  WATER:    11,  // Water – blocks movement
  LAVA:     12,  // Lava  – deals 1 heart damage on contact
  SHOVEL:   13,  // Revealed shovel item
  PICK:     14,  // Revealed pick item
  BAG:      15,  // Revealed large-bag item
});

// ---------------------------------------------------------------------------
// Hidden content types (what lives inside a DIRT tile)
// ---------------------------------------------------------------------------
const HIDDEN = Object.freeze({
  NOTHING:  'nothing',
  GEM_LOW:  'gem_low',
  GEM_MED:  'gem_med',
  GEM_HIGH: 'gem_high',
  WATER:    'water',
  LAVA:     'lava',
  SHOVEL:   'shovel',
  PICK:     'pick',
  BAG:      'bag',
});

// ---------------------------------------------------------------------------
// Gem sell values (coins)
// ---------------------------------------------------------------------------
const GEM_VALUE = Object.freeze({
  [HIDDEN.GEM_LOW]:  10,
  [HIDDEN.GEM_MED]:  30,
  [HIDDEN.GEM_HIGH]: 75,
});

// ---------------------------------------------------------------------------
// Shop items
// ---------------------------------------------------------------------------
const SHOP_ITEMS = [
  {
    id:      'shovel',
    name:    'Shovel',
    price:   50,
    desc:    'Reduces digging effort (-8 probes per tile)',
    oneTime: true,
  },
  {
    id:      'pick',
    name:    'Pick',
    price:   100,
    desc:    'Further reduces digging effort (-8 probes per tile)',
    oneTime: true,
  },
  {
    id:      'bag',
    name:    'Large Bag',
    price:   75,
    desc:    'Doubles gem carry capacity (10 → 20)',
    oneTime: true,
  },
  {
    id:      'ring',
    name:    'Ring 💍',
    price:   500,
    desc:    'For the girl at the bar…',
    oneTime: true,
  },
];

// ---------------------------------------------------------------------------
// Doctor services
// ---------------------------------------------------------------------------
const HEAL_PRICE       = 40;   // Cost to restore 1 heart
const EXTRA_HEART_PRICE = 150; // Cost to add +1 max heart (up to MAX_HEARTS)
const MAX_HEARTS        = 6;
const START_HEARTS      = 3;

// ---------------------------------------------------------------------------
// Reveal thresholds
// ---------------------------------------------------------------------------
const REVEAL_MIN      = 18;   // Minimum probe count to reveal a dirt tile
const REVEAL_MAX      = 60;   // Maximum probe count to reveal a dirt tile
const TOOL_REDUCTION  = 8;    // Each tool (shovel / pick) reduces threshold by this

// ---------------------------------------------------------------------------
// Hazard spread
// ---------------------------------------------------------------------------
const HAZARD_SPREAD = 12;  // Max EMPTY tiles a water/lava spring floods

// ---------------------------------------------------------------------------
// Mine entrance x-range (right side of surface row)
// ---------------------------------------------------------------------------
const MINE_ENT_X_MIN = 22;
const MINE_ENT_X_MAX = 24;

// ---------------------------------------------------------------------------
// Player start position
// ---------------------------------------------------------------------------
const PLAYER_START_X = 11;
const PLAYER_START_Y = 0;

// ---------------------------------------------------------------------------
// Tile render colours (VGA-inspired palette)
// ---------------------------------------------------------------------------
const TILE_COLOR = {
  [TILE.GRASS]:    '#4a7a28',
  [TILE.BUILDING]: '#6e4c24',
  [TILE.SHOP]:     '#e8c040',
  [TILE.BAR]:      '#d45090',
  [TILE.DOCTOR]:   '#40b8d4',
  [TILE.MINE_ENT]: '#151520',
  [TILE.DIRT]:     '#6b3822',
  [TILE.EMPTY]:    '#1a1a1a',
  [TILE.GEM_LOW]:  '#00c864',
  [TILE.GEM_MED]:  '#3a7aff',
  [TILE.GEM_HIGH]: '#ff2222',
  [TILE.WATER]:    '#1555cc',
  [TILE.LAVA]:     '#dd3300',
  [TILE.SHOVEL]:   '#ccaa44',
  [TILE.PICK]:     '#aabbcc',
  [TILE.BAG]:      '#aa8833',
};
