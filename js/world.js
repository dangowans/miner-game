'use strict';

/**
 * World – infinite-depth mine with lazy chunk generation.
 *
 * Layout:
 *   y=0  Building facades row – BUILDING/SHOP/BAR/DOCTOR tiles (all impassable
 *        from below; player interacts by pressing E while on pavement at y=1).
 *   y=1  Pavement row – PAVEMENT (walkable east/west); MINE_ENT at x=22-24
 *        is the only crossing point to the mine below.
 *   y≥2  Mine – starts as DIRT, generated in chunks, extends infinitely.
 */
class World {
  constructor() {
    this.width         = MAP_WIDTH;
    this.rowTiles      = new Map();   // y → Uint8Array[MAP_WIDTH]
    this.rowData       = new Map();   // y → Array[MAP_WIDTH] of null|object
    this.deepestGenY   = 1;           // Mine starts at y=2; pavement at y=1 is not a mine row
    this._rng          = this._makeRng(Date.now()); // New seed each page load → different mine every game

    // Track spring-source water tiles (these cannot be cleared by the bucket).
    // The Set stores coordinate keys "x,y".
    this.springTiles   = new Set();

    this._buildSurface();
    this._generateChunk(2);          // First mine chunk (mine starts at y=2)
  }

  // -------------------------------------------------------------------------
  // Simple seeded PRNG (mulberry32)
  // -------------------------------------------------------------------------

