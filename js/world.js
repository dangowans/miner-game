'use strict';

/**
 * World – holds the tile grid and per-tile metadata.
 *
 * Each DIRT tile has an associated data object:
 *   { hidden: HIDDEN.*, threshold: number, probes: number }
 *
 * When probes >= (threshold - toolReduction) the tile is auto-revealed.
 * Stepping directly into a DIRT tile digs it immediately (reveal + move).
 */
class World {
  constructor() {
    this.width    = MAP_WIDTH;
    this.height   = MAP_HEIGHT;
    this.tiles    = [];  // [y][x]  → TILE.*
    this.tileData = [];  // [y][x]  → object | null
    this._generate();
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  _generate() {
    for (let y = 0; y < this.height; y++) {
      this.tiles[y]    = new Array(this.width).fill(TILE.GRASS);
      this.tileData[y] = new Array(this.width).fill(null);
    }
    this._buildSurface();
    this._buildMine();
  }

  _buildSurface() {
    const y = 0;
    // Fill row with grass
    for (let x = 0; x < this.width; x++) this.tiles[y][x] = TILE.GRASS;

    // House 1 (left edge, decorative)
    this.tiles[y][0] = TILE.BUILDING;
    this.tiles[y][1] = TILE.BUILDING;
    this.tiles[y][2] = TILE.BUILDING;

    // Shop:  x=4 wall | x=5 door | x=6 wall
    this.tiles[y][4] = TILE.BUILDING;
    this.tiles[y][5] = TILE.SHOP;
    this.tiles[y][6] = TILE.BUILDING;

    // Bar:   x=8 wall | x=9 door | x=10 wall
    this.tiles[y][8]  = TILE.BUILDING;
    this.tiles[y][9]  = TILE.BAR;
    this.tiles[y][10] = TILE.BUILDING;

    // Doctor: x=12 wall | x=13 door | x=14 wall
    this.tiles[y][12] = TILE.BUILDING;
    this.tiles[y][13] = TILE.DOCTOR;
    this.tiles[y][14] = TILE.BUILDING;

    // Mine entrance (right side)
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      this.tiles[y][x] = TILE.MINE_ENT;
    }
  }

  _buildMine() {
    // Probability table for hidden content
    const TABLE = [
      { content: HIDDEN.NOTHING,  weight: 38 },
      { content: HIDDEN.GEM_LOW,  weight: 30 },
      { content: HIDDEN.GEM_MED,  weight: 15 },
      { content: HIDDEN.GEM_HIGH, weight:  5 },
      { content: HIDDEN.WATER,    weight:  4 },
      { content: HIDDEN.LAVA,     weight:  3 },
      { content: HIDDEN.SHOVEL,   weight:  2 },
      { content: HIDDEN.PICK,     weight:  2 },
      { content: HIDDEN.BAG,      weight:  1 },
    ];
    const totalWeight = TABLE.reduce((s, e) => s + e.weight, 0);

    // Caps for rare items
    let shovels = 0, picks = 0, bags = 0;
    const SHOVEL_MAX = 2, PICK_MAX = 2, BAG_MAX = 2;

    for (let y = 1; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y][x] = TILE.DIRT;

        // Random content
        let roll = Math.random() * totalWeight;
        let hidden = HIDDEN.NOTHING;
        for (const entry of TABLE) {
          roll -= entry.weight;
          if (roll <= 0) { hidden = entry.content; break; }
        }

        // Enforce item caps
        if (hidden === HIDDEN.SHOVEL) {
          if (shovels >= SHOVEL_MAX) hidden = HIDDEN.NOTHING; else shovels++;
        } else if (hidden === HIDDEN.PICK) {
          if (picks >= PICK_MAX) hidden = HIDDEN.NOTHING; else picks++;
        } else if (hidden === HIDDEN.BAG) {
          if (bags >= BAG_MAX) hidden = HIDDEN.NOTHING; else bags++;
        }

        const threshold =
          REVEAL_MIN + Math.floor(Math.random() * (REVEAL_MAX - REVEAL_MIN + 1));

        this.tileData[y][x] = { hidden, threshold, probes: 0 };
      }
    }

    // Pre-clear the mine-entrance columns so the player can actually enter
    for (let x = MINE_ENT_X_MIN; x <= MINE_ENT_X_MAX; x++) {
      for (let my = 1; my <= 2; my++) {
        this.tiles[my][x]    = TILE.EMPTY;
        this.tileData[my][x] = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tile accessors
  // -------------------------------------------------------------------------

  getTile(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y][x];
  }

  setTile(x, y, tileType) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.tiles[y][x] = tileType;
  }

  getData(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tileData[y][x];
  }

  // -------------------------------------------------------------------------
  // Reveal logic
  // -------------------------------------------------------------------------

  /**
   * Probe all DIRT tiles adjacent to (px, py).
   * Increments their probe counter; reveals any that reach their threshold.
   * Returns array of { x, y, content } for newly-revealed tiles.
   *
   * @param {number} px
   * @param {number} py
   * @param {number} toolReduction  – combined shovel+pick reduction
   */
  probeAdjacent(px, py, toolReduction) {
    const revealed = [];
    const DIRS = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 },
                  { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
    for (const { dx, dy } of DIRS) {
      const nx = px + dx, ny = py + dy;
      if (this.getTile(nx, ny) !== TILE.DIRT) continue;
      const data = this.getData(nx, ny);
      if (!data) continue;
      data.probes++;
      const effective = Math.max(1, data.threshold - toolReduction);
      if (data.probes >= effective) {
        const content = this._revealTile(nx, ny);
        if (content !== null) revealed.push({ x: nx, y: ny, content });
      }
    }
    return revealed;
  }

  /**
   * Immediately dig into a DIRT tile (player stepped directly onto it).
   * Returns the hidden content string, or null if not a DIRT tile.
   */
  digInto(x, y) {
    if (this.getTile(x, y) !== TILE.DIRT) return null;
    return this._revealTile(x, y);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Convert a DIRT tile to its revealed appearance and trigger side-effects. */
  _revealTile(x, y) {
    const data = this.getData(x, y);
    if (!data) return null;
    const { hidden } = data;
    this.tileData[y][x] = null;   // Clear metadata

    switch (hidden) {
      case HIDDEN.GEM_LOW:  this.setTile(x, y, TILE.GEM_LOW);  break;
      case HIDDEN.GEM_MED:  this.setTile(x, y, TILE.GEM_MED);  break;
      case HIDDEN.GEM_HIGH: this.setTile(x, y, TILE.GEM_HIGH); break;
      case HIDDEN.WATER:
        this.setTile(x, y, TILE.WATER);
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

  /** BFS flood-fill from (sx, sy) into adjacent EMPTY tiles. */
  _spread(sx, sy, tileType) {
    const queue   = [{ x: sx, y: sy }];
    const visited = new Set([`${sx},${sy}`]);
    let   count   = 0;
    const DIRS    = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 },
                     { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

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
   * Returns true if the player can attempt to enter (x, y).
   * DIRT is NOT passable here — the game loop handles dig-in separately.
   * LAVA is passable (player may enter) but deals damage — handled in game.js.
   * WATER blocks movement entirely.
   */
  isPassable(x, y) {
    const t = this.getTile(x, y);
    if (t === null) return false;
    switch (t) {
      case TILE.GRASS:
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
      case TILE.LAVA:     // passable but damaging
        return true;
      case TILE.BUILDING:
      case TILE.DIRT:
      case TILE.WATER:    // impassable
        return false;
      default:
        return false;
    }
  }
}
