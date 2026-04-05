'use strict';

/**
 * Game – main loop, movement, digging, hazard logic, interaction dispatch.
 *
 * State machine:
 *   'playing'  – normal gameplay; input consumed and world updated
 *   'overlay'  – shop / bar / doctor overlay open; input paused
 *   'dead'     – player died; overlay shown
 *   'won'      – player won; overlay shown
 *
 * ── Movement rules ──────────────────────────────────────────────────────────
 *   4-directional grid movement (up/down/left/right).
 *
 *   Surface ↔ mine crossing ONLY at x ∈ [MINE_ENT_X_MIN, MINE_ENT_X_MAX].
 *
 *   DIRT   → "dig-in": reveal hidden content; move there if resulting tile
 *             is passable (gems, empty, items).  If stone is revealed the
 *             player still needs a pick to enter on the next move.
 *
 *   STONE  → impassable without pick.  With pick: breaks to EMPTY, player
 *             moves there.  (Pick has NO effect on dirt reveal speed.)
 *
 *   WATER  → impassable normally.
 *             With bucket: non-source water clears to EMPTY, player moves
 *             there.  Spring-source water is ALWAYS blocked (can never be
 *             cleared by the bucket).
 *
 *   LAVA   → without fire extinguisher: 1 heart damage, tile → EMPTY,
 *             player moves there.
 *             With fire extinguisher: lava → STONE (no damage, player stays
 *             put).  Player can then break the stone with a pick.
 *
 * ── Reveal mechanic ─────────────────────────────────────────────────────────
 *   After each valid move world.probeAdjacent() increments the probe counter
 *   of all neighbouring DIRT tiles.  When a tile's probes reach its
 *   (threshold − SHOVEL_REDUCTION) it auto-reveals (shovel only; pick has no
 *   effect on dirt).
 */
