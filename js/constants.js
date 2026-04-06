'use strict';

// ---------------------------------------------------------------------------
// Map geometry
// ---------------------------------------------------------------------------
const TILE_SIZE      = 34;
const MAP_WIDTH      = 24;   // Fixed horizontal width (tiles)

// Viewport – what the canvas shows at any one time
const VIEWPORT_COLS  = 24;   // Must equal MAP_WIDTH
const VIEWPORT_ROWS  = 14;   // Rows visible on screen

// Canvas pixel dimensions
const CANVAS_W       = VIEWPORT_COLS * TILE_SIZE;  // 816
const CANVAS_H       = VIEWPORT_ROWS * TILE_SIZE;  // 476

// Chunk generation
const CHUNK_SIZE     = 30;   // Mine rows generated per chunk
const GEN_LOOKAHEAD  = 20;   // Generate new chunk when within this many rows of deepest generated

// ---------------------------------------------------------------------------
// Tile type IDs
// ---------------------------------------------------------------------------
const TILE = Object.freeze({
  GRASS:        0,   // Surface ground (gaps between buildings)
  BUILDING:     1,   // Impassable building wall/facade
  SHOP:         2,   // Shop door at y=1 – interact from pavement by pressing E
  BAR:          3,   // Bar door at y=1
  DOCTOR:       4,   // Doctor door at y=1
  MINE_ENT:     5,   // Mine entrance arch (pavement crossing, x=22-24)
  DIRT:         6,   // Unexcavated mine tile (hides content)
  EMPTY:        7,   // Mined-out open space
  SILVER:       8,   // Revealed silver ore (common)
  GOLD:         9,   // Revealed gold ore (medium)
  PLATINUM:    10,   // Revealed platinum ore (uncommon)
  WATER:       11,   // Water hazard
  LAVA:        12,   // Lava hazard
  SHOVEL:      13,   // Revealed shovel item
  PICK:        14,   // Revealed pick item – breaks STONE
  BAG:         15,   // Revealed large-bag item
  STONE:       16,   // Solid stone block – impassable without a pick
  PAVEMENT:    17,   // Surface pavement row (y=2) – walkable
  BANK:        19,   // Town Bank facade – sell ore here
  OUTHOUSE:    20,   // Outhouse facade – cosmetic only
  DIAMOND:     21,   // Revealed diamond (rare, deeper mine)
  RUBY:        22,   // Unique legendary ruby (sell for big money)
  RUBBER_BOOT: 23,   // Unique item – walk through spread water without damage
  POCKET_WATCH:24,   // Unique novelty item
  GLASSES:     25,   // Unique novelty item
  JEWELER:     26,   // (unused) Jeweler building
  SKY:         27,   // Open sky between surface buildings (decorative, y=0)
  DYNAMITE:    28,   // Lit dynamite placed by the player – explodes after fuse
  RING:        29,   // Hidden ring – found ~50 m below the outhouse in the mine
  FLOWER:      30,   // Surface flower – collectible, to the left of the outhouse
  LANTERN:     31,   // Hidden lantern – enables adjacent dirt probing when found
  RADIO:       32,   // Hidden radio – teleports player to mine entrance when used
  SKULL:       33,   // Hidden skull – novelty collectible
  CANTEEN:     34,   // Hidden canteen – novelty collectible
  LUNCHBOX:    35,   // Hidden lunch box – novelty collectible
});

// ---------------------------------------------------------------------------
// Hidden content types (what lives inside a DIRT tile)
// ---------------------------------------------------------------------------
const HIDDEN = Object.freeze({
  NOTHING:      'nothing',
  SILVER:       'silver',
  GOLD:         'gold',
  PLATINUM:     'platinum',
  DIAMOND:      'diamond',
  WATER:        'water',
  LAVA:         'lava',
  STONE:        'stone',
  SHOVEL:       'shovel',
  PICK:         'pick',
  BAG:          'bag',
  RUBY:         'ruby',         // Unique – one per entire mine
  RUBBER_BOOT:  'rubber_boot',  // Unique – one per entire mine
  POCKET_WATCH: 'pocket_watch', // Unique – one per entire mine
  GLASSES:      'glasses',      // Unique – one per entire mine
  RING:         'ring',         // Unique – random position ~50 m below outhouse
  LANTERN:      'lantern',      // Unique – enables adjacent dirt probing when found
  RADIO:        'radio',        // Unique – teleports player to mine entrance
  SKULL:        'skull',        // Unique – novelty collectible
  CANTEEN:      'canteen',      // Unique – novelty collectible
  LUNCHBOX:     'lunchbox',     // Unique – novelty collectible
});

// ---------------------------------------------------------------------------
// Ore sell values (coins) – used by bank sell screen and gem pickup messages
// ---------------------------------------------------------------------------
const GEM_VALUE = Object.freeze({
  [HIDDEN.SILVER]:   8,
  [HIDDEN.GOLD]:    25,
  [HIDDEN.PLATINUM]: 65,
  [HIDDEN.DIAMOND]: 200,
  [HIDDEN.RUBY]:    500,
});

