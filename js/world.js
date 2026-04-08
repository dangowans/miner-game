'use strict';

/**
 * World – infinite-depth mine with lazy chunk generation.
 *
 * Layout:
 *   y=0  Full sky row – decorative SKY tiles above the buildings.
 *   y=1  Building facades – BUILDING/OUTHOUSE/SHOP/BAR/DOCTOR/BANK/MINE_ENT tiles.
 *   y=2  Pavement row – PAVEMENT; MINE_ENT at x=22-24 is the crossing point.
 *   y≥3  Mine – DIRT initially, generated in chunks, extends infinitely.
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
    this.deepestGenY = 2;

    // Track spring-source water tiles (cannot be cleared by bucket).
    this.springTiles = new Set();

    // Track lava-source tiles (original, not spread).
    this.lavaSources = new Set();

    this._buildSurface();
    this._generateChunk(3);   // First mine chunk (mine starts at y=3)
  }

  // -------------------------------------------------------------------------
  // Simple seeded PRNG (mulberry32)
  // -------------------------------------------------------------------------

  _makeRng(seed) {
    let s = seed >>> 0;
    const rng = () => {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.getState = () => s >>> 0;
    rng.setState = (state) => { s = state >>> 0; };
    return rng;
  }

  // -------------------------------------------------------------------------
  // Unique item pre-placement
  // -------------------------------------------------------------------------

  /**
   * Decide fixed positions for the unique items using the shared RNG.
   * Positions are restricted to columns 1-20 (avoiding the mine entrance area)
   * and to depths where the mine is fully generated as DIRT.
   * The ring is placed at a random depth 50-60 m below the outhouse so it is
   * "50 or so" metres down – same x-column as the outhouse.
   */
  _computeUniqueItemPositions() {
    const rng    = this._rng;
    const xRange = MINE_ENT_X_MIN - 2;   // 20 safe columns (x ∈ [1, 20])
    // Mine starts at y=3, so world-y = mine_depth + 2.
    return [
      { content: HIDDEN.RUBY,         y: 21 + Math.floor(rng() * 80),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.RUBBER_BOOT,  y:  9 + Math.floor(rng() * 40),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.POCKET_WATCH, y: 13 + Math.floor(rng() * 60),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.LANTERN,      y: 11 + Math.floor(rng() * 20),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.SKULL,        y:  4 + Math.floor(rng() * 22),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.CANTEEN,      y:  6 + Math.floor(rng() * 25),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.LUNCHBOX,     y:  8 + Math.floor(rng() * 28),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.RADIO,        y: 16 + Math.floor(rng() * 35),  x: 1 + Math.floor(rng() * xRange) },
      { content: HIDDEN.TIN_CAN,      y:  5 + Math.floor(rng() * 30),  x: 1 + Math.floor(rng() * xRange) },
      // Glasses at fixed depth directly below the outhouse
      { content: HIDDEN.GLASSES,      y: GLASSES_DEPTH + 2,            x: GLASSES_X },
      // Ring at random depth 50-60 m below the outhouse (world-y = depth + 2)
      { content: HIDDEN.RING,         y: 50 + Math.floor(rng() * 11) + 2, x: RING_X },
    ];
  }

  // -------------------------------------------------------------------------
  // Earthquake – re-generate the entire mine
  // -------------------------------------------------------------------------

  /**
   * Clear all mine rows and regenerate them from scratch with a new seed.
   * The surface (y=0-2) is left untouched.
   * Called by the outhouse "Earthquake" button.
   */
  regenerateMine() {
    // Remove every mine row
    for (const y of Array.from(this.rowTiles.keys())) {
      if (y >= 3) {
        this.rowTiles.delete(y);
        this.rowData.delete(y);
      }
    }

    // Clear hazard registries
    this.springTiles = new Set();
    this.lavaSources = new Set();

    // Elevator shaft state
    this.elevatorBuilt = false;

    // Re-seed the RNG and recompute unique item positions
    this._rng = this._makeRng(Date.now());
    this.uniqueItemPositions = this._computeUniqueItemPositions();
    this.deepestGenY = 2;

    // Generate the first chunk
    this._generateChunk(3);
  }

  // -------------------------------------------------------------------------
  // Family-mode jewelry placement
  // -------------------------------------------------------------------------

  /**
   * Add MAX_BABIES necklace items to the mine, spread across depths 35–80.
   * Called once when family mode is activated.
   * Items are injected into uniqueItemPositions so they appear in future chunks,
   * and also written directly into already-generated tiles.
   */
  addFamilyJewelry() {
    const xRange = MINE_ENT_X_MIN - 2;   // x ∈ [1, 20]
    const depths = [35, 50, 65, 80];     // One necklace per depth band (world-y = depth + 2)
    for (const d of depths) {
      const x = 1 + Math.floor(this._rng() * xRange);
      const y = d + 2;
      // Push into unique positions so future chunk generation respects it
      this.uniqueItemPositions.push({ content: HIDDEN.NECKLACE, x, y });
      // If the tile is already generated (DIRT), overwrite it now
      if (this.getTile(x, y) === TILE.DIRT) {
        const data = this.getData(x, y);
        if (data) data.hidden = HIDDEN.NECKLACE;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Elevator shaft
  // -------------------------------------------------------------------------

  /**
   * Build the elevator shaft: clears column x=ELEVATOR_X from y=3 down to
   * the current deepest generated row, then sets a flag so future chunk
   * generation keeps that column open.
   */
  buildElevator() {
    this.elevatorBuilt = true;
    for (let y = 3; y <= this.deepestGenY; y++) {
      if (this.getTile(ELEVATOR_X, y) !== null) {
        this.setTile(ELEVATOR_X, y, TILE.EMPTY);
        this.setData(ELEVATOR_X, y, null);
      }
    }
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
    // ── y=0: Full sky row ──────────────────────────────────────────────────
    const { tiles: sky } = this._getOrCreateRow(0);
    sky.fill(TILE.SKY);

    // ── y=1: Building facades ──────────────────────────────────────────────
    const { tiles: top } = this._getOrCreateRow(1);
    top.fill(TILE.SKY);   // Open sky between buildings

    top[OUTHOUSE_X] = TILE.OUTHOUSE;   // Left-side outhouse (x=1)
    top[0]          = TILE.FLOWER;     // Flower to the left of the outhouse (x=0)
    top[5]          = TILE.SHOP;       // General store
    top[9]          = TILE.BAR;        // Bar
    top[13]         = TILE.DOCTOR;     // Doctor
    top[BANK_X]     = TILE.BANK;       // Town bank (x=17)
    top[WORKER_X]   = TILE.WORKER;     // Construction worker (x=20)
    // Jeweler removed – x=19 remains SKY

    // Mine entrance arch at x=22-24 (decorative upper; actual entrance at y=2)
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      top[x] = TILE.MINE_ENT;
    }

    // ── y=2: Pavement row ──────────────────────────────────────────────────
    const { tiles: pave } = this._getOrCreateRow(2);
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

    // Ore is slightly less common near the top of the mine.
    // Scale rises from ~0.35 at the first chunk to 1.0 around depth 20.
    const surfaceOreScale = Math.min(1.0, 0.35 + fromY / 28);

    // Hazard weights scale up quickly from zero at the surface.
    // Water starts appearing around y=5, lava around y=8.
    const waterScale = Math.min(1, fromY / 20);
    const lavaScale  = Math.min(1, fromY / 25);
    const waterWeight = Math.max(0, Math.round(5 * waterScale));
    const lavaWeight  = Math.max(0, Math.round((4 + Math.floor(depthBonus / 2)) * lavaScale));

    const TABLE = [
      { content: HIDDEN.NOTHING,  weight: Math.max(15, 30 - depthBonus)                                          },
      { content: HIDDEN.SILVER,   weight: Math.max( 2, Math.round((22 - depthBonus * 2) * surfaceOreScale))      },
      { content: HIDDEN.GOLD,     weight: Math.max( 1, Math.round((14 - depthBonus)     * surfaceOreScale))      },
      { content: HIDDEN.PLATINUM, weight: Math.max(0, (depthBonus - 1) * 3)                                       },
      { content: HIDDEN.DIAMOND,  weight: Math.max(0, Math.floor((fromY - 60) / 10))             },
      { content: HIDDEN.WATER,    weight: waterWeight                                                              },
      { content: HIDDEN.LAVA,     weight: lavaWeight                                                               },
      { content: HIDDEN.STONE,    weight: 10 + Math.floor(depthBonus * 1.5)                                       },
      { content: HIDDEN.SHOVEL,   weight:  2                                                                       },
      { content: HIDDEN.PICK,     weight:  2                                                                       },
      { content: HIDDEN.BAG,      weight:  1                                                                       },
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
        if (x >= MINE_ENT_X_MIN && y <= MINE_ENT_CLEARED_DEPTH) {
          tiles[x] = TILE.EMPTY;
          continue;
        }

        // Keep the elevator shaft open if it has been built
        if (this.elevatorBuilt && x === ELEVATOR_X) {
          tiles[x] = TILE.EMPTY;
          data[x]  = null;
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

  probeAdjacent(px, py, toolReduction, hasLantern) {
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
      // Impenetrable tiles can only be probed from adjacent with the lantern;
      // otherwise the player must walk directly into them to reveal them.
      if (d.impenetrable && !hasLantern) continue;
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
      case HIDDEN.RING:         this.setTile(x, y, TILE.RING);         break;
      case HIDDEN.LANTERN:      this.setTile(x, y, TILE.LANTERN);      break;
      case HIDDEN.RADIO:        this.setTile(x, y, TILE.RADIO);        break;
      case HIDDEN.SKULL:        this.setTile(x, y, TILE.SKULL);        break;
      case HIDDEN.CANTEEN:      this.setTile(x, y, TILE.CANTEEN);      break;
      case HIDDEN.LUNCHBOX:     this.setTile(x, y, TILE.LUNCHBOX);     break;
      case HIDDEN.TIN_CAN:      this.setTile(x, y, TILE.TIN_CAN);      break;
      case HIDDEN.NECKLACE:     this.setTile(x, y, TILE.NECKLACE);     break;
      default:                  this.setTile(x, y, TILE.EMPTY);        break;
    }
    return hidden;
  }

  /** BFS flood-fill into adjacent EMPTY tiles and any visible ore tiles (which are destroyed). */
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
        const t = this.getTile(nx, ny);
        // Spread into empty space or over visible ore tiles (destroying them)
        if (t === TILE.EMPTY || HAZARD_DESTROYABLE_TILES.has(t)) {
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
      case TILE.JEWELER:
      case TILE.SKY:
      case TILE.DYNAMITE:
      case TILE.MINE_ENT:
      case TILE.HOUSE:
      case TILE.WORKER:
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
      case TILE.RING:
      case TILE.LANTERN:
      case TILE.RADIO:
      case TILE.SKULL:
      case TILE.CANTEEN:
      case TILE.LUNCHBOX:
      case TILE.TIN_CAN:
      case TILE.NECKLACE:
        return true;
      case TILE.BUILDING:
      case TILE.DIRT:
      case TILE.STONE:
      case TILE.WATER:
      case TILE.LAVA:
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
