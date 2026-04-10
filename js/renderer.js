'use strict';

/**
 * Renderer – draws the world and player onto the HTML5 Canvas.
 */
class Renderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.cameraY = 0;
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  updateCamera(player) {
    const idealTop = player.y - Math.floor(VIEWPORT_ROWS / 3);
    this.cameraY   = Math.max(0, idealTop);
  }

  // -------------------------------------------------------------------------
  // Main draw entry-point
  // -------------------------------------------------------------------------

  draw(world, player) {
    this.updateCamera(player);
    this._clear();
    this._drawWorld(world, player);
    this._drawCollectFlash(player);
    this._drawPlayer(player);
    this._drawHeadsUpOverlay(player);
  }

  // -------------------------------------------------------------------------
  // World tiles
  // -------------------------------------------------------------------------

  _clear() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  _drawWorld(world, player) {
    const ctx = this.ctx;
    const ts  = TILE_SIZE;

    for (let screenRow = 0; screenRow < VIEWPORT_ROWS; screenRow++) {
      const worldY = this.cameraY + screenRow;
      // Tiles below the player's unlocked depth limit are not rendered
      if (worldY > player.unlockedDepth + 2) continue;
      for (let x = 0; x < VIEWPORT_COLS; x++) {
        const tile = world.getTile(x, worldY);
        if (tile === null) continue;

        const px = x         * ts;
        const py = screenRow * ts;

        ctx.fillStyle = TILE_COLOR[tile] ?? '#333';
        ctx.fillRect(px, py, ts, ts);

        this._drawTileDetail(ctx, tile, px, py, ts, world, x, worldY, player);
      }
    }
  }

  _drawTileDetail(ctx, tile, px, py, ts, world, tx, ty, player) {
    const hs = ts / 2;
    const cx = px + hs;
    const cy = py + hs;

    // ── Sky horizon for the building-facade row ───────────────────────────────
    // Draw a sky-blue strip across the top of every y=1 building tile BEFORE
    // tile detail so that peaked roofs (house, outhouse) render above it.
    // SKY, FLOWER and MINE_ENT tiles are excluded.
    if (ty === 1 && tile !== TILE.MINE_ENT && tile !== TILE.SKY && tile !== TILE.FLOWER) {
      ctx.fillStyle = '#7ab8e8';
      ctx.fillRect(px, py, ts, 8);
    }

    switch (tile) {

      case TILE.GRASS: {
        ctx.fillStyle = '#5a9430';
        for (let i = 0; i < 4; i++) {
          const ox = ((tx * 7 + ty * 3 + i * 5) % (ts - 6)) + 3;
          const oy = ((tx * 5 + ty * 9 + i * 7) % (ts - 6)) + 3;
          ctx.fillRect(px + ox, py + oy, 2, 2);
        }
        break;
      }

      case TILE.BUILDING: {
        ctx.fillStyle = '#4a2a0e';
        ctx.fillRect(px + 2, py + 3,  ts - 4, 5);
        ctx.fillRect(px + 2, py + 11, ts - 4, 5);
        ctx.fillRect(px + 2, py + 19, ts - 4, 5);
        ctx.fillRect(px + 2, py + 27, ts - 4, 5);
        ctx.fillStyle = '#8a6040';
        ctx.fillRect(px + ts / 2, py + 3,  1, 5);
        ctx.fillRect(px + 4,      py + 11, 1, 5);
        ctx.fillRect(px + ts / 2, py + 19, 1, 5);
        ctx.fillRect(px + 4,      py + 27, 1, 5);
        break;
      }

      case TILE.OUTHOUSE: {
        // Small wooden shack with a crescent moon window
        ctx.fillStyle = '#5a3a18';
        ctx.fillRect(px + 4, py + 6, ts - 8, ts - 6);
        // Roof peak
        ctx.fillStyle = '#3a2008';
        ctx.beginPath();
        ctx.moveTo(px + 2,      py + 6);
        ctx.lineTo(cx,          py + 1);
        ctx.lineTo(px + ts - 2, py + 6);
        ctx.closePath();
        ctx.fill();
        // Crescent moon cutout (light outline)
        ctx.strokeStyle = '#f0d080';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy - 2, 4, 0.3, Math.PI - 0.3);
        ctx.stroke();
        // Door handle
        ctx.fillStyle = '#c08040';
        ctx.fillRect(cx + 2, cy + 4, 2, 3);
        break;
      }

      case TILE.SHOP: {
        ctx.fillStyle = '#fffacc';
        ctx.fillRect(px + 7, py + 8, ts - 14, ts - 8);
        ctx.fillStyle = '#7a5500';
        ctx.font      = 'bold 7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SHOP', cx, cy + 2);
        ctx.fillStyle = '#c08000';
        ctx.fillRect(px + 10, py + 18, 3, 3);
        break;
      }

      case TILE.BAR: {
        ctx.fillStyle = '#ffddee';
        ctx.fillRect(px + 7, py + 8, ts - 14, ts - 8);
        ctx.fillStyle = '#801040';
        ctx.font      = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BAR', cx, cy + 2);
        ctx.fillStyle = '#c01060';
        ctx.fillRect(px + ts - 13, py + 18, 3, 3);
        break;
      }

      case TILE.HOUSE: {
        // Small family house – visually expands with player.houseLevel.
        // Three rendering modes based on tile position:
        //   ty === 0              → top-floor (upper storey, no sky-horizon strip)
        //   ty === 1, tx !== BAR_X → side wall extension
        //   ty === 1, tx === BAR_X → main facade
        const lvl = (player && player.houseLevel) || 1;

        if (ty === 0) {
          // ── Top-floor tile (upper storey above the ground-floor row) ────────
          // Wall
          ctx.fillStyle = '#c8956a';
          ctx.fillRect(px, py + 12, ts, ts - 12);
          // Roof triangle
          ctx.fillStyle = '#6a3a18';
          ctx.beginPath();
          ctx.moveTo(px,      py + 12);
          ctx.lineTo(cx,      py + 2);
          ctx.lineTo(px + ts, py + 12);
          ctx.closePath();
          ctx.fill();
          // Window
          ctx.fillStyle = '#aaddff';
          ctx.fillRect(cx - 3, py + 17, 7, 7);
          ctx.fillStyle = '#88bbdd';
          ctx.fillRect(cx - 2, py + 19, 5, 1);
          ctx.fillRect(cx,     py + 17, 1, 5);

        } else if (tx !== BAR_X) {
          // ── Side wall extension (ground-floor row, adjacent to main facade) ─
          // Full-width wall so it connects flush to neighbouring tiles.
          // Sky-horizon strip (py+0..py+8) was already drawn above the switch.
          ctx.fillStyle = '#c8956a';
          ctx.fillRect(px, py + 8, ts, ts - 8);
          // Window
          ctx.fillStyle = '#aaddff';
          ctx.fillRect(cx - 3, py + 14, 7, 7);
          ctx.fillStyle = '#88bbdd';
          ctx.fillRect(cx - 2, py + 16, 5, 1);
          ctx.fillRect(cx,     py + 14, 1, 5);

        } else {
          // ── Main house facade ───────────────────────────────────────────────
          // Wall
          ctx.fillStyle = '#c8956a';
          ctx.fillRect(px + 4, py + 10, ts - 8, ts - 10);

          // Roof (triangle) – drawn on top of the sky-horizon strip so the peak
          // is visible above the sky line.
          ctx.fillStyle = '#6a3a18';
          ctx.beginPath();
          ctx.moveTo(px + 1,      py + 10);
          ctx.lineTo(cx,          py + 2);
          ctx.lineTo(px + ts - 1, py + 10);
          ctx.closePath();
          ctx.fill();

          // Level 3+: dormer window on the roof (above door)
          if (lvl >= 3) {
            ctx.fillStyle = '#6a3a18';
            ctx.beginPath();
            ctx.moveTo(cx - 4, py + 10);
            ctx.lineTo(cx,     py + 5);
            ctx.lineTo(cx + 4, py + 10);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#aaddff';
            ctx.fillRect(cx - 2, py + 7, 5, 3);
          }

          // Door
          ctx.fillStyle = '#4a2200';
          ctx.fillRect(cx - 3, py + 20, 7, ts - 20);

          // Left window (always present)
          ctx.fillStyle = '#aaddff';
          ctx.fillRect(px + 6, py + 13, 5, 5);
          ctx.fillStyle = '#88bbdd';
          ctx.fillRect(px + 7, py + 14, 3, 1);
          ctx.fillRect(px + 8, py + 13, 1, 3);

          // Level 2+: right window beside the door
          if (lvl >= 2) {
            ctx.fillStyle = '#aaddff';
            ctx.fillRect(px + ts - 11, py + 13, 5, 5);
            ctx.fillStyle = '#88bbdd';
            ctx.fillRect(px + ts - 10, py + 14, 3, 1);
            ctx.fillRect(px + ts - 9,  py + 13, 1, 3);
          }

          // Level 4: upper-storey windows (above ground-floor windows)
          if (lvl >= 4) {
            ctx.fillStyle = '#aaddff';
            ctx.fillRect(px + 6, py + 11, 4, 3);
            ctx.fillRect(px + ts - 11, py + 11, 4, 3);
          }

          // Label
          ctx.fillStyle = '#4a2200';
          ctx.font      = 'bold 5px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('HOME', cx, py + ts - 3);
        }
        break;
      }

      case TILE.DOCTOR: {
        ctx.fillStyle = '#ddf4ff';
        ctx.fillRect(px + 7, py + 8, ts - 14, ts - 8);
        ctx.fillStyle = '#cc0000';
        ctx.fillRect(cx - 1, py + 10, 3, 10);
        ctx.fillRect(cx - 4, py + 13, 9, 3);
        ctx.fillStyle = '#004488';
        ctx.font      = 'bold 6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DOC', cx, py + ts - 4);
        break;
      }

      case TILE.BANK: {
        // Green facade with "$" sign and column hints
        ctx.fillStyle = '#d4edda';
        ctx.fillRect(px + 4, py + 8, ts - 8, ts - 8);
        // Columns
        ctx.fillStyle = '#a0c8a8';
        ctx.fillRect(px + 5,  py + 8, 4, ts - 8);
        ctx.fillRect(px + ts - 9, py + 8, 4, ts - 8);
        // "$" label
        ctx.fillStyle = '#1a5c1a';
        ctx.font      = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BANK', cx, cy + 2);
        // Door handle
        ctx.fillStyle = '#2a8a2a';
        ctx.fillRect(cx - 2, py + 22, 3, 3);
        break;
      }

      case TILE.MINE_ENT: {
        ctx.fillStyle = '#000';
        ctx.fillRect(px + 5, py + 3, ts - 10, ts - 3);
        ctx.strokeStyle = '#555';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(cx, py + 3, (ts - 10) / 2, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#888';
        ctx.font      = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▼', cx, cy + 8);
        break;
      }

      case TILE.PAVEMENT: {
        ctx.fillStyle = '#7a7060';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.fillStyle = '#686050';
        if (ty % 2 === 0) {
          ctx.fillRect(px + 1, py + ts / 2, ts - 2, 2);
        }
        const seamX = ty % 2 === 0 ? px + ts / 3 : px + (2 * ts / 3);
        ctx.fillRect(Math.floor(seamX), py + 1, 2, ts / 2 - 1);
        break;
      }

      case TILE.DIRT: {
        const d = world.getData(tx, ty);
        if (d && d.impenetrable) {
          // Impenetrable – very slightly darker than normal dirt; no special markings
          ctx.fillStyle = '#6a3520';
          ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
          ctx.fillStyle = '#512810';
          for (let i = 0; i < 5; i++) {
            const ox = ((tx * 13 + ty * 5 + i * 7)  % (ts - 8)) + 4;
            const oy = ((tx *  7 + ty * 11 + i * 9) % (ts - 8)) + 4;
            ctx.fillRect(px + ox, py + oy, 3, 2);
          }
        } else {
          ctx.fillStyle = '#7a4028';
          ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
          ctx.fillStyle = '#5a2818';
          for (let i = 0; i < 5; i++) {
            const ox = ((tx * 11 + ty * 7 + i * 9)  % (ts - 8)) + 4;
            const oy = ((tx *  9 + ty * 13 + i * 11) % (ts - 8)) + 4;
            ctx.fillRect(px + ox, py + oy, 3, 2);
          }
          if (d && d.probes > 0) {
            const pct   = d.probes / d.threshold;
            const alpha = Math.min(0.9, pct * 1.2);
            ctx.strokeStyle = `rgba(255,210,80,${alpha})`;
            ctx.lineWidth   = 2;
            ctx.strokeRect(px + 2, py + 2, ts - 4, ts - 4);
          }
        }
        break;
      }

      case TILE.EMPTY: {
        ctx.fillStyle = '#080808';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        break;
      }

      // ── Ore tiles ──────────────────────────────────────────────────────────
      case TILE.SILVER:   this._drawOreVein(ctx, px, py, ts, tx, ty, '#9aaab4', '#c8d8e0', 'Ag'); break;
      case TILE.GOLD:     this._drawOreVein(ctx, px, py, ts, tx, ty, '#a07800', '#d4a800', 'Au'); break;
      case TILE.PLATINUM: this._drawOreVein(ctx, px, py, ts, tx, ty, '#6888a0', '#b8ccd8', 'Pt'); break;
      case TILE.DIAMOND:  this._drawDiamond(ctx, px, py, ts, cx, cy, hs);                         break;

      // ── Unique ore ─────────────────────────────────────────────────────────
      case TILE.RUBY: {
        this._drawDiamond(ctx, px, py, ts, cx, cy, hs, '#cc1040', '#ff4070');
        // Star marker to signal uniqueness
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      // ── Unique novelty items ───────────────────────────────────────────────
      case TILE.RUBBER_BOOT: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🥾', cx, cy + 8);
        break;
      }

      case TILE.POCKET_WATCH: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⌚', cx, cy + 8);
        break;
      }

      case TILE.GLASSES: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🕶️', cx, cy + 8);
        break;
      }

      // ── Tool items ─────────────────────────────────────────────────────────
      case TILE.WATER: {
        const isSource = world.isSpringSource(tx, ty);
        if (isSource) {
          ctx.fillStyle = '#007a6a';
          ctx.fillRect(px, py, ts, ts);
          ctx.fillStyle = '#00b89a';
          ctx.fillRect(px + 3, py + 3, ts - 6, ts - 6);
          ctx.fillStyle = '#aaffee';
          ctx.font      = '16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⬆', cx, cy + 6);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, cy + 8, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#1040aa';
          ctx.fillRect(px, py, ts, ts);
          ctx.fillStyle = '#4488ff';
          const phase = ((tx + ty) % 3);
          ctx.font      = '20px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(phase === 0 ? '≈' : '≋', cx, cy + 7);
        }
        break;
      }

      case TILE.LAVA: {
        ctx.fillStyle = '#992200';
        ctx.fillRect(px, py, ts, ts);
        ctx.fillStyle = '#ff6600';
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('≋', cx, cy + 7);
        ctx.fillStyle = 'rgba(255,100,0,0.3)';
        ctx.fillRect(px, py, ts, ts);
        break;
      }

      case TILE.SHOVEL: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🪏', cx, cy + 8);
        break;
      }

      case TILE.PICK: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⛏', cx, cy + 8);
        break;
      }

      case TILE.BAG: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🎒', cx, cy + 8);
        break;
      }

      case TILE.JEWELER: {
        ctx.fillStyle = '#f0e8ff';
        ctx.fillRect(px + 7, py + 8, ts - 14, ts - 8);
        // Faceted gem in the window
        ctx.fillStyle = '#aa44cc';
        ctx.beginPath();
        ctx.moveTo(cx,          py + 10);
        ctx.lineTo(cx + 5,      py + 14);
        ctx.lineTo(cx,          py + 18);
        ctx.lineTo(cx - 5,      py + 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#cc88ff';
        ctx.beginPath();
        ctx.moveTo(cx,     py + 10);
        ctx.lineTo(cx + 5, py + 14);
        ctx.lineTo(cx,     py + 14);
        ctx.closePath();
        ctx.fill();
        // Label
        ctx.fillStyle = '#5500aa';
        ctx.font      = 'bold 5px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('JEWELER', cx, py + ts - 4);
        break;
      }

      case TILE.SKY: {
        // Full sky-blue tile — rendered via the base fillStyle (#7ab8e8).
        // Add a soft cloud wisp using deterministic offsets.
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        const cx1 = px + ((tx * 7 + 4) % (ts - 12)) + 6;
        ctx.fillRect(cx1, py + 10, 12, 4);
        ctx.fillRect(cx1 - 3, py + 12, 18, 3);
        break;
      }

      case TILE.STONE: {
        ctx.fillStyle = '#484848';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.fillStyle = '#686868';
        ctx.fillRect(px + 1, py + 1, ts - 2, 3);
        ctx.fillRect(px + 1, py + 1, 3,       ts - 2);
        ctx.fillStyle = '#282828';
        ctx.fillRect(px + 1, py + ts - 4, ts - 2, 3);
        ctx.fillRect(px + ts - 4, py + 1, 3,       ts - 2);
        ctx.strokeStyle = '#333';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        const cx1 = px + ((tx * 7 + ty * 11) % (ts - 10)) + 5;
        const cy1 = py + ((tx * 13 + ty * 5) % (ts - 10)) + 5;
        ctx.moveTo(cx1, cy1);
        ctx.lineTo(cx1 + 6, cy1 + 4);
        ctx.lineTo(cx1 + 10, cy1 + 2);
        ctx.stroke();
        break;
      }

      case TILE.DYNAMITE: {
        // Dark tile with bomb emoji and a countdown label
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '18px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('💣', cx, cy + 6);
        const d = world.getData(tx, ty);
        if (d) {
          const secs = Math.ceil(d.frames / 60);
          ctx.fillStyle = secs <= DYNAMITE_URGENT_SECS ? '#ff4400' : '#ffdd00';
          ctx.font      = `bold ${secs <= DYNAMITE_URGENT_SECS ? 9 : 8}px monospace`;
          ctx.fillText(`${secs}s`, cx, py + ts - 3);
        }
        // Pulsing red border when fuse is in the urgent window
        if (d && d.frames <= DYNAMITE_URGENT_SECS * 60) {
          const pulse = Math.sin(d.frames * 0.20) * 0.5 + 0.5;
          ctx.strokeStyle = `rgba(255,80,0,${0.4 + pulse * 0.6})`;
          ctx.lineWidth   = 2;
          ctx.strokeRect(px + 2, py + 2, ts - 4, ts - 4);
        }
        break;
      }

      case TILE.RING: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('💍', cx, cy + 8);
        // Golden star marker to signal importance
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.FLOWER: {
        // Surface flower tile – drawn in the building facade row (no background)
        ctx.font      = '18px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🌸', cx, cy + 8);
        break;
      }

      case TILE.LANTERN: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🔦', cx, cy + 8);
        break;
      }

      case TILE.RADIO: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('📻', cx, cy + 8);
        break;
      }

      case TILE.SKULL: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('💀', cx, cy + 8);
        break;
      }

      case TILE.CANTEEN: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🧴', cx, cy + 8);
        break;
      }

      case TILE.LUNCHBOX: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🍱', cx, cy + 8);
        break;
      }

      case TILE.TIN_CAN: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🥫', cx, cy + 8);
        break;
      }

      case TILE.NECKLACE: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('📿', cx, cy + 8);
        break;
      }

      case TILE.CASH_BAG: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('💰', cx, cy + 8);
        // Golden star marker to indicate value
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.SCROLL: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('📜', cx, cy + 8);
        break;
      }

      case TILE.FOSSIL: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🦴', cx, cy + 8);
        break;
      }

      case TILE.NEWSPAPER: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('📰', cx, cy + 8);
        break;
      }

      case TILE.BROKEN_CHAIN: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⛓️', cx, cy + 8);
        break;
      }

      case TILE.OLD_COIN: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🪙', cx, cy + 8);
        break;
      }

      case TILE.BOTTLE: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🍾', cx, cy + 8);
        break;
      }

      case TILE.HELMET: {
        ctx.fillStyle = '#101820';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⛑️', cx, cy + 8);
        // Silver star marker for knight items
        ctx.fillStyle = '#c0c0c0';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.ARMOR: {
        ctx.fillStyle = '#101820';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🪬', cx, cy + 8);
        // Silver star marker for knight items
        ctx.fillStyle = '#c0c0c0';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.SHIELD: {
        ctx.fillStyle = '#101820';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🛡️', cx, cy + 8);
        // Silver star marker for knight items
        ctx.fillStyle = '#c0c0c0';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.SWORD: {
        ctx.fillStyle = '#101820';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚔️', cx, cy + 8);
        // Silver star marker for knight items
        ctx.fillStyle = '#c0c0c0';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.DOWSING_ROD: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🪄', cx, cy + 8);
        break;
      }

      case TILE.HEAT_VISION: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🥽', cx, cy + 8);
        break;
      }

      case TILE.TREASURE_MAP: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🗺️', cx, cy + 8);
        // Gold star marker to signal importance
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.TREASURE_CHEST: {
        ctx.fillStyle = '#201000';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🎁', cx, cy + 8);
        // Gold star marker to signal high value
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.GAS: {
        // Dark sickly yellow-green background
        ctx.fillStyle = '#2a3800';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        // Toxic cloud symbol
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('☁️', cx, cy + 8);
        // Biohazard tint overlay for visibility
        ctx.fillStyle = 'rgba(180, 220, 0, 0.35)';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        // Warning indicator
        ctx.fillStyle = '#b8dc00';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('☣', cx, py + 9);
        break;
      }

      case TILE.GENIE_LAMP: {
        // Dark burnished gold-brown background
        ctx.fillStyle = '#1a1000';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        // Lamp emoji
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🪔', cx, cy + 8);
        // Gold star marker to signal magic
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 8px monospace';
        ctx.fillText('★', cx, py + 9);
        break;
      }

      case TILE.WORKER: {
        // Sky background
        ctx.fillStyle = '#7ab8e8';
        ctx.fillRect(px, py, ts, ts);
        // Body (orange hi-vis vest)
        ctx.fillStyle = '#e07820';
        ctx.fillRect(cx - 5, py + 17, 10, 11);
        // Head
        ctx.fillStyle = '#f0c890';
        ctx.beginPath();
        ctx.arc(cx, py + 13, 5, 0, Math.PI * 2);
        ctx.fill();
        // Hard hat (yellow)
        ctx.fillStyle = '#f5d800';
        ctx.beginPath();
        ctx.arc(cx, py + 11, 5, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(cx - 7, py + 10, 14, 3);
        // Arms
        ctx.fillStyle = '#e07820';
        ctx.fillRect(cx - 9, py + 18, 4, 7);
        ctx.fillRect(cx + 5, py + 18, 4, 7);
        // Legs
        ctx.fillStyle = '#4466aa';
        ctx.fillRect(cx - 5, py + 28, 4, ts - 28);
        ctx.fillRect(cx + 1, py + 28, 4, ts - 28);
        break;
      }

      case TILE.ELEV_SHAFT: {
        // Continuous shaft rails between elevator doors – not interactive
        ctx.fillStyle = '#0e1520';
        ctx.fillRect(px, py, ts, ts);
        ctx.fillStyle = '#3a5070';
        // Left rail
        ctx.fillRect(px + 2, py, 4, ts);
        // Right rail
        ctx.fillRect(px + ts - 6, py, 4, ts);
        break;
      }

      case TILE.ELEV_ENT: {
        // Elevator door – steel-framed with up/down arrow indicating interior navigation
        // Dark background
        ctx.fillStyle = '#0e1520';
        ctx.fillRect(px, py, ts, ts);
        // Left rail
        ctx.fillStyle = '#3a5070';
        ctx.fillRect(px + 2, py, 4, ts);
        // Right rail
        ctx.fillRect(px + ts - 6, py, 4, ts);
        // Horizontal bar (door lintel)
        ctx.fillRect(px + 2, py + 4, ts - 4, 3);
        // ↕ arrow (ride elevator)
        ctx.fillStyle = '#88ccff';
        ctx.font      = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('↕', cx, cy + 6);
        // "$N" ride-cost label
        ctx.fillStyle = '#aaddff';
        ctx.font      = 'bold 7px monospace';
        ctx.fillText(`$${ELEVATOR_RIDE_COST}`, cx, cy + 16);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ore / gem helper drawers
  // -------------------------------------------------------------------------

  /**
   * Draw ore as irregular veins embedded in rock — no glowing balls.
   * Uses deterministic offsets from tile coordinates so it looks consistent.
   * @param {string} dark   - darker shade for shadow veins
   * @param {string} light  - lighter shade for highlight veins
   * @param {string} label  - short chemical symbol (Ag, Au, Pt)
   */
  _drawOreVein(ctx, px, py, ts, tx, ty, dark, light, label) {
    // Rock background – fill full tile to prevent the coloured TILE_COLOR
    // border from showing through after the ore is mined.
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(px, py, ts, ts);

    // Seed deterministic layout from tile position using small coprime multipliers
    // so adjacent tiles produce visually distinct vein patterns.
    const s1 = (tx * 7 + ty * 13) % 8;
    const s2 = (tx * 11 + ty * 5) % 6;
    const s3 = (tx * 3 + ty * 17) % 7;

    // Draw 3 irregular vein patches
    const veins = [
      { x: px + 4 + s1,      y: py + 5 + s2,      w: 6 + s3,      h: 3 },
      { x: px + 8 + s2,      y: py + 12 + s1,     w: 8 + s2,      h: 3 },
      { x: px + 3 + s3,      y: py + 19 + s2,     w: 5 + s1,      h: 3 },
    ];

    for (const v of veins) {
      // Keep veins within tile bounds
      const x = Math.min(v.x, px + ts - v.w - 2);
      const y = Math.min(v.y, py + ts - v.h - 2);
      // Dark shadow offset
      ctx.fillStyle = dark;
      ctx.fillRect(x + 1, y + 1, v.w, v.h);
      // Light vein on top
      ctx.fillStyle = light;
      ctx.fillRect(x, y, v.w, v.h - 1);
    }

    // Small chemical symbol label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font      = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, px + ts / 2, py + ts - 4);
  }

  /**
   * Draw a gem/crystal as a small flat faceted shape — no glowing highlight.
   * Defaults to diamond colours; pass overrides for ruby.
   */
  _drawDiamond(ctx, px, py, ts, cx, cy, hs,
               faceColor = '#6ab8d8', edgeColor = '#2a6888') {
    // Dark rock background – fill full tile to prevent TILE_COLOR border artefacts.
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(px, py, ts, ts);

    const s = Math.round(hs * 0.48);

    // Bottom dark face (depth)
    ctx.beginPath();
    ctx.moveTo(cx,     cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx,     cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    ctx.fillStyle = edgeColor;
    ctx.fill();

    // Top-left bright face
    ctx.beginPath();
    ctx.moveTo(cx,     cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx,     cy);
    ctx.closePath();
    ctx.fillStyle = faceColor;
    ctx.fill();

    // Top-right mid face
    ctx.beginPath();
    ctx.moveTo(cx,     cy - s);
    ctx.lineTo(cx - s, cy);
    ctx.lineTo(cx,     cy);
    ctx.closePath();
    ctx.fillStyle = this._blendHex(faceColor, 0.6);
    ctx.fill();

    // Thin outline for crispness
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx,     cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx,     cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    ctx.stroke();
  }

  /** Darken a hex colour string by blending toward black. */
  _blendHex(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const rr = Math.round(r * factor);
    const gg = Math.round(g * factor);
    const bb = Math.round(b * factor);
    return `rgb(${rr},${gg},${bb})`;
  }

  // -------------------------------------------------------------------------
  // Ore-collect flash
  // -------------------------------------------------------------------------

  /**
   * Draw a fading coloured rectangle over the player's tile to signal ore pickup.
   * Rendered after the world tiles but before the player sprite so the miner
   * is always visible on top.
   */
  _drawCollectFlash(player) {
    if (player.collectFlash <= 0) return;
    const ts    = TILE_SIZE;
    const px    = player.x * ts;
    const py    = (player.y - this.cameraY) * ts;
    const alpha = (player.collectFlash / COLLECT_FLASH_FRAMES) * 0.70;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle   = player.collectFlashColor;
    this.ctx.fillRect(px, py, ts, ts);
    this.ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Player character
  // -------------------------------------------------------------------------

  _drawPlayer(player) {
    const ts = TILE_SIZE;
    const px = player.x * ts;
    const py = (player.y - this.cameraY) * ts;
    const hs = ts / 2;
    const cx = px + hs;

    // During invincibility frames dim the sprite every other 6-frame window
    const blink = player.iFrames > 0 &&
                  Math.floor(player.iFrames / BLINK_INTERVAL) % 2 === 0;
    if (blink) this.ctx.globalAlpha = 0.35;

    // Legs
    this.ctx.fillStyle = '#2a1a08';
    this.ctx.fillRect(px + 8,       py + ts - 10, 6, 10);
    this.ctx.fillRect(px + ts - 14, py + ts - 10, 6, 10);

    // Body
    this.ctx.fillStyle = '#d06010';
    this.ctx.fillRect(px + 7, py + 11, ts - 14, ts - 19);

    // Head
    this.ctx.fillStyle = '#e8a860';
    this.ctx.fillRect(px + 9, py + 3, ts - 18, 10);

    // Hard-hat brim
    this.ctx.fillStyle = '#f0c000';
    this.ctx.fillRect(px + 6, py + 2, ts - 12, 4);
    // Hard-hat dome
    this.ctx.fillStyle = '#e8b800';
    this.ctx.fillRect(px + 9, py,     ts - 18, 4);

    // Eyes
    this.ctx.fillStyle = '#222';
    this.ctx.fillRect(px + 11,      py + 5, 3, 3);
    this.ctx.fillRect(px + ts - 14, py + 5, 3, 3);

    // Lamp on hat
    this.ctx.fillStyle = '#fff8a0';
    this.ctx.fillRect(cx - 2, py, 4, 3);
    // Lamp glow
    this.ctx.fillStyle = 'rgba(255,255,160,0.15)';
    this.ctx.beginPath();
    this.ctx.arc(cx, py + 1, 10, 0, Math.PI * 2);
    this.ctx.fill();

    if (blink) this.ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Depth indicator overlay
  // -------------------------------------------------------------------------

  _drawHeadsUpOverlay(player) {
    const ctx  = this.ctx;
    const text = player.y <= 2 ? 'Surface' : `Depth: ${player.y - 2}m`;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(CANVAS_W - 130, 6, 124, 22);
    ctx.fillStyle = '#ddd';
    ctx.font      = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(text, CANVAS_W - 10, 22);
    ctx.textAlign = 'left';
  }
}
