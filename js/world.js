'use strict';

/**
 * World – infinite-depth mine with lazy chunk generation.
 *
 * Layout:
 *   y=0  Building facades – BUILDING/OUTHOUSE/SHOP/BAR/DOCTOR/BANK/MINE_ENT tiles.
 *   y=1  Pavement row – PAVEMENT; MINE_ENT at x=22-24 is the crossing point.
 *   y≥2  Mine – DIRT initially, generated in chunks, extends infinitely.
 *        x=24 (rightmost) is always ELEVATOR shaft (impassable; interact from x=23).
 *
 * Unique items (ruby, rubber boot, pocket watch, glasses) are pre-placed at
 * fixed random positions decided at construction time, so each appears exactly
 * once in the entire mine.
 */
class World {
  constructor() {
    // RNG is created first so unique item positions can consume values before
    // chunk generation begins (keeping generation deterministic from the seed).
    this._rng = this._makeRng(Date.now());

    // Pre-compute unique item positions (uses RNG before chunk generation).
    this.uniqueItemPositions = this._computeUniqueItemPositions();

    this.width       = MAP_WIDTH;
    this.rowTiles    = new Map();   // y → Uint8Array[MAP_WIDTH]
    this.rowData     = new Map();   // y → Array[MAP_WIDTH] of null|object
    this.deepestGenY = 1;

    // Track spring-source water tiles (cannot be cleared by bucket).
    this.springTiles = new Set();

    // Track lava-source tiles (original, not spread).
    this.lavaSources = new Set();

    this._buildSurface();
    this._generateChunk(2);   // First mine chunk (mine starts at y=2)
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
  // Unique item pre-placement
  // -------------------------------------------------------------------------

  /**
   * Decide fixed positions for the four unique items using the shared RNG.
   * Positions are restricted to columns 1-20 (avoiding mine entrance / elevator)
   * and to depths where the mine is fully generated as DIRT.
   */
  _computeUniqueItemPositions() {
    const rng    = this._rng;
    const xRange = MINE_ENT_X_MIN - 2;   // 20 safe columns (x ∈ [1, 20])
    return [
      { content: HIDDEN.RUBY,         y: 20 + Math.floor(rng() * 80) },
      { content: HIDDEN.RUBBER_BOOT,  y:  8 + Math.floor(rng() * 40) },
      { content: HIDDEN.POCKET_WATCH, y: 12 + Math.floor(rng() * 60) },
      { content: HIDDEN.GLASSES,      y:  5 + Math.floor(rng() * 35) },
    ].map(item => ({ ...item, x: 1 + Math.floor(rng() * xRange) }));
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
    // ── y=0: Building facades ──────────────────────────────────────────────
    const { tiles: top } = this._getOrCreateRow(0);
    top.fill(TILE.BUILDING);

    top[OUTHOUSE_X] = TILE.OUTHOUSE;   // Left-side outhouse (x=1)
    top[5]          = TILE.SHOP;        // General store
    top[9]          = TILE.BAR;         // Bar
    top[13]         = TILE.DOCTOR;      // Doctor
    top[BANK_X]     = TILE.BANK;        // Town bank (x=17)

    // Mine entrance arch at x=22-24 (decorative upper; actual entrance at y=1)
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      top[x] = TILE.MINE_ENT;
    }

    // ── y=1: Pavement row ──────────────────────────────────────────────────
    const { tiles: pave } = this._getOrCreateRow(1);
    pave.fill(TILE.PAVEMENT);
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      pave[x] = TILE.MINE_ENT;
    }
  }

  /**
   * Generate CHUNK_SIZE mine rows starting at fromY.
   * Ore and hazard density shifts with depth; stone becomes more prevalent deeper.
   * Unique items are placed at pre-computed fixed positions (one each, globally).
   * ~20% of dirt tiles are marked impenetrable – they cannot be revealed by
   * adjacent probing and must be walked into directly.
   */
  _generateChunk(fromY) {
    const rng = this._rng;

    // Probability weights shift with depth (every 50 rows)
    const depthBonus = Math.floor(fromY / 50);

    // Hazard weights scale up gradually from zero at the surface.
    // Water starts appearing around y=20, lava around y=30.
    const waterScale = Math.min(1, fromY / 60);
    const lavaScale  = Math.min(1, fromY / 80);
    const waterWeight = Math.max(0, Math.round(4 * waterScale));
    const lavaWeight  = Math.max(0, Math.round((3 + Math.floor(depthBonus / 2)) * lavaScale));

    const TABLE = [
      { content: HIDDEN.NOTHING,  weight: Math.max(15, 30 - depthBonus)        },
      { content: HIDDEN.SILVER,   weight: Math.max( 8, 22 - depthBonus * 2)    },
      { content: HIDDEN.GOLD,     weight: Math.max( 4, 14 - depthBonus)        },
      { content: HIDDEN.PLATINUM, weight:  4 + depthBonus                      },
      { content: HIDDEN.DIAMOND,  weight:  1 + Math.floor(depthBonus / 3)      },
      { content: HIDDEN.WATER,    weight: waterWeight                           },
      { content: HIDDEN.LAVA,     weight: lavaWeight                            },
      { content: HIDDEN.STONE,    weight: 10 + Math.floor(depthBonus * 1.5)    },
      { content: HIDDEN.SHOVEL,   weight:  2                                    },
      { content: HIDDEN.PICK,     weight:  2                                    },
      { content: HIDDEN.BAG,      weight:  1                                    },
    ].filter(e => e.weight > 0);   // Drop zero-weight entries
    const totalWeight = TABLE.reduce((s, e) => s + e.weight, 0);

    // Per-chunk item caps so common pickups stay controlled
    const CHUNK_CAPS = { shovel: 1, pick: 1, bag: 1 };
    const chunkCount = { shovel: 0, pick: 0, bag: 0 };

    for (let y = fromY; y < fromY + CHUNK_SIZE; y++) {
      const { tiles, data } = this._getOrCreateRow(y);
      tiles.fill(TILE.DIRT);
      for (let i = 0; i < this.width; i++) data[i] = null;

      for (let x = 0; x < this.width; x++) {
        // Elevator shaft: rightmost column is always the elevator shaft (impassable)
        if (x === this.width - 1) {
          tiles[x] = TILE.ELEVATOR;
          continue;
        }

        // Mine-entrance columns: pre-clear rows down to MINE_ENT_CLEARED_DEPTH
        if (x >= MINE_ENT_X_MIN && y <= MINE_ENT_CLEARED_DEPTH) {
          tiles[x] = TILE.EMPTY;
          continue;
        }

        let roll   = rng() * totalWeight;
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

        // ~40% of tiles are impenetrable – adjacent probing has no effect.
        // The player must walk directly into these tiles to reveal them.
        const impenetrable = rng() < 0.40;

        data[x] = { hidden, threshold, probes: 0, impenetrable };
      }
    }

    // Override with pre-decided unique item positions that fall in this chunk
    for (const item of this.uniqueItemPositions) {
      if (item.y >= fromY && item.y < fromY + CHUNK_SIZE) {
        const tile = this.getTile(item.x, item.y);
        if (tile === TILE.DIRT) {
          const d = this.getData(item.x, item.y);
          if (d) d.hidden = item.content;
        }
      }
    }

    this.deepestGenY = Math.max(this.deepestGenY, fromY + CHUNK_SIZE - 1);
  }

  ensureGenerated(untilY) {
    while (this.deepestGenY < untilY) {
      this._generateChunk(this.deepestGenY + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Reveal logic
  // -------------------------------------------------------------------------

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
      // Impenetrable tiles cannot be revealed by probing – must be walked into.
      if (d.impenetrable) continue;
      d.probes++;
      const effective = Math.max(1, d.threshold - toolReduction);
      if (d.probes >= effective) {
        const content = this._revealTile(nx, ny);
        if (content !== null) revealed.push({ x: nx, y: ny, content });
      }
    }
    return revealed;
  }

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
      case HIDDEN.SILVER:       this.setTile(x, y, TILE.SILVER);       break;
      case HIDDEN.GOLD:         this.setTile(x, y, TILE.GOLD);         break;
      case HIDDEN.PLATINUM:     this.setTile(x, y, TILE.PLATINUM);     break;
      case HIDDEN.DIAMOND:      this.setTile(x, y, TILE.DIAMOND);      break;
      case HIDDEN.STONE:        this.setTile(x, y, TILE.STONE);        break;
      case HIDDEN.WATER:
        this.setTile(x, y, TILE.WATER);
        this.springTiles.add(`${x},${y}`);
        break;
      case HIDDEN.LAVA:
        this.setTile(x, y, TILE.LAVA);
        this.lavaSources.add(`${x},${y}`);
        break;
      case HIDDEN.SHOVEL:       this.setTile(x, y, TILE.SHOVEL);       break;
      case HIDDEN.PICK:         this.setTile(x, y, TILE.PICK);         break;
      case HIDDEN.BAG:          this.setTile(x, y, TILE.BAG);          break;
      case HIDDEN.RUBY:         this.setTile(x, y, TILE.RUBY);         break;
      case HIDDEN.RUBBER_BOOT:  this.setTile(x, y, TILE.RUBBER_BOOT);  break;
      case HIDDEN.POCKET_WATCH: this.setTile(x, y, TILE.POCKET_WATCH); break;
      case HIDDEN.GLASSES:      this.setTile(x, y, TILE.GLASSES);      break;
      default:                  this.setTile(x, y, TILE.EMPTY);        break;
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
   * DIRT is NOT passable – game handles dig-in before calling this.
   * STONE is NOT passable – game checks for pick before calling this.
   * WATER/LAVA are handled by _enterWater/_enterLava in game.js.
   * ELEVATOR is NOT passable – player interacts from the adjacent tile.
   */
  isPassable(x, y) {
    const t = this.getTile(x, y);
    if (t === null) return false;
    switch (t) {
      case TILE.GRASS:
      case TILE.PAVEMENT:
      case TILE.SHOP:
      case TILE.BAR:
      case TILE.DOCTOR:
      case TILE.BANK:
      case TILE.OUTHOUSE:
      case TILE.MINE_ENT:
      case TILE.EMPTY:
      case TILE.SILVER:
      case TILE.GOLD:
      case TILE.PLATINUM:
      case TILE.DIAMOND:
      case TILE.RUBY:
      case TILE.RUBBER_BOOT:
      case TILE.POCKET_WATCH:
      case TILE.GLASSES:
      case TILE.SHOVEL:
      case TILE.PICK:
      case TILE.BAG:
        return true;
      case TILE.BUILDING:
      case TILE.DIRT:
      case TILE.STONE:
      case TILE.WATER:
      case TILE.LAVA:
      case TILE.ELEVATOR:   // Impassable – interact from adjacent tile (x = width-2)
        return false;
      default:
        return false;
    }
  }

  isSpringSource(x, y) {
    return this.springTiles.has(`${x},${y}`);
  }

  isLavaSource(x, y) {
    return this.lavaSources.has(`${x},${y}`) && this.getTile(x, y) === TILE.LAVA;
  }

  spreadHazard(x, y, tileType) {
    this._spread(x, y, tileType);
  }
}
