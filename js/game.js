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
 *   of all neighbouring DIRT tiles.  Impenetrable tiles require the lantern to
 *   be probed from adjacent; otherwise the player must walk directly into them.
 *   When a tile's probes reach its (threshold − SHOVEL_REDUCTION) it
 *   auto-reveals (shovel only; pick has no effect on dirt).
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
    this._startTime = performance.now();
    this._previousPlayTimeMs = 0;  // Accumulated play time from prior saved sessions
    this._lastSaveTime = 0;   // Throttle: track when the last save was written
    this._dynamites = [];   // Array of { x, y, frames } for lit dynamite placements
    this._dragonWarnings = 0;  // Count of times the player has been warned about dragons

    // Family-mode timers (wall-clock Date.now() epoch timestamps; 0 = inactive)
    this._lastTaxTime          = 0;
    this._taxGraceStart        = 0;
    this._taxInGrace           = false;
    this._lastSuppliesTickTime = 0;
    this._suppliesGraceStart   = 0;
    this._suppliesInGrace      = false;

    // Restore a previous session if one was saved
    const saved = Storage.load();
    if (saved) {
      Storage.restorePlayer(this.player, saved.player);
      Storage.restoreWorld(this.world, saved.world);
      Storage.restoreGame(this, saved.game);
      // Ensure Contractor Mike tile is present in family mode saves that
      // predate the worker tile addition (older version-3 saves may lack it).
      if (this.player.familyMode) {
        this.world.setTile(WORKER_X, 1, TILE.WORKER);
        // Reapply expansion tiles so saves that predate this feature are correct.
        this._applyHouseExpansionTiles(this.player.houseLevel);
      }
      this.ui.updateHUD(this.player);
    } else if (Storage.popStartInFamilyMode()) {
      // Player chose "Jump to Family Mode" from the outhouse shortcut
      this.player.money = 100;   // Starter funds for convenience
      this._activateFamilyMode(true);
    }

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

  /** Returns a human-readable string of elapsed time since the game started. */
  _elapsedTimeLabel() {
    const totalMs = this._previousPlayTimeMs + (performance.now() - this._startTime);
    const totalSec = Math.floor(totalMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return mins > 0
      ? `${mins}m ${secs}s`
      : `${secs}s`;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  _update(_dt) {
    // Tick family-mode timers regardless of overlay state so deadlines are real-time,
    // but only when no overlay is blocking interaction.
    if (this.player.familyMode && this.state === 'playing' && !this.ui.overlayOpen) {
      this._tickFamilyMode();
      if (this.state !== 'playing') return;
    }

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
      case 'firstaid': this._useFirstAidKit(); break;
      case 'radio':    this._useRadio();       break;
    }

    this.player.tick();
    this.ui.updateHUD(this.player);
    this._saveThrottled();
  }

  /**
   * Write a save snapshot at most once every 500 ms to avoid hammering
   * localStorage on rapid repeated key-presses.
   */
  _saveThrottled() {
    if (this.state !== 'playing') return;
    const now = performance.now();
    if (now - this._lastSaveTime < 500) return;
    this._lastSaveTime = now;
    Storage.save(this.player, this.world, this);
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  /**
   * Show the dragons warning overlay. After 10 warnings, show the game-over
   * "You were warned" screen instead.
   */
  _warnDragons() {
    this.input.clear();
    this._dragonWarnings++;
    if (this._dragonWarnings >= 10) {
      Storage.clear();
      this.state = 'dead';
      const stats = this.player.familyMode ? this._collectFamilyStats() : null;
      this.ui.showWarned(this._elapsedTimeLabel(), stats);
    } else {
      this.state = 'overlay';
      this.ui.openDragons(() => { this.state = 'playing'; this.input.clear(); });
    }
  }

  _tryMove(dx, dy) {
    const p  = this.player;
    const nx = p.x + dx;
    const ny = p.y + dy;

    // ── Dynamite placement mode ───────────────────────────────────────────
    if (p.placingDynamite) {
      this._placeDynamite(dx, dy);
      return;
    }

    // ── Elevator cabin mode ───────────────────────────────────────────────
    if (p.inElevator) {
      if (dx !== 0) {
        // Step out of the elevator to the left (back into the mine).
        // ELEVATOR_X - 1 = 22 is always the mine column adjacent to the shaft;
        // in the cleared entrance zone it is TILE.EMPTY, deeper it is whatever
        // the player has already dug open. If for any reason it is impassable
        // (e.g. hazard tiles), stay in the elevator and warn.
        const exitX = ELEVATOR_X - 1;
        if (!this.world.isPassable(exitX, p.y)) {
          p.setMessage('🛗 Cannot exit here — the adjacent tile is blocked.');
          return;
        }
        p.inElevator = false;
        p.x = exitX;
        this._afterMove(p.x, p.y);
      } else {
        // Move up or down to the next elevator door
        const nextY = this._nextElevEntry(p.y, dy);
        if (nextY === PLAYER_START_Y) {
          // Reached the surface
          p.inElevator = false;
          p.x = ELEVATOR_X;
          p.y = PLAYER_START_Y;
          p.setMessage('🛗 Elevator: back at the surface.');
        } else if (nextY !== null) {
          p.y = nextY;
          p.setMessage(`🛗 Elevator: ${nextY - 2} m deep.`);
        }
      }
      return;
    }

    // World boundary (left / right / top of pavement)
    if (nx < 0) {
      // Walking off the left edge
      this._warnDragons();
      return;
    }
    if (nx >= this.world.width) {
      // Walking off the right edge
      this._warnDragons();
      return;
    }
    if (ny < 2) {
      // Walking into the building row — treat as interact if player is on pavement
      if (p.y === 2) this._handleInteract();
      return;
    }

    // ── Max mine depth ────────────────────────────────────────────────────
    // depth in metres = ny - 2; block movement beyond MAX_MINE_DEPTH
    if (ny - 2 > MAX_MINE_DEPTH) {
      this._warnDragons();
      return;
    }

    // Pavement (y=2) ↔ mine (y=3) boundary: only crossable at mine-entrance columns
    if ((p.y === 2 && ny === 3) || (p.y === 3 && ny === 2)) {
      if (nx < MINE_ENT_X_MIN || nx > MINE_ENT_X_MAX) return;
    }

    const targetTile = this.world.getTile(nx, ny);

    // ── 1. Dirt dig-in ────────────────────────────────────────────────────
    if (targetTile === TILE.DIRT) {
      const content = this.world.digInto(nx, ny);
      this._onContentRevealed(content, nx, ny);

      const newTile = this.world.getTile(nx, ny);

      // Stone revealed by digging: do NOT move (need pick on next move)
      if (newTile === TILE.STONE) { sounds.playTinkStone(); return; }

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
          p.setMessage('⛏ Stone broken! Pick broke — buy a new one.');
          sounds.playToolBreak();
        } else {
          p.setMessage(`⛏ Stone broken! (${p.pickUses} use${p.pickUses !== 1 ? 's' : ''} left)`);
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

    // ── 5. Elevator door – prompt to ride ────────────────────────────────
    if (targetTile === TILE.ELEV_ENT) {
      p.setMessage(`🛗 Elevator door. Press E to pay $${ELEVATOR_RIDE_COST} and ride.`);
      return;
    }

    // ── 6. Normal passable tile ───────────────────────────────────────────
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
   * - Spread water + rubber boot: player walks through freely, no damage.
   * - Spread water + bucket: clears tile to EMPTY, free passage, uses 1 bucket charge.
   * - Spread water (no boot/bucket): player moves onto it, tile stays, deals 1 heart.
   */
  _enterWater(p, nx, ny) {
    const isSource = this.world.isSpringSource(nx, ny);

    if (isSource) {
      // Spring source: always impassable; re-spread and deal damage
      this.world.spreadHazard(nx, ny, TILE.WATER);
      this._applyHazardDamage('water_source');
    } else if (p.specialItems.has('rubber_boot')) {
      // Rubber boots: walk through spread water freely, no damage
      p.x = nx; p.y = ny;
      p.setMessage('🥾 Rubber boots keep your feet dry!');
      this._afterMove(nx, ny);
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
      // Spread water, no boot/bucket: player moves onto it, tile stays, deal damage
      p.x = nx; p.y = ny;
      const died = this._applyHazardDamage('water');
      if (!died) this._afterMove(nx, ny);
    }
  }

  /** Shared post-move logic: probe neighbours + pickup. */
  _afterMove(x, y) {
    // Only probe adjacent dirt tiles when the player is inside the mine (y≥3).
    // Pavement movement (y=2) must not reveal hidden content in the top mine row.
    if (y >= 3) {
      const revealed = this.world.probeAdjacent(x, y, this.player.toolReduction, this.player.hasLantern);
      for (const { x: rx, y: ry, content } of revealed) {
        this._onContentRevealed(content, rx, ry);
      }
    }
    this._checkPickup(x, y);
  }

  // -------------------------------------------------------------------------
  // Elevator helpers
  // -------------------------------------------------------------------------

  /**
   * Return the world-row y of the next elevator entry point when traveling in
   * direction dy (−1 = up, +1 = down) from the given row.
   *
   * Entry rows obey: (y − 2) % 5 === 0  (y = 7, 12, 17 … inside the shaft).
   * y = PLAYER_START_Y (2) is returned when going up past the first door
   * to signal a surface exit.  null is returned when there is nowhere to go
   * (already at surface going up, or beyond depth limit going down).
   */
  _nextElevEntry(currentY, dy) {
    if (dy < 0) {
      // Going up – find the previous entry row.
      // Entry rows satisfy (y − 2) % 5 === 0, i.e. y = 2 + 5k (k = 0,1,2,…).
      // The largest entry row strictly below currentY is:
      //   floor((currentY − 3) / 5) * 5 + 2
      // (subtract 3 so that currentY itself — which may be an entry row — is excluded).
      const prev = Math.floor((currentY - 3) / 5) * 5 + 2;
      if (prev >= 7) return prev;          // another underground door above
      if (currentY >= 7) return PLAYER_START_Y;  // surface exit
      return null;                          // already at surface
    } else {
      // Going down – find the next entry row.
      // The smallest entry row strictly above currentY is:
      //   floor((currentY − 2) / 5 + 1) * 5 + 2
      // (add 1 before flooring so currentY itself is excluded).
      const next = Math.floor((currentY - 2) / 5 + 1) * 5 + 2;
      if (next - 2 > MAX_MINE_DEPTH) return null;
      // Ensure the target row (and a lookahead buffer) has been generated
      this.world.ensureGenerated(next + GEN_LOOKAHEAD);
      return this.world.getTile(ELEVATOR_X, next) === TILE.ELEV_ENT ? next : null;
    }
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
      Storage.clear();
      this.state = 'dead';
      this.ui.showDead(this._elapsedTimeLabel(), p.familyMode ? this._collectFamilyStats() : null);
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

  /** Use a First Aid Kit to restore health to full. */
  _useFirstAidKit() {
    const p = this.player;
    if (p.firstAidKits <= 0) {
      p.setMessage('No First Aid Kits — buy one at the Shop.');
      return;
    }
    if (p.hearts >= p.maxHearts) {
      p.setMessage('❤️ Already at full health!');
      return;
    }
    p.firstAidKits--;
    p.hearts = p.maxHearts;
    p.setMessage(`🩹 First Aid Kit used! Restored to full health. (${p.firstAidKits} left)`);
    sounds.playTransaction();
    this.ui.updateHUD(p);
  }

  /** Use the radio to teleport to the mine entrance. */
  _useRadio() {
    const p = this.player;
    if (!p.hasRadio) {
      p.setMessage('📻 Find a radio in the mine first!');
      return;
    }
    p.x = MINE_ENT_X_MIN;
    p.y = 2;
    p.setMessage('📻 Radio crackles — you\'re teleported to the mine entrance!');
    sounds.playItemPickup();
    this.ui.updateHUD(p);
  }

  /**
   * Place a stick of dynamite in the tile adjacent to the player in direction (dx, dy).
   * The player stays put; a TILE.DYNAMITE tile is created and the fuse starts.
   */
  _placeDynamite(dx, dy) {
    const p  = this.player;
    const tx = p.x + dx;
    const ty = p.y + dy;

    // Can place on empty mine tiles (y≥3) or on open surface tiles (pavement/sky at y<3)
    const tile = this.world.getTile(tx, ty);
    const isValidMine    = ty >= 3 && tile === TILE.EMPTY;
    const isValidSurface = ty < 3  && (tile === TILE.PAVEMENT || tile === TILE.SKY);
    if (!isValidMine && !isValidSurface) {
      p.setMessage('💣 Can only place dynamite on empty mine tiles or open surface tiles.');
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
   * DIRT tiles in the blast radius have their hidden content revealed (not destroyed).
   * Ore, stone and hazard tiles are left untouched — dynamite only reveals, not destroys.
   * Damages the player based on distance (2 hearts within 2 tiles, 1 heart within full radius).
   */
  _explodeDynamite(dyn) {
    const { x: bx, y: by } = dyn;
    sounds.playDynamiteExplode();

    // Always clear the dynamite's own tile first (the blast loop skips surface
    // tiles, so this ensures the tile is cleaned up even for surface explosions).
    this.world.setTile(bx, by, TILE.EMPTY);
    this.world.setData(bx, by, null);

    // ── Police arrest: dynamite was placed and exploded on the surface ───────
    if (by < 3) {
      Storage.clear();
      this.state = 'dead';
      const stats = this.player.familyMode ? this._collectFamilyStats() : null;
      this.ui.showPoliceArrest(this._elapsedTimeLabel(), stats);
      return;
    }

    // ── Mine collapse: blast radius geometrically reaches the surface ────────
    // The topmost row the blast can reach is (by - DYNAMITE_RADIUS).
    // If that row is above the mine boundary (y<3), the surface is affected.
    const blastTouchesSurface = (by - DYNAMITE_RADIUS) < 3;

    // Reveal / clear tiles in blast radius (mine rows only)
    for (let dx = -DYNAMITE_RADIUS; dx <= DYNAMITE_RADIUS; dx++) {
      for (let dy = -DYNAMITE_RADIUS; dy <= DYNAMITE_RADIUS; dy++) {
        if (dx * dx + dy * dy > DYNAMITE_RADIUS * DYNAMITE_RADIUS) continue;
        const tx = bx + dx;
        const ty = by + dy;
        if (ty < 3) continue;  // Don't blast the surface
        const t = this.world.getTile(tx, ty);
        if (t === TILE.DIRT) {
          // Reveal the hidden content rather than destroying it
          const content = this.world.digInto(tx, ty);
          this._onContentRevealed(content, tx, ty);
          // Remove any chained dynamite entries that got blasted
          this._dynamites = this._dynamites.filter(d => d.x !== tx || d.y !== ty);
        } else if (t === TILE.DYNAMITE) {
          // Chain-detonate other dynamite tiles
          this.world.setTile(tx, ty, TILE.EMPTY);
          this.world.setData(tx, ty, null);
          this._dynamites = this._dynamites.filter(d => d.x !== tx || d.y !== ty);
        }
        // Ore, stone, water and lava tiles are left intact — dynamite just reveals
      }
    }

    // ── Mine collapse game over: blast reached the surface ──────────────────
    if (blastTouchesSurface) {
      Storage.clear();
      this.state = 'dead';
      const stats = this.player.familyMode ? this._collectFamilyStats() : null;
      this.ui.showMineCollapse(this._elapsedTimeLabel(), stats);
      return;
    }

    // Damage player based on distance from blast centre (squared to avoid sqrt)
    const p       = this.player;
    const distSq  = (p.x - bx) ** 2 + (p.y - by) ** 2;
    if (distSq <= DYNAMITE_CRITICAL_RADIUS * DYNAMITE_CRITICAL_RADIUS) {
      const died = p.takeDamageMultiple(2);
      sounds.playHazardHit();
      if (died) {
        Storage.clear();
        this.state = 'dead';
        this.ui.showDead(this._elapsedTimeLabel(), p.familyMode ? this._collectFamilyStats() : null);
        return;
      }
      p.setMessage(`💥 Too close to the blast! 2 damage (${p.hearts}/${p.maxHearts} ♥)`);
    } else if (distSq <= DYNAMITE_RADIUS * DYNAMITE_RADIUS) {
      const died = p.takeDamage();
      sounds.playHazardHit();
      if (died) {
        Storage.clear();
        this.state = 'dead';
        this.ui.showDead(this._elapsedTimeLabel(), p.familyMode ? this._collectFamilyStats() : null);
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

  /**
   * Show a full-screen overlay when a non-ore item is picked up from the mine.
   * Pauses the game until the player dismisses it.
   */
  _showItemPickupOverlay(emoji, message) {
    this.input.clear();
    this.state = 'overlay';
    this.ui.showItemPickup(emoji, message, () => {
      this.state = 'playing';
      this.input.clear();
    });
  }

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
          sounds.playItemPickup();
          this._showItemPickupOverlay('🥾', 'Rubber boots! Walk through water without taking damage.');
        }
        break;
      }

      case TILE.POCKET_WATCH: {
        if (!p.specialItems.has('pocket_watch')) {
          p.specialItems.add('pocket_watch');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('⌚', 'A pocket watch! Still ticking after all these years.');
        }
        break;
      }

      case TILE.GLASSES: {
        if (!p.specialItems.has('glasses')) {
          p.specialItems.add('glasses');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🕶️', 'A pair of glasses? What else lies beneath the loo?');
        }
        break;
      }

      // ── Lantern – enables adjacent dirt probing ────────────────────────
      case TILE.LANTERN: {
        if (!p.hasLantern) {
          p.hasLantern = true;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🔦', 'Lantern found! Move back and forth next to dirt to reveal what\'s inside.');
        }
        break;
      }

      // ── Radio – teleports to mine entrance ────────────────────────────
      case TILE.RADIO: {
        if (!p.hasRadio) {
          p.hasRadio = true;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('📻', 'Old radio found! Use the 📻 button to call for a ride to the mine entrance.');
        }
        break;
      }

      // ── Novelty collectibles ───────────────────────────────────────────
      case TILE.SKULL: {
        if (!p.specialItems.has('skull')) {
          p.specialItems.add('skull');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('💀', 'A skull. Someone didn\'t make it back.');
        }
        break;
      }

      case TILE.CANTEEN: {
        if (!p.specialItems.has('canteen')) {
          p.specialItems.add('canteen');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🧴', 'A dusty canteen. Still has a drop of water in it.');
        }
        break;
      }

      case TILE.LUNCHBOX: {
        if (!p.specialItems.has('lunchbox')) {
          p.specialItems.add('lunchbox');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🍱', 'A lunch box. The sandwich inside is ancient but tempting.');
        }
        break;
      }

      case TILE.TIN_CAN: {
        if (!p.specialItems.has('tin_can')) {
          p.specialItems.add('tin_can');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🥫', 'A dented tin can. "Best before 1987."');
        }
        break;
      }

      case TILE.NECKLACE: {
        p.necklaceCount++;
        this.world.setTile(x, y, TILE.EMPTY);
        sounds.playItemPickup();
        this._showItemPickupOverlay('📿', `You found a necklace! Your wife will love it! (You have ${p.necklaceCount})`);
        break;
      }

      // ── Ring – the proposal item ───────────────────────────────────────
      case TILE.RING: {
        if (!p.hasRing) {
          p.hasRing = true;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('💍', 'You found a ring! Bring it to the bar…');
        }
        break;
      }

      // ── Tool items ─────────────────────────────────────────────────────
      case TILE.SHOVEL: {
        if (!p.hasShovel) {
          p.hasShovel = true;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🪏', 'Found a Shovel! Digging dirt is easier now.');
        }
        break;
      }

      case TILE.PICK: {
        if (!p.hasPick) {
          p.hasPick  = true;
          p.pickUses = TOOL_USES;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('⛏', `Found a Pick! Walk into stone to break it. (${TOOL_USES} uses)`);
        }
        break;
      }

      case TILE.BAG: {
        if (!p.hasBag) {
          p.hasBag  = true;
          p.maxGems = 20;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🎒', 'Found a Large Bag! Carry capacity doubled.');
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

    // ── Exit elevator on interact ─────────────────────────────────────────
    if (p.inElevator) {
      const exitX = ELEVATOR_X - 1;
      if (!this.world.isPassable(exitX, p.y)) {
        p.setMessage('🛗 Cannot exit here — the adjacent tile is blocked.');
        return;
      }
      p.inElevator = false;
      p.x = exitX;
      this._afterMove(p.x, p.y);
      return;
    }

    const checkTile = (type) =>
      this.world.getTile(p.x, p.y)     === type ||
      this.world.getTile(p.x, p.y - 1) === type;

    // ── Flower pickup (to the left of the outhouse at y=1) ────────────────
    if (checkTile(TILE.FLOWER)) {
      if (!p.hasFlower) {
        p.hasFlower = true;
        // Remove the flower tile from the building-facade row
        this.world.setTile(p.x, 1, TILE.SKY);
        p.setMessage('🌸 You found a flower.');
        sounds.playItemPickup();
        this.ui.updateHUD(p);
      } else {
        p.setMessage('🌸 (You already have the flower.)');
      }
      return;
    }

    if (checkTile(TILE.OUTHOUSE)) {
      this.state = 'overlay';
      this.ui.openOuthouse({
        familyUnlocked: Storage.getFamilyModeUnlocked(),
        onClose:      () => { this.state = 'playing'; this.input.clear(); },
        onEarthquake: () => this._doEarthquake(),
        onJumpFamily: () => {
          Storage.setStartInFamilyMode();
          Storage.clear();
          location.reload();
        },
      });
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

    if (checkTile(TILE.BAR) || checkTile(TILE.HOUSE)) {
      // In family mode the house stands where the bar was – ignore re-entry to the bar
      if (checkTile(TILE.HOUSE)) {
        // Auto-deliver any necklaces in the player's pocket
        while (p.necklaceCount > 0 && p.babyCount < MAX_BABIES) {
          p.necklaceCount--;
          p.babyCount++;
          p.setMessage(`👶 Baby #${p.babyCount} welcomed to the family!`);
          sounds.playTransaction();
        }
        this.state = 'overlay';
        this.ui.openHouse(p, () => {
          this.state = 'playing';
          this.input.clear();
          this.ui.updateHUD(p);
        });
        return;
      }
      this.state = 'overlay';
      this.ui.openBar(p, (won) => {
        if (won) {
          this.state = 'won';
          this.ui.showWin(this._elapsedTimeLabel(), () => {
            // "Enter Family Mode" chosen
            this._activateFamilyMode();
          });
        } else {
          this.state = 'playing';
          this.input.clear();
        }
        this.ui.updateHUD(p);
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

    if (checkTile(TILE.WORKER)) {
      this.state = 'overlay';
      this.ui.openWorker(p, {
        onClose: () => { this.state = 'playing'; this.input.clear(); this.ui.updateHUD(p); },
        onBuildElevator: () => {
          p.money -= ELEVATOR_COST;
          p.hasElevator = true;
          this.world.buildElevator();
          p.setMessage('🏗️ Elevator shaft built! Enter the right mine-entrance column to ride ($5/trip).');
          this.ui.updateHUD(p);
          Storage.save(p, this.world, this);
        },
        onExpandHouse: (level) => {
          this._applyHouseExpansionTiles(level);
          this.ui.updateHUD(p);
          Storage.save(p, this.world, this);
        },
      });
      return;
    }

    if (checkTile(TILE.MINE_ENT)) {
      if (p.hasElevator && p.y === PLAYER_START_Y && p.x === ELEVATOR_X) {
        // Surface elevator entrance – enter the elevator cabin
        if (p.money < ELEVATOR_RIDE_COST) {
          p.setMessage(`🛗 Elevator needs $${ELEVATOR_RIDE_COST} to ride. (You have $${p.money})`);
        } else {
          p.money -= ELEVATOR_RIDE_COST;
          p.inElevator = true;
          p.x = ELEVATOR_X;
          // p.y stays at PLAYER_START_Y (surface level of the cabin)
          p.setMessage(`🛗 In the elevator. ↑↓ to move between floors, ← or E to exit. ($${ELEVATOR_RIDE_COST} charged)`);
        }
        this.ui.updateHUD(p);
      } else {
        p.setMessage('⛏ Walk down (↓ / S) to enter the mine.');
      }
      return;
    }

    // ── Underground elevator door (player is directly left of an ELEV_ENT) ─
    if (p.hasElevator && p.x === ELEVATOR_X - 1 &&
        this.world.getTile(ELEVATOR_X, p.y) === TILE.ELEV_ENT) {
      if (p.money < ELEVATOR_RIDE_COST) {
        p.setMessage(`🛗 Elevator needs $${ELEVATOR_RIDE_COST} to ride. (You have $${p.money})`);
      } else {
        p.money -= ELEVATOR_RIDE_COST;
        p.inElevator = true;
        p.x = ELEVATOR_X;
        p.setMessage(`🛗 In the elevator at ${p.y - 2} m. ↑↓ to move between floors, ← or E to exit. ($${ELEVATOR_RIDE_COST} charged)`);
      }
      this.ui.updateHUD(p);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Family Mode
  // -------------------------------------------------------------------------

  /** Activate family mode: replace the bar with a house, init timers.
   *  skipPayment – pass true when jumping straight to family mode from outhouse. */
  _activateFamilyMode(skipPayment = false) {
    const p = this.player;
    p.familyMode    = true;
    p.bankBalance   = 0;
    p.babyCount     = 0;
    p.houseLevel    = 1;
    p.suppliesMeter = 100;

    // Deduct marriage payment (skipped when jumping from the outhouse shortcut)
    if (!skipPayment) {
      p.money -= JEWELER_MONEY_COST;
    }

    // Replace bar with house tile and apply any expansion tiles for this level
    this.world.setTile(BAR_X, 1, TILE.HOUSE);
    this._applyHouseExpansionTiles(p.houseLevel);

    // Ensure Contractor Mike is present for house upgrades
    this.world.setTile(WORKER_X, 1, TILE.WORKER);

    // Initialise wall-clock timers
    const now = Date.now();
    this._lastTaxTime          = now;
    this._taxGraceStart        = 0;
    this._taxInGrace           = false;
    this._lastSuppliesTickTime = now;
    this._suppliesGraceStart   = 0;
    this._suppliesInGrace      = false;

    // Mark that family mode has been reached (persists across resets)
    Storage.setFamilyModeUnlocked();

    // Place necklaces in the mine for baby deliveries
    this.world.addFamilyJewelry();

    // Place player on pavement near the house
    p.x = BAR_X + 1;
    p.y = PLAYER_START_Y;

    this.state = 'playing';
    this.input.clear();
    p.setMessage('👨‍👩‍👧‍👦 Family Mode! Visit your new home and the bank to get started.');
    this.ui.updateHUD(p);
    Storage.save(p, this.world, this);
  }

  /** Set world tiles for all house levels up to and including `level`.
   *  Level 1 = main facade only (already placed by _activateFamilyMode).
   *  Level 2 = side-wall extensions left and right.
   *  Level 3 = top-floor tile above the main facade.
   *  Level 4 = top-floor tiles above the two side walls. */
  _applyHouseExpansionTiles(level) {
    if (level >= 2) {
      this.world.setTile(BAR_X - 1, 1, TILE.HOUSE);
      this.world.setTile(BAR_X + 1, 1, TILE.HOUSE);
    }
    if (level >= 3) {
      this.world.setTile(BAR_X, 0, TILE.HOUSE);
    }
    if (level >= 4) {
      this.world.setTile(BAR_X - 1, 0, TILE.HOUSE);
      this.world.setTile(BAR_X + 1, 0, TILE.HOUSE);
    }
  }

  /** Compute the current tax bill based on house level. */
  _calcTaxAmount() {
    const p = this.player;
    return FAMILY_BASE_TAX
      + (p.houseLevel - 1) * FAMILY_TAX_PER_LEVEL;
  }

  /** Called each frame while in family mode to check tax + supplies deadlines. */
  _tickFamilyMode() {
    const now = Date.now();

    // ── Tax collection ────────────────────────────────────────────────────
    if (this._lastTaxTime > 0 && now - this._lastTaxTime >= FAMILY_TAX_INTERVAL_MS) {
      this._collectTaxes(now);
      if (this.state !== 'playing') return;
    } else if (this._taxInGrace && now - this._taxGraceStart >= FAMILY_TAX_GRACE_MS) {
      this._familyGameOver('eviction');
      return;
    }

    // ── Supplies depletion ────────────────────────────────────────────────
    if (this._lastSuppliesTickTime > 0) {
      const elapsed = now - this._lastSuppliesTickTime;
      const ticks   = Math.floor(elapsed / FAMILY_SUPPLIES_TICK_MS);
      if (ticks > 0) {
        const p        = this.player;
        const ratePerTick = 1 + p.babyCount * FAMILY_SUPPLIES_PER_BABY;
        p.suppliesMeter   = Math.max(0, p.suppliesMeter - ratePerTick * ticks);
        this._lastSuppliesTickTime += ticks * FAMILY_SUPPLIES_TICK_MS;

        if (p.suppliesMeter <= 0 && !this._suppliesInGrace) {
          this._suppliesInGrace    = true;
          this._suppliesGraceStart = now;
          const runOut = p.babyCount > 0 ? 'food and diapers' : 'food';
          p.setMessage(`⚠️ You are out of ${runOut}! Visit your home — 10 minutes before divorce!`);
        }
      }
    }

    if (this._suppliesInGrace) {
      const p = this.player;
      if (p.suppliesMeter > 0) {
        // Supplies refilled; clear grace
        this._suppliesInGrace  = false;
        this._suppliesGraceStart = 0;
      } else if (Date.now() - this._suppliesGraceStart >= FAMILY_SUPPLIES_GRACE_MS) {
        this._familyGameOver('divorce');
        return;
      }
    }
  }

  /** Try to collect taxes from the bank account. */
  _collectTaxes(now) {
    const p      = this.player;
    const amount = this._calcTaxAmount();

    if (p.bankBalance >= amount) {
      p.bankBalance -= amount;
      this._lastTaxTime = now;
      this._taxInGrace  = false;
      this._taxGraceStart = 0;
      p.setMessage(`🏠 Taxes paid: $${amount}. Bank balance: $${p.bankBalance}`);
    } else {
      const interest = Math.ceil(amount * FAMILY_TAX_INTEREST);
      const total    = amount + interest;
      if (!this._taxInGrace) {
        this._taxInGrace    = true;
        this._taxGraceStart = now;
        this._lastTaxTime   = now;   // Reset so it doesn't re-fire immediately
        p.setMessage(`⚠️ Tax bill of $${total} (incl. ${Math.round(FAMILY_TAX_INTEREST * 100)}% interest) due! Deposit funds at the Bank within 10 minutes!`);
      }
    }
  }

  /** Build a stats snapshot for the family-mode game-over screens. */
  _collectFamilyStats() {
    const p       = this.player;
    const gemTotal = p.gems.reduce((s, g) => s + (GEM_VALUE[g] || 0), 0);
    const items   = [];
    if (p.hasShovel)       items.push('🪏 Shovel');
    if (p.hasPick)         items.push(`⛏ Pick (×${p.pickUses})`);
    if (p.hasBucket)       items.push(`🪣 Bucket (×${p.bucketUses})`);
    if (p.hasExtinguisher) items.push(`🧯 Extinguisher (×${p.extinguisherUses})`);
    if (p.hasBag)          items.push('🎒 Large Bag');
    if (p.hasRing)         items.push('💍 Ring');
    if (p.hasLantern)      items.push('🔦 Lantern');
    if (p.hasRadio)        items.push('📻 Radio');
    if (p.dynamiteCount)   items.push(`💣 Dynamite ×${p.dynamiteCount}`);
    if (p.firstAidKits)    items.push(`🩹 First Aid ×${p.firstAidKits}`);
    for (const si of p.specialItems) {
      const icons = { rubber_boot: '🥾', pocket_watch: '⌚', glasses: '🕶️', skull: '💀', canteen: '🧴', lunchbox: '🍱', tin_can: '🥫' };
      if (icons[si]) items.push(icons[si]);
    }
    return {
      cash:        p.money,
      bankBalance: p.bankBalance,
      gemCarried:  p.gemCount,
      gemValue:    gemTotal,
      netWorth:    p.money + p.bankBalance + gemTotal,
      houseLevel:  p.houseLevel,
      babyCount:   p.babyCount,
      items,
      elapsedTime: this._elapsedTimeLabel(),
    };
  }

  /** Trigger a family-mode game over. */
  _familyGameOver(reason) {
    Storage.clear();
    this.state       = 'dead';
    const stats      = this._collectFamilyStats();
    if (reason === 'eviction') {
      this.ui.showEviction(stats);
    } else {
      this.ui.showDivorce(stats);
    }
  }

  // -------------------------------------------------------------------------
  // Earthquake
  // -------------------------------------------------------------------------

  /** Refill the mine with fresh dirt and minerals (triggered via the outhouse). */
  _doEarthquake() {
    const p = this.player;

    // Regenerate the mine, excluding items the player already has
    this.world.regenerateMine(p);

    // Clear any live dynamites (they're in the old mine)
    this._dynamites = [];

    // If the player is underground, surface them
    if (p.y >= 3) {
      p.x = PLAYER_START_X;
      p.y = PLAYER_START_Y;
    }

    p.setMessage('🌋 EARTHQUAKE! The mine has been refilled with fresh dirt and minerals!');
    this.state = 'playing';
    this.input.clear();
    this.ui.updateHUD(p);
    Storage.save(p, this.world, this);
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