  _makeRng(seed) {
    let s = seed >>> 0;
    return () => {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // -------------------------------------------------------------------------
  // Row accessors (auto-create empty arrays on demand)
  // -------------------------------------------------------------------------

  _getOrCreateRow(y) {
    if (!this.rowTiles.has(y)) {
      this.rowTiles.set(y, new Uint8Array(this.width).fill(TILE.GRASS));
      this.rowData.set(y,  new Array(this.width).fill(null));
    }
    return { tiles: this.rowTiles.get(y), data: this.rowData.get(y) };
  }

  getTile(x, y) {
    if (x < 0 || x >= this.width || y < 0) return null;
    const row = this.rowTiles.get(y);
    if (!row) return null;
    return row[x];
  }

  setTile(x, y, tileType) {
    if (x < 0 || x >= this.width || y < 0) return;
    const { tiles } = this._getOrCreateRow(y);
    tiles[x] = tileType;
  }

  getData(x, y) {
    if (x < 0 || x >= this.width || y < 0) return null;
    const row = this.rowData.get(y);
    if (!row) return null;
    return row[x];
  }

  setData(x, y, d) {
    if (x < 0 || x >= this.width || y < 0) return;
    const { data } = this._getOrCreateRow(y);
    data[x] = d;
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  _buildSurface() {
    // ── y=0: Building facades (impassable wall the player sees from pavement) ──
    // The entire row is building material; special "door" tiles mark interactable spots.
    const { tiles: top } = this._getOrCreateRow(0);
    top.fill(TILE.BUILDING);

    // Shop door at x=5
    top[5] = TILE.SHOP;
    // Bar door at x=9
    top[9] = TILE.BAR;
    // Doctor door at x=13
    top[13] = TILE.DOCTOR;
    // Mine entrance arch at x=22-24 (decorative upper arch; actual entrance is y=1 below)
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      top[x] = TILE.MINE_ENT;
    }

    // ── y=1: Pavement row (fully walkable; mine entrance at right) ──────────
    const { tiles: pave } = this._getOrCreateRow(1);
    pave.fill(TILE.PAVEMENT);
    // Mine entrance tiles – the crossing point to the mine below
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      pave[x] = TILE.MINE_ENT;
    }
  }

  /**
   * Generate CHUNK_SIZE mine rows starting at fromY.
   * Gem and hazard density shifts slightly with depth for variety.
   * Stone becomes more prevalent deeper down.
   */
  _generateChunk(fromY) {
    const rng = this._rng;

    // Probability weights shift with depth (every 50 rows)
    const depthBonus = Math.floor(fromY / 50);

    const TABLE = [
      { content: HIDDEN.NOTHING,  weight: Math.max(15, 32 - depthBonus)        },
      { content: HIDDEN.GEM_LOW,  weight: Math.max( 8, 26 - depthBonus)        },
      { content: HIDDEN.GEM_MED,  weight: 13 + depthBonus                      },
      { content: HIDDEN.GEM_HIGH, weight:  4 + depthBonus                      },
      { content: HIDDEN.WATER,    weight:  4                                    },
      { content: HIDDEN.LAVA,     weight:  3 + Math.floor(depthBonus / 2)      },
      { content: HIDDEN.STONE,    weight: 10 + Math.floor(depthBonus * 1.5)    },
      { content: HIDDEN.SHOVEL,   weight:  2                                    },
      { content: HIDDEN.PICK,     weight:  2                                    },
      { content: HIDDEN.BAG,      weight:  1                                    },
    ];
    const totalWeight = TABLE.reduce((s, e) => s + e.weight, 0);

    // Per-chunk item caps so rare pickups stay rare
    const CHUNK_CAPS = { shovel: 1, pick: 1, bag: 1 };
    const chunkCount = { shovel: 0, pick: 0, bag: 0 };

    for (let y = fromY; y < fromY + CHUNK_SIZE; y++) {
      const { tiles, data } = this._getOrCreateRow(y);
      tiles.fill(TILE.DIRT);
      for (let i = 0; i < this.width; i++) data[i] = null;

      for (let x = 0; x < this.width; x++) {
        // Mine-entrance columns: pre-clear rows down to MINE_ENT_CLEARED_DEPTH
        if (x >= MINE_ENT_X_MIN && y <= MINE_ENT_CLEARED_DEPTH) {
          tiles[x] = TILE.EMPTY;
          continue;
        }

        let roll = rng() * totalWeight;
        let hidden = HIDDEN.NOTHING;
        for (const entry of TABLE) {
          roll -= entry.weight;
          if (roll <= 0) { hidden = entry.content; break; }
        }

        // Enforce per-chunk item caps
        if (hidden === HIDDEN.SHOVEL) {
          if (chunkCount.shovel >= CHUNK_CAPS.shovel) hidden = HIDDEN.NOTHING;
          else chunkCount.shovel++;
        } else if (hidden === HIDDEN.PICK) {
          if (chunkCount.pick >= CHUNK_CAPS.pick) hidden = HIDDEN.NOTHING;
          else chunkCount.pick++;
        } else if (hidden === HIDDEN.BAG) {
          if (chunkCount.bag >= CHUNK_CAPS.bag) hidden = HIDDEN.NOTHING;
          else chunkCount.bag++;
        }

        const threshold =
          REVEAL_MIN + Math.floor(rng() * (REVEAL_MAX - REVEAL_MIN + 1));

        data[x] = { hidden, threshold, probes: 0 };
      }
    }

    this.deepestGenY = Math.max(this.deepestGenY, fromY + CHUNK_SIZE - 1);
  }

  /**
   * Called by the game loop – ensures rows up to (and beyond) `untilY` exist.
   */
  ensureGenerated(untilY) {
    while (this.deepestGenY < untilY) {
      this._generateChunk(this.deepestGenY + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Reveal logic
  // -------------------------------------------------------------------------

  /**
   * Probe all DIRT tiles adjacent to (px, py).
   * Returns array of { x, y, content } for any newly-revealed tiles.
   */
  probeAdjacent(px, py, toolReduction) {
    const revealed = [];
    const DIRS = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];
    for (const { dx, dy } of DIRS) {
      const nx = px + dx, ny = py + dy;
      if (this.getTile(nx, ny) !== TILE.DIRT) continue;
      const d = this.getData(nx, ny);
      if (!d) continue;
      d.probes++;
      const effective = Math.max(1, d.threshold - toolReduction);
      if (d.probes >= effective) {
        const content = this._revealTile(nx, ny);
        if (content !== null) revealed.push({ x: nx, y: ny, content });
      }
    }
    return revealed;
  }

  /**
   * Immediately dig a DIRT tile (player stepped directly onto it).
   * Returns the hidden content string, or null if not DIRT.
   */
  digInto(x, y) {
    if (this.getTile(x, y) !== TILE.DIRT) return null;
    return this._revealTile(x, y);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _revealTile(x, y) {
    const d = this.getData(x, y);
    if (!d) return null;
    const { hidden } = d;
    this.setData(x, y, null);

    switch (hidden) {
      case HIDDEN.GEM_LOW:  this.setTile(x, y, TILE.GEM_LOW);  break;
      case HIDDEN.GEM_MED:  this.setTile(x, y, TILE.GEM_MED);  break;
      case HIDDEN.GEM_HIGH: this.setTile(x, y, TILE.GEM_HIGH); break;
      case HIDDEN.STONE:    this.setTile(x, y, TILE.STONE);     break;
      case HIDDEN.WATER:
        this.setTile(x, y, TILE.WATER);
        this.springTiles.add(`${x},${y}`);   // Mark as spring source
        this._spread(x, y, TILE.WATER);
        break;
      case HIDDEN.LAVA:
        this.setTile(x, y, TILE.LAVA);
        this._spread(x, y, TILE.LAVA);
        break;
      case HIDDEN.SHOVEL: this.setTile(x, y, TILE.SHOVEL); break;
      case HIDDEN.PICK:   this.setTile(x, y, TILE.PICK);   break;
      case HIDDEN.BAG:    this.setTile(x, y, TILE.BAG);    break;
      default:            this.setTile(x, y, TILE.EMPTY);  break;
    }
    return hidden;
  }

  /** BFS flood-fill into adjacent EMPTY tiles. */
  _spread(sx, sy, tileType) {
    const queue   = [{ x: sx, y: sy }];
    const visited = new Set([`${sx},${sy}`]);
    let   count   = 0;
    const DIRS    = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];
    while (queue.length > 0 && count < HAZARD_SPREAD) {
      const { x, y } = queue.shift();
      for (const { dx, dy } of DIRS) {
        const nx = x + dx, ny = y + dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (this.getTile(nx, ny) === TILE.EMPTY) {
          this.setTile(nx, ny, tileType);
          queue.push({ x: nx, y: ny });
          count++;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Passability
  // -------------------------------------------------------------------------

  /**
   * True if the player may enter (x, y).
   * DIRT is NOT passable – the game handles dig-in before calling this.
   * STONE is NOT passable – the game checks for pick before calling this.
   * WATER is NOT passable – the game checks for bucket before calling this.
   * LAVA is passable but damaging – game.js applies the damage.
   */
  isPassable(x, y) {
    const t = this.getTile(x, y);
    if (t === null) return false;
    switch (t) {
      case TILE.GRASS:
      case TILE.PAVEMENT:  // Pavement row walkable east-west
      case TILE.SHOP:
      case TILE.BAR:
      case TILE.DOCTOR:
      case TILE.MINE_ENT:
      case TILE.EMPTY:
      case TILE.GEM_LOW:
      case TILE.GEM_MED:
      case TILE.GEM_HIGH:
      case TILE.SHOVEL:
      case TILE.PICK:
      case TILE.BAG:
      case TILE.LAVA:     // passable but damaging – handled in game.js
        return true;
      case TILE.BUILDING:
      case TILE.DIRT:
      case TILE.STONE:    // impassable without a pick
      case TILE.WATER:    // impassable without a bucket (spring source: always blocked)
        return false;
      default:
        return false;
    }
  }

  /**
   * Returns true if (x, y) is a water-spring source tile.
   * The bucket cannot clear spring sources, only spread water.
   */
  isSpringSource(x, y) {
    return this.springTiles.has(`${x},${y}`);
  }
}
