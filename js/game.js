'use strict';

const FLOOD_FLUSH_ITEM_CHANCE = 0.12;
const FLOOD_FLUSH_ITEM_LABELS = Object.freeze({
  shovel: 'shovel',
  pick: 'pick',
  bucket: 'bucket',
  extinguisher: 'extinguisher',
  bag: 'large bag',
  dynamite: 'dynamite',
  firstAid: 'first aid kit',
  drill: 'drill charge',
});

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
 *   LAVA   → walking into lava costs 1 heart and player moves onto it.  Source lava
 *             re-spreads when entered.  With fire extinguisher: lava → STONE (no
 *             damage, player stays put, extinguisher loses 1 use).
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
      // Migrate old saves: if the elevator was already built but the surface
      // entrance tile (x=23, y=2) is still MINE_ENT, rebuild to place ELEV_ENT there.
      if (this.player.hasElevator &&
          this.world.getTile(ELEVATOR_X, PLAYER_START_Y) !== TILE.ELEV_ENT) {
        this.world.buildElevator();
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
      case 'drill':    this._useDrill();       break;
      case 'firstaid': this._useFirstAidKit(); break;
      case 'minecart': this._useMineCart();    break;
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
   * If the player has collected all four knight items, show the dragon-slaying
   * victory message instead of the normal warning.
   */
  _warnDragons() {
    this.input.clear();
    const p = this.player;

    // Check if player has all knight items
    const hasAllKnightItems = KNIGHT_ITEMS.every(item => p.specialItems.has(item));

    if (hasAllKnightItems) {
      // Dragon slayed: set flag, fix supplies
      if (!p.slayedDragon) {
        p.slayedDragon = true;
        if (p.familyMode) p.suppliesMeter = 100;
      }
      this.state = 'overlay';
      this.ui.openDragons(true, () => { this.state = 'playing'; this.input.clear(); });
      return;
    }

    this._dragonWarnings++;
    if (this._dragonWarnings >= 10) {
      Storage.clear();
      this.state = 'dead';
      const stats = p.familyMode ? this._collectFamilyStats() : null;
      this.ui.showWarned(this._elapsedTimeLabel(), stats);
    } else {
      this.state = 'overlay';
      this.ui.openDragons(false, () => { this.state = 'playing'; this.input.clear(); });
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
      if (dx < 0) {
        this._tryExitElevator();
      } else if (dy !== 0) {
        // Move up or down to the next elevator door
        const nextY = this._nextElevEntry(p.y, dy);
        if (nextY === PLAYER_START_Y) {
          // Reached the surface – stay in the cabin; player exits manually (← or E)
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
    // depth in metres = ny - 2; block movement beyond the player's unlocked depth
    if (ny - 2 > p.unlockedDepth) {
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
      if (newTile === TILE.GAS)   { this._enterGas(p, nx, ny); return; }

      if (this.world.isPassable(nx, ny)) {
        p.x = nx; p.y = ny;
        this._afterMove(nx, ny);
      }
      return;
    }

    // ── 2. Stone: needs pick ──────────────────────────────────────────────
    if (targetTile === TILE.STONE) {
      if (p.hasPick) {
        const stoneData = this.world.getData(nx, ny);
        if (stoneData && stoneData.innerGem) {
          const gemTile = GEM_HIDDEN_TO_TILE[stoneData.innerGem];
          this.world.setTile(nx, ny, gemTile !== undefined ? gemTile : TILE.EMPTY);
          this.world.setData(nx, ny, null);
        } else {
          this.world.setTile(nx, ny, TILE.EMPTY);
        }
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

    // ── 4b. Gas: player moves onto it, tile stays, deals 1 heart ─────────
    if (targetTile === TILE.GAS) {
      this._enterGas(p, nx, ny);
      return;
    }

    // ── 5. Elevator door – right-approach opens ride prompt ──────────────
    if (targetTile === TILE.ELEV_ENT) {
      // Only the rightward approach (dx=1) is the entry gesture; other directions
      // just treat the door as an impassable wall (silent).
      if (dx === 1) this._showElevatorRidePrompt(ny);
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
   * - Lava source (no extinguisher): re-spreads, player moves onto it, deals 1 heart.
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
      // Lava source: re-spread, then move onto it and deal damage
      this.world.spreadHazard(nx, ny, TILE.LAVA);
      p.x = nx; p.y = ny;
      const died = this._applyHazardDamage('lava_source');
      if (!died) this._afterMove(nx, ny);
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
   * - Spread water + rubber boot (no bucket): player walks through freely, no damage.
   * - Spread water (no boot/bucket): player moves onto it, tile stays, deals 1 heart.
   */
  _enterWater(p, nx, ny) {
    const isSource = this.world.isSpringSource(nx, ny);

    if (isSource) {
      // Spring source: always impassable; re-spread and deal damage
      this.world.spreadHazard(nx, ny, TILE.WATER);
      const flushedLabel = this._tryFlushInventoryItemFromFlood(nx, ny);
      const died = this._applyHazardDamage('water_source');
      if (flushedLabel && !died) {
        const base = p.message ? `${p.message} ` : '';
        p.setMessage(`${base}🌊 The flood flushed away your ${flushedLabel}! It may be under the water.`);
      }
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
      const recovered = this._recoverFlushedItemAt(nx, ny);
      if (recovered) {
        const base = p.message ? `${p.message} ` : '';
        p.setMessage(`${base}🧺 You recovered your ${recovered.label} from the floodwater.`);
        sounds.playItemPickup();
      }
      this._afterMove(nx, ny);
    } else if (p.specialItems.has('rubber_boot')) {
      // Rubber boots: walk through spread water freely, no damage
      p.x = nx; p.y = ny;
      p.setMessage('🥾 Rubber boots keep your feet dry!');
      this._afterMove(nx, ny);
    } else {
      // Spread water, no boot/bucket: player moves onto it, tile stays, deal damage
      p.x = nx; p.y = ny;
      const died = this._applyHazardDamage('water');
      if (!died) this._afterMove(nx, ny);
    }
  }

  _tryFlushInventoryItemFromFlood(sx, sy) {
    if (Math.random() >= FLOOD_FLUSH_ITEM_CHANCE) return null;

    const p = this.player;
    const options = [];
    if (p.hasShovel)                     options.push({ id: 'shovel',       label: FLOOD_FLUSH_ITEM_LABELS.shovel });
    if (p.hasPick)                       options.push({ id: 'pick',         label: FLOOD_FLUSH_ITEM_LABELS.pick });
    if (p.hasBucket)                     options.push({ id: 'bucket',       label: FLOOD_FLUSH_ITEM_LABELS.bucket });
    if (p.hasExtinguisher)               options.push({ id: 'extinguisher', label: FLOOD_FLUSH_ITEM_LABELS.extinguisher });
    if (p.hasBag)                        options.push({ id: 'bag',          label: FLOOD_FLUSH_ITEM_LABELS.bag });
    if (p.dynamiteCount > 0)             options.push({ id: 'dynamite',     label: FLOOD_FLUSH_ITEM_LABELS.dynamite });
    if (p.firstAidKits > 0)              options.push({ id: 'firstAid',     label: FLOOD_FLUSH_ITEM_LABELS.firstAid });
    if (p.drillCount > 0)                options.push({ id: 'drill',        label: FLOOD_FLUSH_ITEM_LABELS.drill });
    if (options.length === 0) return null;

    const stashPos = this._findFloodStashTile(sx, sy);
    if (!stashPos) return null;

    const chosen = options[Math.floor(Math.random() * options.length)];
    const payload = { type: chosen.id };

    switch (chosen.id) {
      case 'shovel':
        p.hasShovel = false;
        break;
      case 'pick':
        payload.uses = p.pickUses;
        p.hasPick = false;
        p.pickUses = 0;
        break;
      case 'bucket':
        payload.uses = p.bucketUses;
        p.hasBucket = false;
        p.bucketUses = 0;
        break;
      case 'extinguisher':
        payload.uses = p.extinguisherUses;
        p.hasExtinguisher = false;
        p.extinguisherUses = 0;
        break;
      case 'bag':
        p.hasBag = false;
        p.maxGems = 10;
        break;
      case 'dynamite':
        p.dynamiteCount--;
        break;
      case 'firstAid':
        p.firstAidKits--;
        break;
      case 'drill':
        p.drillCount--;
        break;
    }

    const current = this.world.getData(stashPos.x, stashPos.y) || {};
    current.flushedItem = payload;
    this.world.setData(stashPos.x, stashPos.y, current);
    return chosen.label;
  }

  _findFloodStashTile(sx, sy) {
    const queue = [{ x: sx, y: sy }];
    const seen = new Set([`${sx},${sy}`]);
    const candidates = [];
    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      for (const { dx, dy } of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.world.getTile(nx, ny) !== TILE.WATER) continue;
        queue.push({ x: nx, y: ny });
        if (this.world.isSpringSource(nx, ny)) continue;
        const d = this.world.getData(nx, ny);
        if (d && d.flushedItem) continue;
        candidates.push({ x: nx, y: ny });
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _recoverFlushedItemAt(x, y) {
    const d = this.world.getData(x, y);
    if (!d || !d.flushedItem) return null;
    const { flushedItem } = d;
    const p = this.player;
    switch (flushedItem.type) {
      case 'shovel':
        p.hasShovel = true;
        break;
      case 'pick':
        p.pickUses = Number.isFinite(flushedItem.uses) && flushedItem.uses > 0 ? flushedItem.uses : 1;
        p.hasPick = true;
        break;
      case 'bucket':
        p.bucketUses = Number.isFinite(flushedItem.uses) && flushedItem.uses > 0 ? flushedItem.uses : 1;
        p.hasBucket = true;
        break;
      case 'extinguisher':
        p.extinguisherUses = Number.isFinite(flushedItem.uses) && flushedItem.uses > 0 ? flushedItem.uses : 1;
        p.hasExtinguisher = true;
        break;
      case 'bag':
        p.hasBag = true;
        p.maxGems = 20;
        break;
      case 'dynamite':
        p.dynamiteCount++;
        break;
      case 'firstAid':
        p.firstAidKits++;
        break;
      case 'drill':
        p.drillCount++;
        break;
      default:
        return null;
    }

    const next = Object.assign({}, d);
    delete next.flushedItem;
    const hasOtherData = Object.keys(next).length > 0;
    this.world.setData(x, y, hasOtherData ? next : null);
    return { label: FLOOD_FLUSH_ITEM_LABELS[flushedItem.type] || flushedItem.type };
  }

  /**
   * Handle player entering a gas leak tile.
   *
   * Gas does not spread. The player moves onto it (tile remains) and takes 1 heart.
   */
  _enterGas(p, nx, ny) {
    p.x = nx; p.y = ny;
    const died = this._applyHazardDamage('gas');
    if (!died) this._afterMove(nx, ny);
  }

  /** Shared post-move logic: probe neighbours + pickup. */
  _afterMove(x, y) {
    // Only probe adjacent dirt tiles when the player is inside the mine (y≥3).
    // Pavement movement (y=2) must not reveal hidden content in the top mine row.
    if (y >= 3) {
      const revealed = this.world.probeAdjacent(x, y, this.player.toolReduction, this.player.hasLantern, this.player.hasDowsingRod, this.player.hasHeatVision);
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
   * Show the elevator ride prompt overlay.  Only shown when approaching an
   * ELEV_ENT tile by pressing right (dx=1).  If the player cannot afford the
   * ride a HUD message is shown instead; the game does not pause.
   * @param {number} targetY  - world-row of the elevator door being approached
   */
  _showElevatorRidePrompt(targetY) {
    const p = this.player;
    if (p.money < ELEVATOR_RIDE_COST) {
      p.setMessage(`🛗 Need $${ELEVATOR_RIDE_COST} to ride. (You have $${p.money})`);
      return;
    }
    this.input.clear();
    this.state = 'overlay';
    this.ui.showElevatorRidePrompt(ELEVATOR_RIDE_COST, () => {
      // Pay and board
      p.money -= ELEVATOR_RIDE_COST;
      p.inElevator = true;
      p.x = ELEVATOR_X;
      p.y = targetY;
      p.setMessage('🛗 In the elevator. ↑↓ to move between floors, ← to exit.');
      this.ui.updateHUD(p);
      this.state = 'playing';
      this.input.clear();
    }, () => {
      // Decline
      this.state = 'playing';
      this.input.clear();
    });
  }

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
      if (next - 2 > this.player.unlockedDepth) return null;
      // Ensure the target row (and a lookahead buffer) has been generated
      this.world.ensureGenerated(next + GEN_LOOKAHEAD);
      return this.world.getTile(ELEVATOR_X, next) === TILE.ELEV_ENT ? next : null;
    }
  }

  // -------------------------------------------------------------------------
  // Elevator exit helper
  // -------------------------------------------------------------------------

  /**
   * Attempt to exit the elevator cabin to the left.
   * - If the adjacent tile is passable: step out immediately.
   * - If it's DIRT: dig it (revealing any hidden content) then step out if passable.
   * - If it's STONE and the player has a pick: break it then step out.
   * - Otherwise: show a "blocked" message and stay in the cabin.
   */
  _tryExitElevator() {
    const p     = this.player;
    const exitX = ELEVATOR_X - 1;
    const tile  = this.world.getTile(exitX, p.y);

    if (tile === TILE.DIRT) {
      const content = this.world.digInto(exitX, p.y);
      this._onContentRevealed(content, exitX, p.y);
      const newTile = this.world.getTile(exitX, p.y);
      if (newTile === TILE.STONE) { sounds.playTinkStone(); return; }
      if (newTile === TILE.LAVA)  { p.inElevator = false; this._enterLava(p, exitX, p.y);  return; }
      if (newTile === TILE.WATER) { p.inElevator = false; this._enterWater(p, exitX, p.y); return; }
      if (newTile === TILE.GAS)   { p.inElevator = false; this._enterGas(p, exitX, p.y);   return; }
      if (this.world.isPassable(exitX, p.y)) {
        p.inElevator = false;
        p.x = exitX;
        this._afterMove(p.x, p.y);
      }
      return;
    }

    if (tile === TILE.STONE) {
      if (p.hasPick) {
        this.world.setTile(exitX, p.y, TILE.EMPTY);
        p.pickUses--;
        sounds.playCrumbleStone();
        if (p.pickUses <= 0) {
          p.hasPick  = false;
          p.pickUses = 0;
          p.setMessage('⛏ Stone broken! Pick broke — buy a new one.');
          sounds.playToolBreak();
        } else {
          p.setMessage(`⛏ Stone broken! (${p.pickUses} use${p.pickUses !== 1 ? 's' : ''} left)`);
        }
        p.inElevator = false;
        p.x = exitX;
        this._afterMove(p.x, p.y);
      } else {
        p.setMessage('🪨 You need a Pick to break stone.');
        sounds.playTinkStone();
      }
      return;
    }

    if (!this.world.isPassable(exitX, p.y)) {
      p.setMessage('🛗 Cannot exit here — the adjacent tile is blocked.');
      return;
    }

    p.inElevator = false;
    p.x = exitX;
    this._afterMove(p.x, p.y);
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
      this._triggerDeath();
    } else {
      const what = hazardType === 'lava'         ? '🔥 Lava burn'
                 : hazardType === 'lava_source'  ? '🔥 Burned by erupting lava'
                 : hazardType === 'water'        ? '💧 Waded through water'
                 : hazardType === 'water_source' ? '🌀 Spring source — can\'t pass'
                 : hazardType === 'gas'          ? '☣️ Gas leak!'
                 : '⚠️ Hazard hit';
      p.setMessage(`${what}! (${p.hearts}/${p.maxHearts} ♥ remaining)`);
    }
    return died;
  }

  /**
   * Central helper called whenever a 'hearts reached 0' death occurs.
   * If the player holds the genie lamp, the game-over screen includes a
   * "Genie, I wish to continue" button; otherwise the save is wiped immediately.
   */
  _triggerDeath() {
    const p = this.player;
    this.state = 'dead';
    const time  = this._elapsedTimeLabel();
    const stats = p.familyMode ? this._collectFamilyStats() : null;
    if (p.genieWishes > 0) {
      this.ui.showDead(time, stats, () => this._useGenieWish('death'));
    } else {
      Storage.clear();
      this.ui.showDead(time, stats);
    }
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
      p.setMessage('🧨 Move in any direction to place dynamite, or press 🧨 again to cancel.');
    } else {
      p.setMessage('No dynamite — buy some at the Shop.');
    }
  }

  /** Use a First Aid Kit to restore up to FIRST_AID_MAX_HEAL hearts. */
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
    const healed = Math.min(FIRST_AID_MAX_HEAL, p.maxHearts - p.hearts);
    p.hearts += healed;
    p.setMessage(`🩹 First Aid Kit used! Restored ${healed} heart${healed !== 1 ? 's' : ''}. (${p.firstAidKits} left)`);
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
   * Use the mine cart to instantly deposit all carried ore at bank value.
   * Requires a walkable path from the player's position to the mine exit
   * (water, lava, and the elevator shaft all block the cart).
   */
  _useMineCart() {
    const p = this.player;
    if (!p.hasMineCart) {
      p.setMessage('🚃 No mine cart — buy one from Contractor Mike.');
      return;
    }
    if (p.gemCount === 0) {
      p.setMessage('🚃 No ore to transport!');
      return;
    }
    if (!this._cartPathExists()) {
      p.setMessage('🚃 Cart blocked! No clear path to the mine exit — water or lava is in the way.');
      return;
    }
    if (p.money < MINE_CART_SEND_COST) {
      p.setMessage(`🚃 Need $${MINE_CART_SEND_COST} to send the cart. (You have $${p.money})`);
      return;
    }
    const total = p.gems.reduce((s, g) => s + (GEM_VALUE[g] || 0), 0);
    this.input.clear();
    this.state = 'overlay';
    this.ui.showMineCartSendPrompt(MINE_CART_SEND_COST, () => {
      p.money -= MINE_CART_SEND_COST;
      p.gems = [];
      p.bankBalance += total;
      p.setMessage(`🚃 Mine cart delivered! $${total} deposited to bank account. (-$${MINE_CART_SEND_COST} fee)`);
      sounds.playTransaction();
      this.ui.updateHUD(p);
      this.state = 'playing';
      this.input.clear();
    }, () => {
      this.state = 'playing';
      this.input.clear();
    });
  }

  /** Use a drill charge to clear a straight vertical 15 m path below the miner. */
  _useDrill() {
    const p = this.player;
    if (p.drillCount <= 0) {
      p.setMessage('🪛 No drill charges — buy one at the Shop.');
      return;
    }
    if (p.y < 3) {
      p.setMessage('🪛 The drill can only be used in the mine.');
      return;
    }

    const fromY = p.y + 1;
    const toY = p.y + DRILL_DEPTH;
    this.world.ensureGenerated(toY + GEN_LOOKAHEAD);

    for (let y = fromY; y <= toY; y++) {
      const t = this.world.getTile(p.x, y);
      if (t === TILE.DIRT) {
        const content = this.world.digInto(p.x, y);
        if (content === HIDDEN.STONE) {
          const stoneData = this.world.getData(p.x, y);
          if (stoneData && stoneData.innerGem) {
            const gemTile = GEM_HIDDEN_TO_TILE[stoneData.innerGem];
            this.world.setTile(p.x, y, gemTile !== undefined ? gemTile : TILE.EMPTY);
          } else {
            this.world.setTile(p.x, y, TILE.EMPTY);
          }
          this.world.setData(p.x, y, null);
        }
      } else if (t === TILE.STONE) {
        const stoneData = this.world.getData(p.x, y);
        if (stoneData && stoneData.innerGem) {
          const gemTile = GEM_HIDDEN_TO_TILE[stoneData.innerGem];
          this.world.setTile(p.x, y, gemTile !== undefined ? gemTile : TILE.EMPTY);
        } else {
          this.world.setTile(p.x, y, TILE.EMPTY);
        }
        this.world.setData(p.x, y, null);
      }
    }

    p.drillCount--;
    p.setMessage(`🪛 Drill used! Cleared ${DRILL_DEPTH} m straight down. (${p.drillCount} left)`);
    sounds.playTransaction();
    this.ui.updateHUD(p);
  }

  /**
   * BFS check: returns true if there is a walkable path from the player's
   * position to the mine exit (surface, y≤2) using only cart-passable tiles.
   *
   * The cart cannot travel through water, lava, dirt, stone, or the elevator
   * shaft.  The mine ↔ surface boundary may only be crossed at the mine
   * entrance columns (x ∈ [MINE_ENT_X_MIN, MINE_ENT_X_MAX]).
   */
  _cartPathExists() {
    const p = this.player;
    // Already on the surface — trivially reachable
    if (p.y <= 2) return true;

    const width   = this.world.width;
    const visited = new Set();
    const queue   = [[p.x, p.y]];
    visited.add(p.x + ',' + p.y);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift();

      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx;
        const ny = cy + dy;

        if (nx < 0 || nx >= width || ny < 2) continue;

        // Mine ↔ surface boundary: y=3 is the first mine row, y=2 is the
        // surface pavement row — only crossable at mine entrance columns.
        if (cy === 3 && ny === 2 && (nx < MINE_ENT_X_MIN || nx > MINE_ENT_X_MAX)) continue;

        const key = nx + ',' + ny;
        if (visited.has(key)) continue;

        if (!this.world.isPassable(nx, ny)) continue;

        // Reached the surface — path exists!
        if (ny <= 2) return true;

        visited.add(key);
        queue.push([nx, ny]);
      }
    }

    return false;
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
      p.setMessage('🧨 Can only place dynamite on empty mine tiles or open surface tiles.');
      p.placingDynamite = false;
      return;
    }

    this.world.setTile(tx, ty, TILE.DYNAMITE);
    this.world.setData(tx, ty, { frames: DYNAMITE_FUSE_FRAMES });
    this._dynamites.push({ x: tx, y: ty, frames: DYNAMITE_FUSE_FRAMES });
    p.dynamiteCount--;
    p.placingDynamite = false;
    p.setMessage('🧨 Dynamite placed! 5 seconds — RUN!');
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
   * STONE tiles are destroyed (EMPTY); if a gem was hidden inside, it is revealed.
   * Other ore and hazard tiles are left untouched.
   * Damages the player based on distance (2 hearts within 2 tiles, 1 heart within full radius).
   */
  _explodeDynamite(dyn) {
    const { x: bx, y: by } = dyn;
    const blastRadius = Math.random() < DYNAMITE_BIG_BLAST_CHANCE ? DYNAMITE_BIG_RADIUS : DYNAMITE_RADIUS;
    sounds.playDynamiteExplode();

    // Always clear the dynamite's own tile first (the blast loop skips surface
    // tiles, so this ensures the tile is cleaned up even for surface explosions).
    this.world.setTile(bx, by, TILE.EMPTY);
    this.world.setData(bx, by, null);

    // ── Police arrest: dynamite was placed and exploded on the surface ───────
    if (by < 3) {
      this.state = 'dead';
      const p = this.player;
      const stats = this.player.familyMode ? this._collectFamilyStats() : null;
      const time = this._elapsedTimeLabel();
      if (p.genieWishes > 0) {
        this.ui.showPoliceArrest(time, stats, () => this._useGenieWish('death'));
      } else {
        Storage.clear();
        this.ui.showPoliceArrest(time, stats);
      }
      return;
    }

    // ── Mine collapse: blast radius geometrically reaches the surface ────────
    // The topmost row the blast can reach is (by - blastRadius).
    // If that row is above the mine boundary (y<3), the surface is affected.
    const blastTouchesSurface = (by - blastRadius) < 3;

    // Reveal / clear tiles in blast radius (mine rows only)
    for (let dx = -blastRadius; dx <= blastRadius; dx++) {
      for (let dy = -blastRadius; dy <= blastRadius; dy++) {
        if (dx * dx + dy * dy > blastRadius * blastRadius) continue;
        const tx = bx + dx;
        const ty = by + dy;
        if (ty < 3) continue;  // Don't blast the surface
        const t = this.world.getTile(tx, ty);
        if (t === TILE.DIRT) {
          // Reveal the hidden content rather than destroying it
          const content = this.world.digInto(tx, ty);
          if (content === HIDDEN.STONE) {
            // Dynamite also destroys newly-revealed stone; preserve any inner gem
            const stoneData = this.world.getData(tx, ty);
            if (stoneData && stoneData.innerGem) {
              const gemTile = GEM_HIDDEN_TO_TILE[stoneData.innerGem];
              this.world.setTile(tx, ty, gemTile !== undefined ? gemTile : TILE.EMPTY);
            } else {
              this.world.setTile(tx, ty, TILE.EMPTY);
            }
            this.world.setData(tx, ty, null);
          } else {
            this._onContentRevealed(content, tx, ty);
          }
          // Remove any chained dynamite entries that got blasted
          this._dynamites = this._dynamites.filter(d => d.x !== tx || d.y !== ty);
        } else if (t === TILE.STONE) {
          // Dynamite destroys stone; if a gem was hidden inside, reveal it
          const stoneData = this.world.getData(tx, ty);
          if (stoneData && stoneData.innerGem) {
            const gemTile = GEM_HIDDEN_TO_TILE[stoneData.innerGem];
            if (gemTile !== undefined) {
              this.world.setTile(tx, ty, gemTile);
            } else {
              this.world.setTile(tx, ty, TILE.EMPTY);
            }
          } else {
            this.world.setTile(tx, ty, TILE.EMPTY);
          }
          this.world.setData(tx, ty, null);
        } else if (t === TILE.DYNAMITE) {
          // Chain-detonate other dynamite tiles
          this.world.setTile(tx, ty, TILE.EMPTY);
          this.world.setData(tx, ty, null);
          this._dynamites = this._dynamites.filter(d => d.x !== tx || d.y !== ty);
        }
        // Ore, water and lava tiles are left intact — dynamite just reveals/destroys
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
        this._triggerDeath();
        return;
      }
      p.setMessage(`💥 Too close to the blast! 2 damage (${p.hearts}/${p.maxHearts} ♥)`);
    } else if (distSq <= blastRadius * blastRadius) {
      const died = p.takeDamage();
      sounds.playHazardHit();
      if (died) {
        this._triggerDeath();
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
      this.player.setMessage('🌀 A water spring burst open nearby!');
    } else if (content === HIDDEN.LAVA) {
      this.player.setMessage('🔥 Lava erupted nearby! Watch your step!');
    } else if (content === HIDDEN.GAS) {
      this.player.setMessage('☣️ Gas leak detected nearby! Careful!');
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.POCKET_WATCH: {
        if (!p.specialItems.has('pocket_watch')) {
          p.specialItems.add('pocket_watch');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('⌚', 'A pocket watch! Still ticking after all these years.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.GLASSES: {
        if (!p.specialItems.has('glasses')) {
          p.specialItems.add('glasses');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🕶️', 'A pair of glasses? What else lies beneath the loo?');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.CANTEEN: {
        if (!p.specialItems.has('canteen')) {
          p.specialItems.add('canteen');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🫙', 'A dusty canteen. Still has a drop of water in it.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.LUNCHBOX: {
        if (!p.specialItems.has('lunchbox')) {
          p.specialItems.add('lunchbox');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🍱', 'A lunch box. The sandwich inside is ancient but tempting.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.TIN_CAN: {
        if (!p.specialItems.has('tin_can')) {
          p.specialItems.add('tin_can');
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🥫', 'A dented tin can. "Best before 1987."');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Bag of cash ────────────────────────────────────────────────────
      case TILE.CASH_BAG: {
        if (!p.specialItems.has(HIDDEN.CASH_BAG)) {
          p.specialItems.add(HIDDEN.CASH_BAG);
          p.money += CASH_BAG_VALUE;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('💰', `You found a bag of cash! A previous miner left it behind. +$${CASH_BAG_VALUE} added to your wallet.`);
          this.ui.updateHUD(p);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── New novelty collectibles ───────────────────────────────────────
      case TILE.SCROLL: {
        if (!p.specialItems.has(HIDDEN.SCROLL)) {
          p.specialItems.add(HIDDEN.SCROLL);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('📜', 'An ancient scroll! The words are faded but you can make out warnings about "the beast below."');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.FOSSIL: {
        if (!p.specialItems.has(HIDDEN.FOSSIL)) {
          p.specialItems.add(HIDDEN.FOSSIL);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('👣', 'Fossilized footprints! Something enormous walked through here a very long time ago.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.NEWSPAPER: {
        if (!p.specialItems.has(HIDDEN.NEWSPAPER)) {
          p.specialItems.add(HIDDEN.NEWSPAPER);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('📰', 'An old newspaper! The headline reads: "KNIGHT EXPEDITION VANISHES IN DEEP MINE — 1923."');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.BROKEN_CHAIN: {
        if (!p.specialItems.has(HIDDEN.BROKEN_CHAIN)) {
          p.specialItems.add(HIDDEN.BROKEN_CHAIN);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('⛓️', 'A broken chain. Someone — or something — snapped it. Best not to think about it.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.OLD_COIN: {
        if (!p.specialItems.has(HIDDEN.OLD_COIN)) {
          p.specialItems.add(HIDDEN.OLD_COIN);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🪙', 'An old coin! The face on it belongs to a forgotten king. Might be worth something someday.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.BOTTLE: {
        if (!p.specialItems.has(HIDDEN.BOTTLE)) {
          p.specialItems.add(HIDDEN.BOTTLE);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🍾', 'A sealed bottle of alcohol! Vintage 1923 and still intact. That\'s impressive.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Knight items (extended mine only) ─────────────────────────────
      case TILE.HELMET: {
        if (!p.specialItems.has(HIDDEN.HELMET)) {
          p.specialItems.add(HIDDEN.HELMET);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          const count = KNIGHT_ITEMS.filter(i => p.specialItems.has(i)).length;
          this._showItemPickupOverlay('🛡️', `A knight\'s helmet! You feel more courageous. (Knight item ${count}/4)`);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.ARMOR: {
        if (!p.specialItems.has(HIDDEN.ARMOR)) {
          p.specialItems.add(HIDDEN.ARMOR);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          const count = KNIGHT_ITEMS.filter(i => p.specialItems.has(i)).length;
          this._showItemPickupOverlay('🛡️', `A knight\'s armor! You feel protected. (Knight item ${count}/4)`);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.SHIELD: {
        if (!p.specialItems.has(HIDDEN.SHIELD)) {
          p.specialItems.add(HIDDEN.SHIELD);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          const count = KNIGHT_ITEMS.filter(i => p.specialItems.has(i)).length;
          this._showItemPickupOverlay('🛡️', `A knight\'s shield! Your defenses are unmatched. (Knight item ${count}/4)`);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      case TILE.SWORD: {
        if (!p.specialItems.has(HIDDEN.SWORD)) {
          p.specialItems.add(HIDDEN.SWORD);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          const allFour = KNIGHT_ITEMS.every(i => p.specialItems.has(i));
          if (allFour) {
            this._showItemPickupOverlay('🛡️', 'A knight\'s sword! You are now fully equipped. Seek the edge of the world — the beast awaits!');
          } else {
            const count = KNIGHT_ITEMS.filter(i => p.specialItems.has(i)).length;
            this._showItemPickupOverlay('🛡️', `A knight\'s sword! You feel ready for battle. (Knight item ${count}/4)`);
          }
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Deeper-mine collectibles + chess set pieces ─────────────────────
      case TILE.ANCHOR:
      case TILE.URN:
      case TILE.OLD_KEY:
      case TILE.HOURGLASS:
      case TILE.OLD_MIRROR:
      case TILE.PICTURE_FRAME:
      case TILE.TEA_POT:
      case TILE.GUITAR:
      case TILE.WHITE_KING:
      case TILE.WHITE_QUEEN:
      case TILE.WHITE_ROOK:
      case TILE.WHITE_BISHOP:
      case TILE.WHITE_KNIGHT:
      case TILE.WHITE_PAWN:
      case TILE.BLACK_KING:
      case TILE.BLACK_QUEEN:
      case TILE.BLACK_ROOK:
      case TILE.BLACK_BISHOP:
      case TILE.BLACK_KNIGHT:
      case TILE.BLACK_PAWN: {
        const collectibleByTile = {
          [TILE.ANCHOR]: { hidden: HIDDEN.ANCHOR, icon: '⚓', text: 'An old anchor. Strange thing to find this far underground.' },
          [TILE.URN]: { hidden: HIDDEN.URN, icon: '⚱️', text: 'An urn sealed shut for ages. You carefully pack it away.' },
          [TILE.OLD_KEY]: { hidden: HIDDEN.OLD_KEY, icon: '🗝️', text: 'An old key. Whatever lock it fits is probably long gone.' },
          [TILE.HOURGLASS]: { hidden: HIDDEN.HOURGLASS, icon: '⏳', text: 'An hourglass still half full — time moves strangely down here.' },
          [TILE.OLD_MIRROR]: { hidden: HIDDEN.OLD_MIRROR, icon: '🪞', text: 'An old mirror. Your reflection looks tired, but determined.' },
          [TILE.PICTURE_FRAME]: { hidden: HIDDEN.PICTURE_FRAME, icon: '🖼️', text: 'A picture frame with no photo. Someone left in a hurry.' },
          [TILE.TEA_POT]: { hidden: HIDDEN.TEA_POT, icon: '🫖', text: 'A dented tea pot. It rattles softly as you move.' },
          [TILE.GUITAR]: { hidden: HIDDEN.GUITAR, icon: '🎸', text: 'A weathered guitar. One string remains perfectly in tune.' },
          [TILE.WHITE_KING]: { hidden: HIDDEN.WHITE_KING, icon: '♔', text: 'You found the white king chess piece.' },
          [TILE.WHITE_QUEEN]: { hidden: HIDDEN.WHITE_QUEEN, icon: '♕', text: 'You found the white queen chess piece.' },
          [TILE.WHITE_ROOK]: { hidden: HIDDEN.WHITE_ROOK, icon: '♖', text: 'You found the white rook chess piece.' },
          [TILE.WHITE_BISHOP]: { hidden: HIDDEN.WHITE_BISHOP, icon: '♗', text: 'You found the white bishop chess piece.' },
          [TILE.WHITE_KNIGHT]: { hidden: HIDDEN.WHITE_KNIGHT, icon: '♘', text: 'You found the white knight chess piece.' },
          [TILE.WHITE_PAWN]: { hidden: HIDDEN.WHITE_PAWN, icon: '♙', text: 'You found the white pawn chess piece.' },
          [TILE.BLACK_KING]: { hidden: HIDDEN.BLACK_KING, icon: '♚', text: 'You found the black king chess piece.' },
          [TILE.BLACK_QUEEN]: { hidden: HIDDEN.BLACK_QUEEN, icon: '♛', text: 'You found the black queen chess piece.' },
          [TILE.BLACK_ROOK]: { hidden: HIDDEN.BLACK_ROOK, icon: '♜', text: 'You found the black rook chess piece.' },
          [TILE.BLACK_BISHOP]: { hidden: HIDDEN.BLACK_BISHOP, icon: '♝', text: 'You found the black bishop chess piece.' },
          [TILE.BLACK_KNIGHT]: { hidden: HIDDEN.BLACK_KNIGHT, icon: '♞', text: 'You found the black knight chess piece.' },
          [TILE.BLACK_PAWN]: { hidden: HIDDEN.BLACK_PAWN, icon: '♟', text: 'You found the black pawn chess piece.' },
        };
        const collectible = collectibleByTile[tile];
        if (collectible && !p.specialItems.has(collectible.hidden)) {
          p.specialItems.add(collectible.hidden);
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay(collectible.icon, collectible.text);
          this.ui.updateHUD(p);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Dowsing rod – instantly reveals adjacent water hazards ─────────
      case TILE.DOWSING_ROD: {
        if (!p.hasDowsingRod) {
          p.hasDowsingRod = true;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🪄', 'A dowsing rod! Springs will reveal themselves the moment you walk next to them.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Heat-vision goggles – instantly reveals adjacent lava hazards ──
      case TILE.HEAT_VISION: {
        if (!p.hasHeatVision) {
          p.hasHeatVision = true;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🥽', 'Heat-vision goggles! Lava pockets will reveal themselves the moment you walk next to them.');
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Treasure map – reveals the depth of the treasure chest ─────────
      case TILE.TREASURE_MAP: {
        if (!p.specialItems.has(HIDDEN.TREASURE_MAP)) {
          p.specialItems.add(HIDDEN.TREASURE_MAP);
          p.treasureMapDepth = this.world.treasureChestDepth;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🗺️', `A treasure map! X marks the spot at depth ${p.treasureMapDepth} m. Build the elevator and expand its depth to reach it!`);
          this.ui.updateHUD(p);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Treasure chest – contains rubies worth $5,000 ──────────────────
      case TILE.TREASURE_CHEST: {
        if (!p.specialItems.has(HIDDEN.TREASURE_CHEST)) {
          const rubyCount  = TREASURE_CHEST_RUBY_COUNT;
          const totalValue = rubyCount * GEM_VALUE[HIDDEN.RUBY];
          const slotsNeeded = rubyCount;
          const slotsAvailable = p.maxGems - p.gems.length;
          if (slotsAvailable < slotsNeeded) {
            p.setMessage(`🎁 Treasure chest needs ${slotsNeeded} free bag slots! (${slotsAvailable} available)`);
          } else {
            p.specialItems.add(HIDDEN.TREASURE_CHEST);
            for (let i = 0; i < rubyCount; i++) p.addGem(HIDDEN.RUBY);
            this.world.setTile(x, y, TILE.EMPTY);
            sounds.playItemPickup();
            this._showItemPickupOverlay('🎁', `You opened the treasure chest! Found ${rubyCount} rubies worth $${totalValue.toLocaleString()} in total. Sell them at the Bank!`);
            this.ui.updateHUD(p);
          }
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
        }
        break;
      }

      // ── Genie lamp – grants 3 game-over continues ──────────────────────
      case TILE.GENIE_LAMP: {
        if (p.genieWishes <= 0) {
          p.genieWishes = 3;
          this.world.setTile(x, y, TILE.EMPTY);
          sounds.playItemPickup();
          this._showItemPickupOverlay('🧞', 'A genie lamp! The genie grants you 3 wishes. When disaster strikes, you may wish to continue instead of restarting.');
          this.ui.updateHUD(p);
        } else {
          this.world.setTile(x, y, TILE.EMPTY);
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
      this._tryExitElevator();
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
        const newBabies = [];
        while (p.necklaceCount > 0 && p.babyCount < MAX_BABIES) {
          p.necklaceCount--;
          p.babyCount++;
          newBabies.push(p.babyCount);
          sounds.playTransaction();
        }

        const openHouseOverlay = () => {
          this.state = 'overlay';
          this.ui.openHouse(p, () => {
            this.state = 'playing';
            this.input.clear();
            this.ui.updateHUD(p);
          });
        };

        if (newBabies.length > 0) {
          // Show a popup for each new baby, then open the house overlay
          this.state = 'overlay';
          let idx = 0;
          const showNextBaby = () => {
            if (idx < newBabies.length) {
              const num = newBabies[idx++];
              this.ui.showItemPickup('👶', `Baby #${num} welcomed to the family!`, showNextBaby);
            } else {
              openHouseOverlay();
            }
          };
          showNextBaby();
        } else {
          openHouseOverlay();
        }
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
          p.setMessage('🏗️ Elevator built! Approach the door at x=23 from the left to ride ($5/boarding).');
          this.ui.updateHUD(p);
          Storage.save(p, this.world, this);
        },
        onExpandElevatorDepth: () => {
          p.unlockedDepth += ELEVATOR_DEPTH_INCREMENT;
          p.money -= ELEVATOR_DEPTH_COST;
          p.setMessage(`⛏ Mine expanded to ${p.unlockedDepth} m! Deeper ore awaits.`);
          this.ui.updateHUD(p);
          Storage.save(p, this.world, this);
        },
        onExpandHouse: (level) => {
          this._applyHouseExpansionTiles(level);
          this.ui.updateHUD(p);
          Storage.save(p, this.world, this);
        },
        onBuyMineCart: () => {
          this.ui.updateHUD(p);
          Storage.save(p, this.world, this);
        },
      });
      return;
    }

    if (checkTile(TILE.MINE_ENT)) {
      // Entering the elevator via right-approach now handles boarding; E just
      // shows a hint to walk down for the standard mine entrance.
      p.setMessage('⛏ Walk down (↓ / S) to enter the mine, or approach the elevator door from the left.');
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
    p.hasSecondBankCard = false;

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
   *  Level 2 = left side-wall extension.
   *  Level 3 = right side-wall extension.
   *  Level 4 = top-floor tile above the main facade.
   *  Level 5 = top-floor tile above the left side wall.
   *  Level 6 = top-floor tile above the right side wall. */
  _applyHouseExpansionTiles(level) {
    if (level >= 2) {
      this.world.setTile(BAR_X - 1, 1, TILE.HOUSE);
    }
    if (level >= 3) {
      this.world.setTile(BAR_X + 1, 1, TILE.HOUSE);
    }
    if (level >= 4) {
      this.world.setTile(BAR_X, 0, TILE.HOUSE);
    }
    if (level >= 5) {
      this.world.setTile(BAR_X - 1, 0, TILE.HOUSE);
    }
    if (level >= 6) {
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

    // ── Supplies depletion (skipped when dragon is slayed) ────────────────
    if (!this.player.slayedDragon && this._lastSuppliesTickTime > 0) {
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

    if (this.player.familyMode
      && !this.player.slayedDragon
      && this.player.hasSecondBankCard
      && this.player.suppliesMeter < SECOND_BANK_CARD_AUTO_RESTOCK_AT
      && this.player.bankBalance >= SUPPLIES_REFILL_COST) {
      const p = this.player;
      p.bankBalance -= SUPPLIES_REFILL_COST;
      p.suppliesMeter = Math.min(100, p.suppliesMeter + SUPPLIES_REFILL_AMOUNT);
      p.setMessage(`💳👱‍♀️ Wife restocked supplies from the bank. Balance: $${p.bankBalance}`);
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
    if (p.dynamiteCount)   items.push(`🧨 Dynamite ×${p.dynamiteCount}`);
    if (p.firstAidKits)    items.push(`🩹 First Aid ×${p.firstAidKits}`);
    for (const si of p.specialItems) {
      const icons = {
        rubber_boot: '🥾', pocket_watch: '⌚', glasses: '🕶️', skull: '💀',
        canteen: '🫙', lunchbox: '🍱', tin_can: '🥫',
        cash_bag: '💰', scroll: '📜', fossil: '👣', newspaper: '📰',
        broken_chain: '⛓️', old_coin: '🪙', bottle: '🍾',
        helmet: '🛡️', armor: '🛡️', shield: '🛡️', sword: '🛡️',
      };
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
    const p   = this.player;
    this.state = 'dead';
    const stats = this._collectFamilyStats();
    if (p.genieWishes > 0) {
      // Genie lamp available – show continue button; only clear save if player
      // chooses "try again" instead
      const onWish = () => this._useGenieWish(reason);
      if (reason === 'eviction') {
        this.ui.showEviction(stats, onWish);
      } else {
        this.ui.showDivorce(stats, onWish);
      }
    } else {
      Storage.clear();
      if (reason === 'eviction') {
        this.ui.showEviction(stats);
      } else {
        this.ui.showDivorce(stats);
      }
    }
  }

  /**
   * Consume one genie wish and continue playing.
   *
   * - 'death'    : restore all hearts and move the player to the surface.
   * - 'eviction' : clear the tax-grace state and restart the tax countdown.
   * - 'divorce'  : restore supplies to 100 % and clear the supplies-grace state.
   */
  _useGenieWish(reason) {
    const p = this.player;
    p.genieWishes--;

    if (reason === 'death') {
      p.hearts = p.maxHearts;
      p.dead   = false;
      if (p.y >= 3) {
        p.x = PLAYER_START_X;
        p.y = PLAYER_START_Y;
      }
    } else if (reason === 'eviction') {
      this._taxInGrace    = false;
      this._taxGraceStart = 0;
      this._lastTaxTime   = Date.now();  // Fresh tax cycle
    } else if (reason === 'divorce') {
      p.suppliesMeter          = 100;
      this._suppliesInGrace    = false;
      this._suppliesGraceStart = 0;
    }

    const wishesLeft = p.genieWishes;
    const wishMsg = wishesLeft > 0
      ? `🧞 The genie grants your wish! (${wishesLeft} wish${wishesLeft !== 1 ? 'es' : ''} remaining)`
      : '🧞 The genie has granted your last wish. The lamp is now empty.';
    p.setMessage(wishMsg);
    this.state = 'playing';
    this.input.clear();
    this.ui.updateHUD(p);
    Storage.save(p, this.world, this);
  }

  // -------------------------------------------------------------------------
  // Earthquake
  // -------------------------------------------------------------------------

  /** Refill the mine with fresh dirt and minerals (triggered via the outhouse). */
  _doEarthquake() {
    const p = this.player;

    // Regenerate the mine, excluding items the player already has
    this.world.regenerateMine(p);

    // If the player has the treasure map but hasn't opened the chest yet,
    // update the stored depth to match the new chest position.
    if (p.specialItems.has(HIDDEN.TREASURE_MAP) && !p.specialItems.has(HIDDEN.TREASURE_CHEST)) {
      p.treasureMapDepth = this.world.treasureChestDepth;
    }

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