class Game {
  constructor() {
    this.canvas   = document.getElementById('canvas');
    this.world    = new World();
    this.player   = new Player();
    this.renderer = new Renderer(this.canvas);
    this.ui       = new UI();
    this.input    = new Input();
    this.state    = 'playing';

    this._lastTime = 0;
    requestAnimationFrame((t) => this._loop(t));
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  _loop(timestamp) {
    const dt = Math.min(timestamp - this._lastTime, MAX_DELTA_TIME_MS);
    this._lastTime = timestamp;
    this._update(dt);
    this._render();
    requestAnimationFrame((t) => this._loop(t));
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  _update(_dt) {
    if (this.state !== 'playing') return;
    if (this.ui.overlayOpen)      return;

    // Pre-generate mine rows ahead of the player
    this.world.ensureGenerated(this.player.y + GEN_LOOKAHEAD);

    const action = this.input.dequeue();
    if (!action) return;

    switch (action) {
      case 'up':       this._tryMove( 0, -1); break;
      case 'down':     this._tryMove( 0,  1); break;
      case 'left':     this._tryMove(-1,  0); break;
      case 'right':    this._tryMove( 1,  0); break;
      case 'interact': this._handleInteract(); break;
    }

    this.player.tick();
    this.ui.updateHUD(this.player);
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  _tryMove(dx, dy) {
    const p  = this.player;
    const nx = p.x + dx;
    const ny = p.y + dy;

    // World boundary (left / right / top of pavement)
    if (nx < 0 || nx >= this.world.width || ny < 1) return;

    // Pavement (y=1) ↔ mine (y=2) boundary: only crossable at mine-entrance columns
    if ((p.y === 1 && ny === 2) || (p.y === 2 && ny === 1)) {
      if (nx < MINE_ENT_X_MIN || nx > MINE_ENT_X_MAX) return;
    }

    const targetTile = this.world.getTile(nx, ny);

    // ── 1. Dirt dig-in ────────────────────────────────────────────────────
    if (targetTile === TILE.DIRT) {
      const content = this.world.digInto(nx, ny);
      this._onContentRevealed(content, nx, ny);

      const newTile = this.world.getTile(nx, ny);

      // Stone revealed by digging: do NOT move (need pick on next move)
      if (newTile === TILE.STONE) return;

      // Hazard tiles revealed by digging are entered via their own helpers
      if (newTile === TILE.LAVA)  { this._enterLava(p, nx, ny); return; }
      if (newTile === TILE.WATER) { this._enterWater(p, nx, ny); return; }

      if (this.world.isPassable(nx, ny)) {
        p.x = nx; p.y = ny;
        this._afterMove(nx, ny);
      }
      return;
    }

    // ── 2. Stone: needs pick ──────────────────────────────────────────────
    if (targetTile === TILE.STONE) {
      if (p.hasPick) {
        this.world.setTile(nx, ny, TILE.EMPTY);
        p.x = nx; p.y = ny;
        p.setMessage('⚒ Stone broken!');
        this._afterMove(nx, ny);
      } else {
        p.setMessage('🪨 You need a Pick to break stone.');
      }
      return;
    }

    // ── 3. Water: bucket clears spread water (free); wading costs 1 heart ─
    if (targetTile === TILE.WATER) {
      this._enterWater(p, nx, ny);
      return;
    }

    // ── 4. Lava: extinguisher converts to stone; otherwise costs 1 heart ──
    if (targetTile === TILE.LAVA) {
      this._enterLava(p, nx, ny);
      return;
    }

    // ── 5. Normal passable tile ───────────────────────────────────────────
    if (this.world.isPassable(nx, ny)) {
      p.x = nx; p.y = ny;
      const revealed = this.world.probeAdjacent(nx, ny, p.toolReduction);
      for (const { x, y, content } of revealed) {
        this._onContentRevealed(content, x, y);
      }
      this._checkPickup(nx, ny);
    }
  }

  /** Handle player entering a lava tile. */
  _enterLava(p, nx, ny) {
    if (p.hasExtinguisher) {
      // Convert lava to stone – player stays put, needs pick to continue
      this.world.setTile(nx, ny, TILE.STONE);
      p.setMessage('🧯 Lava extinguished → stone! Use your Pick to break through.');
    } else {
      // Take 1 heart damage, convert tile to empty, move there
      p.x = nx; p.y = ny;
      this.world.setTile(nx, ny, TILE.EMPTY);
      const died = this._applyHazardDamage('lava');
      if (!died) this._afterMove(nx, ny);
    }
  }

  /**
   * Handle player entering a water tile.
   * - With bucket (spread water only): clears tile to empty, no damage.
   * - Otherwise: wade through at the cost of 1 heart.
   *   Spread water is cleared to empty after wading; spring sources refill
   *   and stay as water (their tile is never cleared).
   */
  _enterWater(p, nx, ny) {
    const isSource = this.world.isSpringSource(nx, ny);
    if (p.hasBucket && !isSource) {
      // Bucket clears spread water – free passage, no damage
      this.world.setTile(nx, ny, TILE.EMPTY);
      p.x = nx; p.y = ny;
      p.setMessage('🪣 Cleared water with bucket.');
      this._afterMove(nx, ny);
    } else {
      // Wading through: 1 heart damage
      p.x = nx; p.y = ny;
      if (!isSource) {
        // Spread water is waded through and clears; spring source keeps flowing
        this.world.setTile(nx, ny, TILE.EMPTY);
      }
      const died = this._applyHazardDamage('water');
      if (!died) this._afterMove(nx, ny);
    }
  }

  /** Shared post-move logic: probe neighbours + pickup. */
  _afterMove(x, y) {
    const revealed = this.world.probeAdjacent(x, y, this.player.toolReduction);
    for (const { x: rx, y: ry, content } of revealed) {
      this._onContentRevealed(content, rx, ry);
    }
    this._checkPickup(x, y);
  }

  // -------------------------------------------------------------------------
  // Hazard damage
  // -------------------------------------------------------------------------

  /** Apply 1 heart of hazard damage. Returns true if the player just died. */
  _applyHazardDamage(hazardType) {
    const p    = this.player;
    const died = p.takeDamage();
    if (died) {
      this.state = 'dead';
      this.ui.showDead();
    } else {
      const what = hazardType === 'lava'  ? '🔥 Lava burn'
                 : hazardType === 'water' ? '💧 Waded through water'
                 : '⚠️ Hazard hit';
      p.setMessage(`${what}! (${p.hearts}/${p.maxHearts} ♥ remaining)`);
    }
    return died;
  }

  // -------------------------------------------------------------------------
  // Content reveal callback
  // -------------------------------------------------------------------------

  _onContentRevealed(content, _x, _y) {
    if (content === HIDDEN.WATER) {
      this.player.setMessage('💧 A water spring burst open nearby!');
    } else if (content === HIDDEN.LAVA) {
      this.player.setMessage('🔥 Lava erupted nearby! Watch your step!');
    } else if (content === HIDDEN.STONE) {
      this.player.setMessage('🪨 Stone revealed. You\'ll need a Pick to break it.');
    }
  }

  // -------------------------------------------------------------------------
  // Pickup / tile interactions on arrival
  // -------------------------------------------------------------------------

  _checkPickup(x, y) {
    const p    = this.player;
    const tile = this.world.getTile(x, y);

    switch (tile) {
      case TILE.GEM_LOW:
      case TILE.GEM_MED:
      case TILE.GEM_HIGH: {
        const key = tile === TILE.GEM_LOW  ? HIDDEN.GEM_LOW
                  : tile === TILE.GEM_MED  ? HIDDEN.GEM_MED
                  :                          HIDDEN.GEM_HIGH;
        if (p.canCarry()) {
          p.addGem(key);
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage(`💎 Gem collected! (worth $${GEM_VALUE[key]})`);
        } else {
          p.setMessage('🎒 Bag full! Return to the surface to sell gems.');
        }
        break;
      }

      case TILE.SHOVEL: {
        if (!p.hasShovel) {
          p.hasShovel = true;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('⛏ Found a Shovel! Digging dirt is easier now.');
        }
        break;
      }

      case TILE.PICK: {
        if (!p.hasPick) {
          p.hasPick = true;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('⚒ Found a Pick! Walk into stone to break it.');
        }
        break;
      }

      case TILE.BAG: {
        if (!p.hasBag) {
          p.hasBag  = true;
          p.maxGems = 20;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('🎒 Found a Large Bag! Carry capacity doubled.');
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interact (E / Enter)
  // -------------------------------------------------------------------------

  _handleInteract() {
    const p = this.player;
    // Check both the tile the player stands on AND the facade tile directly above.
    // Buildings are at y=0; the player walks the pavement at y=1 and interacts
    // by standing below a door tile and pressing E.
    const checkTile = (type) =>
      this.world.getTile(p.x, p.y)     === type ||
      this.world.getTile(p.x, p.y - 1) === type;

    if (checkTile(TILE.SHOP)) {
      this.state = 'overlay';
      this.ui.openShop(p, () => {
        this.state = 'playing';
        this.ui.updateHUD(p);
      });
      return;
    }

    if (checkTile(TILE.BAR)) {
      this.state = 'overlay';
      this.ui.openBar(p, (won) => {
        if (won) {
          this.state = 'won';
          this.ui.showWin();
        } else {
          this.state = 'playing';
        }
      });
      return;
    }

    if (checkTile(TILE.DOCTOR)) {
      this.state = 'overlay';
      this.ui.openDoctor(p, () => {
        this.state = 'playing';
        this.ui.updateHUD(p);
      });
      return;
    }

    if (checkTile(TILE.MINE_ENT)) {
      p.setMessage('⛏ Walk down (↓ / S) to enter the mine.');
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  _render() {
    this.renderer.draw(this.world, this.player);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => { new Game(); });
