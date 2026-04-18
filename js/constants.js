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
  HOUSE:       36,   // Family home – replaces bar in family mode
  TIN_CAN:     37,   // Hidden tin can – novelty collectible
  NECKLACE:    38,   // Hidden necklace – found in mine during family mode; deliver home to have a baby
  WORKER:      39,   // Contractor Mike building on the surface
  ELEV_ENT:    40,   // Elevator door in the shaft (every 5 m) – impassable, interactive
  ELEV_SHAFT:  41,   // Elevator shaft fill between doors – impassable solid
  CASH_BAG:    42,   // Hidden bag of cash from a previous miner – adds $750
  SCROLL:      43,   // Hidden ancient scroll – novelty collectible
  FOSSIL:      44,   // Hidden fossilized footprints – novelty collectible
  NEWSPAPER:   45,   // Hidden old newspaper – novelty collectible
  BROKEN_CHAIN:46,   // Hidden broken chain – novelty collectible
  OLD_COIN:    47,   // Hidden old coin – novelty collectible
  BOTTLE:      48,   // Hidden bottle of alcohol – novelty collectible
  HELMET:      49,   // Knight's helmet – only in extended mine (part of knight set)
  ARMOR:       50,   // Knight's armor – only in extended mine (part of knight set)
  SHIELD:      51,   // Knight's shield – only in extended mine (part of knight set)
  SWORD:       52,   // Knight's sword – only in extended mine (part of knight set)
  DOWSING_ROD:   53,   // Hidden dowsing rod – instantly reveals adjacent water hazards
  HEAT_VISION:   54,   // Hidden heat-vision goggles – instantly reveals adjacent lava hazards
  TREASURE_MAP:  55,   // Hidden treasure map – reveals the depth of the treasure chest
  TREASURE_CHEST:56,   // Treasure chest in the extended mine – contains gems worth $5,000
  GAS:           57,   // Gas leak – impassable cloud of toxic gas; deals 1 heart on entry (no spread)
  GENIE_LAMP:    58,   // Genie lamp – grants up to 3 wishes to continue after a game over
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
  TIN_CAN:      'tin_can',      // Unique – novelty collectible
  NECKLACE:     'necklace',     // Family-mode item – deliver home to have a baby
  CASH_BAG:     'cash_bag',     // Unique – adds $750 to cash on pickup
  SCROLL:       'scroll',       // Unique – novelty collectible
  FOSSIL:       'fossil',       // Unique – novelty collectible
  NEWSPAPER:    'newspaper',    // Unique – novelty collectible
  BROKEN_CHAIN: 'broken_chain', // Unique – novelty collectible
  OLD_COIN:     'old_coin',     // Unique – novelty collectible
  BOTTLE:       'bottle',       // Unique – novelty collectible
  HELMET:       'helmet',       // Knight set – extended mine only
  ARMOR:        'armor',        // Knight set – extended mine only
  SHIELD:       'shield',       // Knight set – extended mine only
  SWORD:        'sword',        // Knight set – extended mine only
  DOWSING_ROD:  'dowsing_rod', // Unique – instantly reveals adjacent water hazards once collected
  HEAT_VISION:  'heat_vision', // Unique – instantly reveals adjacent lava hazards once collected
  TREASURE_MAP:   'treasure_map',   // Unique – reveals the depth of the treasure chest
  TREASURE_CHEST: 'treasure_chest', // Unique – treasure chest in the extended mine (>100 m)
  GAS:            'gas',            // Gas leak – toxic cloud; deals 1 heart on entry (no spread)
  GENIE_LAMP:     'genie_lamp',     // Unique – grants up to 3 wishes (game-over continues)
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

