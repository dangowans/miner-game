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
 *   DIRT   → "dig-in": reveal hidden content; move there if resulting tile
 *             is passable (gems, empty, items).  If stone is revealed the
 *             player still needs a pick to enter on the next move.
 *
 *   LAVA   → lava source: impassable; walking into it triggers re-spread and costs
 *             1 heart.  With fire extinguisher: lava → STONE (no damage, player stays
 *             put, extinguisher loses 1 use).  Spread lava: player moves onto it,
 *             tile remains, costs 1 heart.
 *
 *   WATER  → spring source: impassable; walking into it triggers re-spread and costs
 *             1 heart.  Spread water: player moves onto it, tile remains, costs 1
 *             heart.  With bucket: non-source spread water clears to EMPTY (free
 *             passage), bucket loses 1 use.
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

    this._lastTime  = 0;
    this._dynamites = [];   // Array of { x, y, frames } for lit dynamite placements
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

    // Always tick dynamite fuses each frame, independent of player input
    this._tickDynamites();

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
      case 'dynamite': this._toggleDynamitePlacement(); break;
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

    // ── Dynamite placement mode ───────────────────────────────────────────
    if (p.placingDynamite) {
      this._placeDynamite(dx, dy);
      return;
    }

    // World boundary (left / right / top of pavement)
    if (nx < 0) {
      // Walking off the left edge
      this.input.clear();
      this.state = 'overlay';
      this.ui.openDragons(() => { this.state = 'playing'; this.input.clear(); });
      return;
    }
    if (nx >= this.world.width) {
      // Walking off the right edge
      this.input.clear();
      this.state = 'overlay';
      this.ui.openDragons(() => { this.state = 'playing'; this.input.clear(); });
      return;
    }
    if (ny < 1) {
      // Walking into the building row — treat as interact if player is on pavement
      if (p.y === 1) this._handleInteract();
      return;
    }

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
        p.pickUses--;
        sounds.playCrumbleStone();
        if (p.pickUses <= 0) {
          p.hasPick   = false;
          p.pickUses  = 0;
          p.setMessage('⚒ Stone broken! Pick broke — buy a new one.');
          sounds.playToolBreak();
        } else {
          p.setMessage(`⚒ Stone broken! (${p.pickUses} use${p.pickUses !== 1 ? 's' : ''} left)`);
        }
        this._afterMove(nx, ny);
      } else {
        p.setMessage('🪨 You need a Pick to break stone.');
        sounds.playTinkStone();
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
      this._afterMove(nx, ny);
    }
  }

  /**
   * Handle player entering a lava tile.
   *
   * - Extinguisher (any lava): converts to STONE, player stays, uses 1 charge.
   * - Lava source (no extinguisher): impassable; re-spreads and deals 1 heart.
   * - Spread lava (no extinguisher): player moves onto it, tile stays, deals 1 heart.
   */
  _enterLava(p, nx, ny) {
    if (p.hasExtinguisher) {
      // Extinguisher: convert to stone regardless of source vs spread
      this.world.setTile(nx, ny, TILE.STONE);
      p.extinguisherUses--;
      if (p.extinguisherUses <= 0) {
        p.hasExtinguisher   = false;
        p.extinguisherUses  = 0;
        p.setMessage('🧯 Lava → stone! Extinguisher used up — buy a new one.');
        sounds.playToolBreak();
      } else {
        p.setMessage(`🧯 Lava → stone! (${p.extinguisherUses} use${p.extinguisherUses !== 1 ? 's' : ''} left) Use Pick to enter.`);
      }
    } else if (this.world.isLavaSource(nx, ny)) {
      // Lava source: impassable; re-spread and deal damage
      this.world.spreadHazard(nx, ny, TILE.LAVA);
      this._applyHazardDamage('lava_source');
    } else {
      // Spread lava: player moves onto it, tile stays, deal damage
      p.x = nx; p.y = ny;
      const died = this._applyHazardDamage('lava');
      if (!died) this._afterMove(nx, ny);
    }
  }

  /**
   * Handle player entering a water tile.
   *
   * - Spring source (always): impassable; re-spreads and deals 1 heart.
   * - Spread water + bucket: clears tile to EMPTY, free passage, uses 1 bucket charge.
   * - Spread water (no bucket): player moves onto it, tile stays, deals 1 heart.
   */
  _enterWater(p, nx, ny) {
    const isSource = this.world.isSpringSource(nx, ny);

    if (isSource) {
      // Spring source: always impassable; re-spread and deal damage
      this.world.spreadHazard(nx, ny, TILE.WATER);
      this._applyHazardDamage('water_source');
    } else if (p.hasBucket) {
      // Bucket clears spread water – free passage, no damage, uses 1 charge
      this.world.setTile(nx, ny, TILE.EMPTY);
      p.x = nx; p.y = ny;
      p.bucketUses--;
      if (p.bucketUses <= 0) {
        p.hasBucket   = false;
        p.bucketUses  = 0;
        p.setMessage('🪣 Cleared water! Bucket broke — buy a new one.');
        sounds.playToolBreak();
      } else {
        p.setMessage(`🪣 Cleared water with bucket. (${p.bucketUses} use${p.bucketUses !== 1 ? 's' : ''} left)`);
      }
      this._afterMove(nx, ny);
    } else {
      // Spread water, no bucket: player moves onto it, tile stays, deal damage
      p.x = nx; p.y = ny;
      const died = this._applyHazardDamage('water');
      if (!died) this._afterMove(nx, ny);
    }
  }

  /** Shared post-move logic: probe neighbours + pickup. */
  _afterMove(x, y) {
    // Only probe adjacent dirt tiles when the player is inside the mine (y≥2).
    // Pavement movement (y=1) must not reveal hidden content in the top mine row.
    if (y >= 2) {
      const revealed = this.world.probeAdjacent(x, y, this.player.toolReduction);
      for (const { x: rx, y: ry, content } of revealed) {
        this._onContentRevealed(content, rx, ry);
      }
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
    sounds.playHazardHit();
    if (died) {
      this.state = 'dead';
      this.ui.showDead();
    } else {
      const what = hazardType === 'lava'         ? '🔥 Lava burn'
                 : hazardType === 'lava_source'  ? '🔥 Lava source — can\'t pass'
                 : hazardType === 'water'        ? '💧 Waded through water'
                 : hazardType === 'water_source' ? '💧 Spring source — can\'t pass'
                 : '⚠️ Hazard hit';
      p.setMessage(`${what}! (${p.hearts}/${p.maxHearts} ♥ remaining)`);
    }
    return died;
  }

  // -------------------------------------------------------------------------
  // Dynamite
  // -------------------------------------------------------------------------

  /** Toggle dynamite placement mode on/off. */
  _toggleDynamitePlacement() {
    const p = this.player;
    if (p.placingDynamite) {
      p.placingDynamite = false;
      p.setMessage('Dynamite placement cancelled.');
    } else if (p.dynamiteCount > 0) {
      p.placingDynamite = true;
      p.setMessage('💣 Move in any direction to place dynamite, or press 💣 again to cancel.');
    } else {
      p.setMessage('No dynamite — buy some at the Shop.');
    }
  }

  /**
   * Place a stick of dynamite in the tile adjacent to the player in direction (dx, dy).
   * The player stays put; a TILE.DYNAMITE tile is created and the fuse starts.
   */
  _placeDynamite(dx, dy) {
    const p  = this.player;
    const tx = p.x + dx;
    const ty = p.y + dy;

    // Can only place inside the mine (y≥2) in an empty tile
    const tile = this.world.getTile(tx, ty);
    if (ty < 2 || tile !== TILE.EMPTY) {
      p.setMessage('💣 Can only place dynamite on empty mine tiles.');
      p.placingDynamite = false;
      return;
    }

    this.world.setTile(tx, ty, TILE.DYNAMITE);
    this.world.setData(tx, ty, { frames: DYNAMITE_FUSE_FRAMES });
    this._dynamites.push({ x: tx, y: ty, frames: DYNAMITE_FUSE_FRAMES });
    p.dynamiteCount--;
    p.placingDynamite = false;
    p.setMessage('💣 Dynamite placed! 5 seconds — RUN!');
    sounds.playDynamitePlace();
    this.ui.updateHUD(p);
  }

  /** Decrement fuse counters each frame; detonate any that reach zero. */
  _tickDynamites() {
    if (this._dynamites.length === 0) return;
    const toExplode = [];
    for (const dyn of this._dynamites) {
      dyn.frames--;
      // Update the per-tile data so the renderer can show remaining seconds
      this.world.setData(dyn.x, dyn.y, { frames: dyn.frames });
      if (dyn.frames <= 0) toExplode.push(dyn);
    }
    for (const dyn of toExplode) {
      this._explodeDynamite(dyn);
      if (this.state !== 'playing') return;  // Player may have died
    }
    this._dynamites = this._dynamites.filter(d => d.frames > 0);
  }

  /**
   * Detonate a dynamite charge.
   * Clears DIRT and STONE in a circular blast radius; damages the player
   * based on distance (2 hearts within 2 tiles, 1 heart within full radius).
   */
  _explodeDynamite(dyn) {
    const { x: bx, y: by } = dyn;
    sounds.playDynamiteExplode();

    // Clear tiles in blast radius (mine rows only)
    for (let dx = -DYNAMITE_RADIUS; dx <= DYNAMITE_RADIUS; dx++) {
      for (let dy = -DYNAMITE_RADIUS; dy <= DYNAMITE_RADIUS; dy++) {
        if (dx * dx + dy * dy > DYNAMITE_RADIUS * DYNAMITE_RADIUS) continue;
        const tx = bx + dx;
        const ty = by + dy;
        if (ty < 2) continue;  // Don't blast the surface
        const t = this.world.getTile(tx, ty);
        if (t === TILE.DIRT || t === TILE.STONE || t === TILE.DYNAMITE) {
          this.world.setTile(tx, ty, TILE.EMPTY);
          this.world.setData(tx, ty, null);
          // Also remove any chained dynamite entries that got blasted
          this._dynamites = this._dynamites.filter(d => d.x !== tx || d.y !== ty);
        }
      }
    }

    // Damage player based on distance from blast centre (squared to avoid sqrt)
    const p       = this.player;
    const distSq  = (p.x - bx) ** 2 + (p.y - by) ** 2;
    if (distSq <= DYNAMITE_CRITICAL_RADIUS * DYNAMITE_CRITICAL_RADIUS) {
      const died = p.takeDamageMultiple(2);
      sounds.playHazardHit();
      if (died) {
        this.state = 'dead';
        this.ui.showDead();
        return;
      }
      p.setMessage(`💥 Too close to the blast! 2 damage (${p.hearts}/${p.maxHearts} ♥)`);
    } else if (distSq <= DYNAMITE_RADIUS * DYNAMITE_RADIUS) {
      const died = p.takeDamage();
      sounds.playHazardHit();
      if (died) {
        this.state = 'dead';
        this.ui.showDead();
        return;
      }
      p.setMessage(`💥 Caught in the blast! 1 damage (${p.hearts}/${p.maxHearts} ♥)`);
    }

    this.ui.updateHUD(p);
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
      // ── Ore (silver / gold / platinum / diamond) ───────────────────────
      case TILE.SILVER:
      case TILE.GOLD:
      case TILE.PLATINUM:
      case TILE.DIAMOND: {
        const key = tile === TILE.SILVER   ? HIDDEN.SILVER
                  : tile === TILE.GOLD     ? HIDDEN.GOLD
                  : tile === TILE.PLATINUM ? HIDDEN.PLATINUM
                  :                          HIDDEN.DIAMOND;
        if (p.canCarry()) {
          p.addGem(key);
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage(`Ore collected! ${ORE_NAME[key]} (worth $${GEM_VALUE[key]})`);
          p.triggerCollectFlash(ORE_FLASH_COLOR[key]);
          sounds.playOreCollect(key);
        } else {
          p.setMessage('🎒 Bag full! Return to the surface to sell at the Bank.');
        }
        break;
      }

      // ── Unique legendary ruby (sellable at bank) ───────────────────────
      case TILE.RUBY: {
        if (p.canCarry()) {
          p.addGem(HIDDEN.RUBY);
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage(`🔴 LEGENDARY RUBY found! Sell it at the Bank for $${GEM_VALUE[HIDDEN.RUBY]}!`);
          p.triggerCollectFlash(ORE_FLASH_COLOR[HIDDEN.RUBY]);
          sounds.playOreCollect(HIDDEN.RUBY);
        } else {
          p.setMessage('🎒 Bag full! Cannot pick up the ruby.');
        }
        break;
      }

      // ── Unique novelty items ───────────────────────────────────────────
      case TILE.RUBBER_BOOT: {
        if (!p.specialItems.has('rubber_boot')) {
          p.specialItems.add('rubber_boot');
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('🥾 You found a rubber boot. One of a kind!');
          sounds.playItemPickup();
        }
        break;
      }

      case TILE.POCKET_WATCH: {
        if (!p.specialItems.has('pocket_watch')) {
          p.specialItems.add('pocket_watch');
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('⌚ A pocket watch! Still ticking after all these years.');
          sounds.playItemPickup();
        }
        break;
      }

      case TILE.GLASSES: {
        if (!p.specialItems.has('glasses')) {
          p.specialItems.add('glasses');
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('🕶️ Stylish glasses. You look great down here.');
          sounds.playItemPickup();
        }
        break;
      }

      // ── Tool items ─────────────────────────────────────────────────────
      case TILE.SHOVEL: {
        if (!p.hasShovel) {
          p.hasShovel = true;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('⛏ Found a Shovel! Digging dirt is easier now.');
          sounds.playItemPickup();
        }
        break;
      }

      case TILE.PICK: {
        if (!p.hasPick) {
          p.hasPick  = true;
          p.pickUses = TOOL_USES;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage(`⚒ Found a Pick! Walk into stone to break it. (${TOOL_USES} uses)`);
          sounds.playItemPickup();
        }
        break;
      }

      case TILE.BAG: {
        if (!p.hasBag) {
          p.hasBag  = true;
          p.maxGems = 20;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('🎒 Found a Large Bag! Carry capacity doubled.');
          sounds.playItemPickup();
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
    const checkTile = (type) =>
      this.world.getTile(p.x, p.y)     === type ||
      this.world.getTile(p.x, p.y - 1) === type;

    if (checkTile(TILE.OUTHOUSE)) {
      this.state = 'overlay';
      this.ui.openOuthouse(() => { this.state = 'playing'; this.input.clear(); });
      return;
    }

    if (checkTile(TILE.SHOP)) {
      this.state = 'overlay';
      this.ui.openShop(p, () => {
        this.state = 'playing';
        this.input.clear();
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
          this.input.clear();
        }
      });
      return;
    }

    if (checkTile(TILE.DOCTOR)) {
      this.state = 'overlay';
      this.ui.openDoctor(p, () => {
        this.state = 'playing';
        this.input.clear();
        this.ui.updateHUD(p);
      });
      return;
    }

    if (checkTile(TILE.BANK)) {
      this.state = 'overlay';
      this.ui.openBank(p, () => {
        this.state = 'playing';
        this.input.clear();
        this.ui.updateHUD(p);
      });
      return;
    }

    if (checkTile(TILE.JEWELER)) {
      this.state = 'overlay';
      this.ui.openJeweler(p, () => {
        this.state = 'playing';
        this.input.clear();
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