// Ore display names and icons (for sell screen)
const ORE_NAME = Object.freeze({
  [HIDDEN.SILVER]:   '🥈 Silver',
  [HIDDEN.GOLD]:     '🥇 Gold',
  [HIDDEN.PLATINUM]: '⬜ Platinum',
  [HIDDEN.DIAMOND]:  '💎 Diamond',
  [HIDDEN.RUBY]:     '🔴 Ruby',
});

// Flash colours shown behind the miner when each ore type is collected
const ORE_FLASH_COLOR = Object.freeze({
  [HIDDEN.SILVER]:   '#c8d8e0',
  [HIDDEN.GOLD]:     '#d4a800',
  [HIDDEN.PLATINUM]: '#b8ccd8',
  [HIDDEN.DIAMOND]:  '#88ddff',
  [HIDDEN.RUBY]:     '#ff3060',
});

// ---------------------------------------------------------------------------
// Tool durability (needed before SHOP_ITEMS template literals reference it)
// ---------------------------------------------------------------------------
const TOOL_USES = 10;  // Uses before pick / bucket / fire-extinguisher breaks

// ---------------------------------------------------------------------------
// Shop items
// ---------------------------------------------------------------------------
const SHOP_ITEMS = [
  {
    id:      'shovel',
    name:    'Shovel',
    icon:    '⛏',
    price:   50,
    desc:    'Reduces effort to reveal dirt tiles',
    oneTime: true,
  },
  {
    id:      'pick',
    name:    'Pick',
    icon:    '⚒',
    price:   100,
    desc:    `Break stone blocks found in the mine (walk into them) — lasts ${TOOL_USES} uses`,
    oneTime: false,
  },
  {
    id:      'bucket',
    name:    'Bucket',
    icon:    '🪣',
    price:   80,
    desc:    `Clear spread water by walking into it (cannot clear spring source) — lasts ${TOOL_USES} uses`,
    oneTime: false,
  },
  {
    id:      'extinguisher',
    name:    'Fire Extinguisher',
    icon:    '🧯',
    price:   120,
    desc:    `Walk into lava to turn it to stone instead of taking damage — lasts ${TOOL_USES} uses`,
    oneTime: false,
  },
  {
    id:      'bag',
    name:    'Large Bag',
    icon:    '🎒',
    price:   75,
    desc:    'Doubles ore carry capacity (10 → 20)',
    oneTime: true,
  },
  {
    id:      'dynamite',
    name:    'Dynamite',
    icon:    '💣',
    price:   75,
    desc:    'Press 💣 to enter placement mode, then move in any direction to place. 5-second fuse — get clear!',
    oneTime: false,
  },
  {
    id:      'firstaid',
    name:    'First Aid Kit',
    icon:    '🩹',
    price:   65,
    desc:    'Use from inventory to restore health to full.',
    oneTime: false,
  },
];

// ---------------------------------------------------------------------------
// Dynamite
// ---------------------------------------------------------------------------
const DYNAMITE_FUSE_FRAMES           = 300;  // ~5 seconds at 60 fps before detonation
const DYNAMITE_RADIUS                = 3;    // Blast radius in tiles (Euclidean)
const DYNAMITE_CRITICAL_RADIUS       = 2;    // Within this many tiles: 2 hearts of damage
const DYNAMITE_URGENT_SECS           = 2;    // Fuse seconds remaining when urgent warning starts

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------
const DRINK_PRICE       = 10;   // Cost of one drink at the bar
const DRINKS_TO_UNLOCK  = 3;    // Drinks required before the girl accepts a proposal

// ---------------------------------------------------------------------------
// Mine depth limit
// ---------------------------------------------------------------------------
const MAX_MINE_DEPTH = 100;  // Maximum mine depth in metres; dragon beyond this

// ---------------------------------------------------------------------------
// Jeweler (constants kept for renderer compatibility)
// ---------------------------------------------------------------------------
const JEWELER_DIAMOND_COST = 1;     // (unused – jeweler removed)
const JEWELER_MONEY_COST   = 1000;  // Cash required alongside the ring for proposal

// ---------------------------------------------------------------------------
// Doctor services
// ---------------------------------------------------------------------------
const HEAL_PRICE        = 30;   // Cost to restore 1 heart
const EXTRA_HEART_PRICE = 150;  // Cost to add +1 max heart (up to MAX_HEARTS)
const MAX_HEARTS        = 6;
const START_HEARTS      = 3;

// ---------------------------------------------------------------------------
// Reveal thresholds
// ---------------------------------------------------------------------------
const REVEAL_MIN        = 10;  // Minimum probe count to reveal a dirt tile
const REVEAL_MAX        = 35;  // Maximum probe count to reveal a dirt tile
const SHOVEL_REDUCTION  = 12;  // Shovel reduces dirt reveal threshold by this amount

