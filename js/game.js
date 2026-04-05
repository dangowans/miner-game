'use strict';

/**
 * Game – main loop, movement, digging, hazard logic, interaction dispatch.
 *
 * State machine:
 *   'playing'  – normal gameplay; input is consumed and world is updated
 *   'overlay'  – shop / bar / doctor overlay is open; input paused
 *   'dead'     – player died; overlay shown; no input
 *   'won'      – player won; overlay shown; no input
 *
 * Movement rules:
 *   - 4-directional grid movement (up/down/left/right).
 *   - Surface (y=0) ↔ mine (y≥1) crossing ONLY at x ∈ [MINE_ENT_X_MIN, MINE_ENT_X_MAX].
 *   - WATER tiles: impassable.
 *   - LAVA tiles:  passable but deal 1 heart of damage.
 *   - DIRT tiles:  "dig-in" – immediately reveals content; player moves there
 *                  if the resulting tile is passable.
 *   - All other mine tiles: passable.
 *
 * Reveal mechanic:
 *   After each valid move the game calls world.probeAdjacent(), which increments
 *   the probe counter of all neighbouring DIRT tiles.  When a tile's probe count
 *   reaches its (threshold − toolReduction) it auto-reveals.
 *
 * Chunk generation:
 *   world.ensureGenerated() is called every tick so new rows are ready before
 *   the player reaches them.
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
    // Cap dt to avoid spiral-of-death on tab switch
    const dt = Math.min(timestamp - this._lastTime, 100);
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

    // Ensure mine rows are pre-generated ahead of the player
    this.world.ensureGenerated(this.player.y + GEN_LOOKAHEAD);

    const action = this.input.dequeue();
    if (!action) return;

    switch (action) {
      case 'up':    this._tryMove( 0, -1); break;
      case 'down':  this._tryMove( 0,  1); break;
      case 'left':  this._tryMove(-1,  0); break;
      case 'right': this._tryMove( 1,  0); break;
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

    // World boundary (left / right / top)
    if (nx < 0 || nx >= this.world.width || ny < 0) return;

    // Surface ↔ mine boundary:
    //   Can cross y=0/y=1 only through the mine-entrance columns.
    if ((p.y === 0 && ny > 0) || (p.y > 0 && ny === 0)) {
      if (nx < MINE_ENT_X_MIN || nx > MINE_ENT_X_MAX) return;
    }

    const targetTile = this.world.getTile(nx, ny);

    if (targetTile === TILE.DIRT) {
      // ── Dig-in: immediately reveal and attempt to enter ──
      const content = this.world.digInto(nx, ny);
      this._onContentRevealed(content, nx, ny);

      const newTile = this.world.getTile(nx, ny);
      if (this.world.isPassable(nx, ny)) {
        p.x = nx; p.y = ny;
        if (newTile === TILE.LAVA) {
          this._applyHazardDamage('lava');
          // Convert lava tile underfoot to empty after damage so player isn't stuck
          this.world.setTile(nx, ny, TILE.EMPTY);
        } else {
          this._checkPickup(nx, ny);
        }
      }
    } else if (this.world.isPassable(nx, ny)) {
      // ── Normal move ──
      if (targetTile === TILE.LAVA) {
        p.x = nx; p.y = ny;
        this._applyHazardDamage('lava');
        this.world.setTile(nx, ny, TILE.EMPTY);
      } else {
        p.x = nx; p.y = ny;
        // Probe neighbouring dirt tiles after moving
        const revealed = this.world.probeAdjacent(nx, ny, p.toolReduction);
        for (const { x, y, content } of revealed) {
          this._onContentRevealed(content, x, y);
        }
        this._checkPickup(nx, ny);
      }
    }
    // else: blocked – no move
  }

  // -------------------------------------------------------------------------
  // Hazard damage
  // -------------------------------------------------------------------------

  _applyHazardDamage(hazardType) {
    const p    = this.player;
    const died = p.takeDamage();
    if (died) {
      this.state = 'dead';
      this.ui.showDead();
    } else {
      const msg = hazardType === 'lava'
        ? `🔥 Lava burn! (${p.hearts}/${p.maxHearts} ♥)`
        : `💧 Hazard hit! (${p.hearts}/${p.maxHearts} ♥)`;
      p.setMessage(msg);
    }
  }

  // -------------------------------------------------------------------------
  // Content reveal callback
  // -------------------------------------------------------------------------

  _onContentRevealed(content, _x, _y) {
    if (content === HIDDEN.WATER) {
      this.player.setMessage('💧 A water spring burst open!');
    } else if (content === HIDDEN.LAVA) {
      this.player.setMessage('🔥 Lava erupted nearby! Watch your step!');
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
          p.setMessage(`💎 Picked up gem! ($${GEM_VALUE[key]})`);
        } else {
          p.setMessage('🎒 Bag full! Return to surface to sell gems.');
        }
        break;
      }

      case TILE.SHOVEL: {
        if (!p.hasShovel) {
          p.hasShovel = true;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('⛏ Found a Shovel! Digging is easier.');
        }
        break;
      }

      case TILE.PICK: {
        if (!p.hasPick) {
          p.hasPick = true;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('⚒ Found a Pick! Digging is even easier.');
        }
        break;
      }

      case TILE.BAG: {
        if (!p.hasBag) {
          p.hasBag    = true;
          p.maxGems   = 20;
          this.world.setTile(x, y, TILE.EMPTY);
          p.setMessage('🎒 Found a Large Bag! Carry capacity doubled.');
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interact (E / Enter) at special tiles
  // -------------------------------------------------------------------------

  _handleInteract() {
    const p    = this.player;
    const tile = this.world.getTile(p.x, p.y);

    if (tile === TILE.SHOP) {
      this.state = 'overlay';
      this.ui.openShop(p, () => {
        this.state = 'playing';
        this.ui.updateHUD(p);
      });
      return;
    }

    if (tile === TILE.BAR) {
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

    if (tile === TILE.DOCTOR) {
      this.state = 'overlay';
      this.ui.openDoctor(p, () => {
        this.state = 'playing';
        this.ui.updateHUD(p);
      });
      return;
    }

    // Contextual nudge
    if (tile === TILE.MINE_ENT) {
      p.setMessage('⛏ Enter the mine by walking down (↓ / S).');
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