// Mapping from HIDDEN gem type to the corresponding revealed TILE type
const GEM_HIDDEN_TO_TILE = Object.freeze({
  [HIDDEN.SILVER]:   TILE.SILVER,
  [HIDDEN.GOLD]:     TILE.GOLD,
  [HIDDEN.PLATINUM]: TILE.PLATINUM,
  [HIDDEN.DIAMOND]:  TILE.DIAMOND,
  [HIDDEN.RUBY]:     TILE.RUBY,
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
    icon:    '🪏',
    price:   50,
    desc:    'Reduces effort to reveal dirt tiles',
    oneTime: true,
  },
  {
    id:      'pick',
    name:    'Pick',
    icon:    '⛏',
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
    id:      'drill',
    name:    'Drill',
    icon:    '🛠️',
    price:   100,
    desc:    'Use from inventory to drill 15 m straight down, clearing dirt and stone while revealing hidden content.',
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
const DYNAMITE_BIG_RADIUS            = 4;    // Occasional larger blast radius
const DYNAMITE_BIG_BLAST_CHANCE      = 0.20; // Chance for an occasional larger blast
const DYNAMITE_URGENT_SECS           = 2;    // Fuse seconds remaining when urgent warning starts

// ---------------------------------------------------------------------------
// Bar / surface building x-positions (building facade row, y=1)
// ---------------------------------------------------------------------------
const DRINK_PRICE       = 10;   // Cost of one drink at the bar
const DRINKS_TO_UNLOCK  = 3;    // Drinks required before the girl accepts a proposal
const BAR_X             = 9;    // x-column of the bar building

// ---------------------------------------------------------------------------
// Family Mode
// ---------------------------------------------------------------------------
const FAMILY_TAX_INTERVAL_MS   = 30 * 60 * 1000;   // Taxes due every 30 minutes
const FAMILY_TAX_GRACE_MS      = 10 * 60 * 1000;   // 10-minute grace before eviction
const FAMILY_BASE_TAX          = 50;                // Base tax per cycle
const FAMILY_TAX_PER_LEVEL     = 25;               // Extra tax per extra house level
const FAMILY_TAX_INTEREST      = 0.25;             // 25 % surcharge if bank is short

const FAMILY_SUPPLIES_TICK_MS  = 60 * 1000;        // Supplies deplete 1 % per minute
const FAMILY_SUPPLIES_GRACE_MS = 10 * 60 * 1000;   // 10-minute grace before divorce
const FAMILY_SUPPLIES_PER_BABY = 0.5;              // Extra % depletion per minute per baby

const HOUSE_UPGRADE_COST       = 1000;  // Cost to expand house (per level)
const HOUSE_MAX_LEVEL          = 6;     // Maximum house expansion level
const BABY_COST                = 500;   // Cost to have each baby
const MAX_BABIES               = 10;     // Maximum number of babies
const SUPPLIES_REFILL_COST     = 40;    // Cost to refill supplies by 25 %
const SUPPLIES_REFILL_AMOUNT   = 25;    // Percent refilled per payment

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
// Mine Cart
// ---------------------------------------------------------------------------
const MINE_CART_COST = 200;  // One-time purchase from Contractor Mike
const MINE_CART_SEND_COST = 5; // Cost per mine cart delivery

// ---------------------------------------------------------------------------
// Drill
// ---------------------------------------------------------------------------
const DRILL_DEPTH = 15;  // Tiles (metres) drilled straight down per use

// ---------------------------------------------------------------------------
// Elevator
// ---------------------------------------------------------------------------
const WORKER_X        = 20;   // Contractor Mike building x-column
const ELEVATOR_X      = 23;   // Elevator shaft x-column (rightmost mine-entrance column)
const ELEVATOR_COST   = 500;  // One-time cost to build the elevator shaft
const ELEVATOR_RIDE_COST = 5; // Cost per elevator ride (enter the cabin)
const ELEVATOR_DEPTH_INCREMENT = 50;   // Metres added per depth expansion purchase
const ELEVATOR_DEPTH_MAX       = 300;  // Maximum purchasable mine depth (metres)
const ELEVATOR_DEPTH_COST      = 200;  // Cost per 50 m depth expansion

/** True when world-row y should hold an elevator entry-point tile (every 5 m). */
const isElevEntryRow = (y) => (y - 2) % 5 === 0;

/** Deepest elevator entry-point world-row at or above maxY. */
const deepestElevEntry = (maxY) => Math.floor((maxY - 2) / 5) * 5 + 2;

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
  [TILE.HOUSE]:        '#8b5e3c',
  [TILE.TIN_CAN]:      '#708090',
  [TILE.NECKLACE]:     '#f0c040',
  [TILE.WORKER]:       '#c87840',
  [TILE.ELEV_ENT]:     '#1a2233',   // Elevator door – dark steel blue
  [TILE.ELEV_SHAFT]:   '#3a5070',   // Elevator shaft fill – steel blue rails
  [TILE.CASH_BAG]:     '#1a1a0a',   // Hidden bag of cash – dark with gold tint
  [TILE.SCROLL]:       '#1a0a00',   // Hidden scroll – dark parchment background
  [TILE.FOSSIL]:       '#0a0a0a',   // Hidden fossil – very dark
  [TILE.NEWSPAPER]:    '#0a0a0a',   // Hidden newspaper – very dark
  [TILE.BROKEN_CHAIN]: '#0a0a0a',   // Hidden broken chain – very dark
  [TILE.OLD_COIN]:     '#0a0a0a',   // Hidden old coin – very dark
  [TILE.BOTTLE]:       '#0a0a0a',   // Hidden bottle – very dark
  [TILE.HELMET]:       '#101820',   // Knight helmet – dark steel
  [TILE.ARMOR]:        '#101820',   // Knight armor – dark steel
  [TILE.SHIELD]:       '#101820',   // Knight shield – dark steel
  [TILE.SWORD]:        '#101820',   // Knight sword – dark steel
  [TILE.DOWSING_ROD]:    '#0a1a0a',   // Dowsing rod – dark with teal tint
  [TILE.HEAT_VISION]:    '#0a0a1a',   // Heat-vision goggles – dark with blue tint
  [TILE.TREASURE_MAP]:   '#1a1200',   // Treasure map – dark parchment tone
  [TILE.TREASURE_CHEST]: '#201000',   // Treasure chest – very dark gold-brown
  [TILE.GAS]:            '#2a3800',   // Gas leak – dark sickly yellow-green
  [TILE.GENIE_LAMP]:     '#1a1000',   // Genie lamp – dark burnished gold-brown
};

// Ore tile types that can be destroyed when a hazard spreads over them
const HAZARD_DESTROYABLE_TILES = new Set([
  TILE.SILVER, TILE.GOLD, TILE.PLATINUM, TILE.DIAMOND, TILE.RUBY,
]);

// ---------------------------------------------------------------------------
// Cash bag reward
// ---------------------------------------------------------------------------
const CASH_BAG_VALUE = 750;  // Cash added to player wallet when bag of cash is found

// ---------------------------------------------------------------------------
// Treasure chest – ruby count equals exactly $5,000
// ---------------------------------------------------------------------------
const TREASURE_CHEST_RUBY_COUNT = 10;  // 10 × $500 ruby = $5,000 total

// ---------------------------------------------------------------------------
// Knight item set – collect all four to slay the dragon
// ---------------------------------------------------------------------------
const KNIGHT_ITEMS = Object.freeze(['helmet', 'armor', 'shield', 'sword']);