// ---------------------------------------------------------------------------
// Hazard spread
// ---------------------------------------------------------------------------
const HAZARD_SPREAD = 12;  // Max EMPTY tiles a water/lava spring floods when triggered

// ---------------------------------------------------------------------------
// Elevator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Surface building x-positions in the building facade row (y=0)
// ---------------------------------------------------------------------------
const OUTHOUSE_X  = 1;   // Left-side outhouse
const JEWELER_X   = 19;  // Jeweler (between Bank and mine entrance)
const BANK_X      = 17;  // Town bank (between Doctor and mine entrance)

// ---------------------------------------------------------------------------
// Ring location – hidden in the mine ~50 m below the outhouse (randomised 50-60 m)
// ---------------------------------------------------------------------------
const RING_X = OUTHOUSE_X;  // Same x-column as the outhouse (x=1)

// ---------------------------------------------------------------------------
// Glasses location – hidden directly below the outhouse (shallow)
// ---------------------------------------------------------------------------
const GLASSES_DEPTH = 2;          // Mine depth (m) where the glasses are hidden
const GLASSES_X     = OUTHOUSE_X; // Same x-column as the outhouse (x=1)

// ---------------------------------------------------------------------------
// Mine entrance x-range (right side of surface row)
// ---------------------------------------------------------------------------
const MINE_ENT_X_MIN         = 22;
const MINE_ENT_X_MAX         = 23;
const MINE_ENT_CLEARED_DEPTH = 4;   // Mine-entrance columns pre-cleared to this row

// ---------------------------------------------------------------------------
// Player start position (pavement row, open area)
// ---------------------------------------------------------------------------
const PLAYER_START_X = 16;
const PLAYER_START_Y = 2;   // y=2 is the pavement row

// ---------------------------------------------------------------------------
// Player physics / UI timings
// ---------------------------------------------------------------------------
const INVINCIBILITY_FRAMES = 60;   // Blink-animation frames after taking damage (~1 s at 60 fps)
const BLINK_INTERVAL       = 6;    // Every N frames the player sprite dims during invincibility
const COLLECT_FLASH_FRAMES = 5;    // Duration (ticks) of the ore-collect flash behind the player
const MAX_DELTA_TIME_MS    = 100;  // Cap on per-frame dt to avoid spiral-of-death after tab switch
const MAX_INPUT_QUEUE      = 12;   // Maximum queued input actions before dropping new ones

// ---------------------------------------------------------------------------
// Tile render colours (VGA-inspired palette)
// ---------------------------------------------------------------------------
const TILE_COLOR = {
  [TILE.GRASS]:        '#4a7a28',
  [TILE.BUILDING]:     '#6e4c24',
  [TILE.SHOP]:         '#e8c040',
  [TILE.BAR]:          '#d45090',
  [TILE.DOCTOR]:       '#40b8d4',
  [TILE.MINE_ENT]:     '#151520',
  [TILE.DIRT]:         '#6b3822',
  [TILE.EMPTY]:        '#1a1a1a',
  [TILE.SILVER]:       '#b0c0cc',
  [TILE.GOLD]:         '#d4a800',
  [TILE.PLATINUM]:     '#c8dde8',
  [TILE.WATER]:        '#1555cc',
  [TILE.LAVA]:         '#dd3300',
  [TILE.SHOVEL]:       '#ccaa44',
  [TILE.PICK]:         '#aabbcc',
  [TILE.BAG]:          '#aa8833',
  [TILE.STONE]:        '#5a5a5a',
  [TILE.PAVEMENT]:     '#888070',
  [TILE.BANK]:         '#2a5a2a',
  [TILE.OUTHOUSE]:     '#7a5228',
  [TILE.DIAMOND]:      '#88ddff',
  [TILE.RUBY]:         '#cc0033',
  [TILE.RUBBER_BOOT]:  '#223344',
  [TILE.POCKET_WATCH]: '#332211',
  [TILE.GLASSES]:      '#111122',
  [TILE.JEWELER]:      '#8844aa',
  [TILE.SKY]:          '#7ab8e8',
  [TILE.DYNAMITE]:     '#cc2200',
  [TILE.RING]:         '#ffe0a0',
  [TILE.FLOWER]:       '#7ab8e8',
  [TILE.LANTERN]:      '#ffdd44',
  [TILE.RADIO]:        '#225588',
  [TILE.SKULL]:        '#aaaaaa',
  [TILE.CANTEEN]:      '#556644',
  [TILE.LUNCHBOX]:     '#884422',
};

// Ore tile types that can be destroyed when a hazard spreads over them
const HAZARD_DESTROYABLE_TILES = new Set([
  TILE.SILVER, TILE.GOLD, TILE.PLATINUM, TILE.DIAMOND, TILE.RUBY,
]);
