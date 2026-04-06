'use strict';

/**
 * Storage – save and load game state to/from localStorage.
 *
 * A snapshot is taken after every player action so that an accidental page
 * refresh never loses progress.  The save is cleared when the game ends
 * (death or win) so that "Try Again" / "Play Again" always starts fresh.
 *
 * Save key:    'minerGameSave'
 * Format version: 1
 */

const SAVE_KEY     = 'minerGameSave';
const SAVE_VERSION = 1;

const Storage = {

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Persist the current game state to localStorage. */
  save(player, world, game) {
    try {
      const data = {
        version: SAVE_VERSION,
        player:  _serializePlayer(player),
        world:   _serializeWorld(world),
        game:    _serializeGame(game),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (_e) {
      // Ignore storage errors (private mode, quota exceeded, etc.)
    }
  },

  /**
   * Load a previously saved game.
   * Returns the parsed data object, or null if no valid save exists.
   */
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== SAVE_VERSION) { this.clear(); return null; }
      return data;
    } catch (_e) {
      this.clear();
      return null;
    }
  },

  /** Remove the save from localStorage. */
  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (_e) { /* ignore */ }
  },

  // -------------------------------------------------------------------------
  // State restoration helpers (called by Game after constructing fresh objects)
  // -------------------------------------------------------------------------

  /** Overwrite a freshly constructed Player with saved state. */
  restorePlayer(p, data) {
    p.x = data.x;
    p.y = data.y;

    p.money   = data.money;
    p.gems    = data.gems.slice();
    p.maxGems = data.maxGems;

    p.hasShovel       = data.hasShovel;
    p.hasPick         = data.hasPick;
    p.hasBucket       = data.hasBucket;
    p.hasExtinguisher = data.hasExtinguisher;
    p.hasBag          = data.hasBag;
    p.hasRing         = data.hasRing;

    p.drinksBought  = data.drinksBought;
    p.dynamiteCount = data.dynamiteCount;

    p.pickUses         = data.pickUses;
    p.bucketUses       = data.bucketUses;
    p.extinguisherUses = data.extinguisherUses;

    p.specialItems = new Set(data.specialItems);

    p.hasLantern    = data.hasLantern;
    p.hasFlower     = data.hasFlower;
    p.hasGivenFlower = data.hasGivenFlower;
    p.hasRadio      = data.hasRadio;

    p.firstAidKits = data.firstAidKits;

    p.hearts    = data.hearts;
    p.maxHearts = data.maxHearts;

    p.dead = data.dead;
    p.won  = data.won;
  },

  /** Overwrite a freshly constructed World with saved state. */
  restoreWorld(w, data) {
    w.deepestGenY = data.deepestGenY;

    w.rowTiles = new Map(
      data.rowTiles.map(([y, arr]) => [y, new Uint8Array(arr)])
    );
    w.rowData = new Map(
      data.rowData.map(([y, arr]) => [y, arr.map(d => d ? Object.assign({}, d) : null)])
    );

    w.springTiles = new Set(data.springTiles);
    w.lavaSources = new Set(data.lavaSources);

    // Restore pre-placed unique item positions so future chunk generation
    // continues to place items that haven't been reached yet.
    w.uniqueItemPositions = data.uniqueItemPositions.map(p => Object.assign({}, p));

    // Restore RNG state so newly generated chunks are consistent with the
    // original seed sequence.
    w._rng.setState(data.rngState);
  },

  /** Restore game-level transient state (active dynamites, dragon warnings). */
  restoreGame(g, data) {
    g._dynamites      = data.dynamites.map(d => Object.assign({}, d));
    g._dragonWarnings = data.dragonWarnings;
  },
};

// ── Private serialization helpers ─────────────────────────────────────────────

function _serializePlayer(p) {
  return {
    x: p.x,
    y: p.y,

    money:   p.money,
    gems:    p.gems.slice(),
    maxGems: p.maxGems,

    hasShovel:       p.hasShovel,
    hasPick:         p.hasPick,
    hasBucket:       p.hasBucket,
    hasExtinguisher: p.hasExtinguisher,
    hasBag:          p.hasBag,
    hasRing:         p.hasRing,

    drinksBought:  p.drinksBought,
    dynamiteCount: p.dynamiteCount,

    pickUses:         p.pickUses,
    bucketUses:       p.bucketUses,
    extinguisherUses: p.extinguisherUses,

    specialItems: Array.from(p.specialItems),

    hasLantern:    p.hasLantern,
    hasFlower:     p.hasFlower,
    hasGivenFlower: p.hasGivenFlower,
    hasRadio:      p.hasRadio,

    firstAidKits: p.firstAidKits,

    hearts:    p.hearts,
    maxHearts: p.maxHearts,

    dead: p.dead,
    won:  p.won,
  };
}

function _serializeWorld(w) {
  // Map<y, Uint8Array> → [[y, byte[]], ...]
  const rowTiles = [];
  for (const [y, arr] of w.rowTiles) {
    rowTiles.push([y, Array.from(arr)]);
  }

  // Map<y, Array<null|object>> → [[y, (null|object)[]], ...]
  const rowData = [];
  for (const [y, arr] of w.rowData) {
    rowData.push([y, arr.map(d => d ? Object.assign({}, d) : null)]);
  }

  return {
    deepestGenY:         w.deepestGenY,
    rowTiles,
    rowData,
    springTiles:         Array.from(w.springTiles),
    lavaSources:         Array.from(w.lavaSources),
    uniqueItemPositions: w.uniqueItemPositions.map(p => Object.assign({}, p)),
    rngState:            w._rng.getState(),
  };
}

function _serializeGame(g) {
  return {
    dynamites:      g._dynamites.map(d => Object.assign({}, d)),
    dragonWarnings: g._dragonWarnings,
  };
}
