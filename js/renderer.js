'use strict';

/**
 * Renderer – draws the world and player onto the HTML5 Canvas.
 *
 * The visible viewport is VIEWPORT_COLS × VIEWPORT_ROWS tiles.
 * cameraY (world-tile units) is the topmost row drawn on screen.
 * The player is kept in the upper-third of the viewport so the miner
 * can see plenty of mine ahead of them.
 */
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.cameraY = 0;   // World row shown at the top of the canvas
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  /**
   * Snap the camera so the player sits roughly one-third from the top
   * (gives more visibility below while still showing some context above).
   * Never scrolls above y=0.
   */
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
      for (let x = 0; x < VIEWPORT_COLS; x++) {
        const tile = world.getTile(x, worldY);
        if (tile === null) continue;

        const px = x       * ts;
        const py = screenRow * ts;

        // Base fill
        ctx.fillStyle = TILE_COLOR[tile] ?? '#333';
        ctx.fillRect(px, py, ts, ts);

        // Detail decoration
        this._drawTileDetail(ctx, tile, px, py, ts, world, x, worldY);
      }
    }
  }

  _drawTileDetail(ctx, tile, px, py, ts, world, tx, ty) {
    const hs = ts / 2;
    const cx = px + hs;
    const cy = py + hs;

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
        // Brick rows
        ctx.fillStyle = '#4a2a0e';
        ctx.fillRect(px + 2, py + 3,  ts - 4, 5);
        ctx.fillRect(px + 2, py + 11, ts - 4, 5);
        ctx.fillRect(px + 2, py + 19, ts - 4, 5);
        ctx.fillRect(px + 2, py + 27, ts - 4, 5);
        // Mortar lines
        ctx.fillStyle = '#8a6040';
        ctx.fillRect(px + ts / 2, py + 3,  1, 5);
        ctx.fillRect(px + 4,      py + 11, 1, 5);
        ctx.fillRect(px + ts / 2, py + 19, 1, 5);
        ctx.fillRect(px + 4,      py + 27, 1, 5);
        break;
      }

      case TILE.SHOP: {
        ctx.fillStyle = '#fffacc';
        ctx.fillRect(px + 7, py + 8, ts - 14, ts - 8);
        ctx.fillStyle = '#7a5500';
        ctx.font      = 'bold 7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SHOP', cx, cy + 2);
        // Door handle
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

      case TILE.DOCTOR: {
        ctx.fillStyle = '#ddf4ff';
        ctx.fillRect(px + 7, py + 8, ts - 14, ts - 8);
        // Red cross
        ctx.fillStyle = '#cc0000';
        ctx.fillRect(cx - 1, py + 10, 3, 10);
        ctx.fillRect(cx - 4, py + 13, 9, 3);
        ctx.fillStyle = '#004488';
        ctx.font      = 'bold 6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DOC', cx, py + ts - 4);
        break;
      }

      case TILE.MINE_ENT: {
        ctx.fillStyle = '#000';
        ctx.fillRect(px + 5, py + 3, ts - 10, ts - 3);
        // Arch hint
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
        // Flat stone slabs with subtle seam lines
        ctx.fillStyle = '#7a7060';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        // Horizontal seam every other tile row
        ctx.fillStyle = '#686050';
        if (ty % 2 === 0) {
          ctx.fillRect(px + 1, py + ts / 2, ts - 2, 2);
        }
        // Vertical seam offset between rows
        const seamX = ty % 2 === 0 ? px + ts / 3 : px + (2 * ts / 3);
        ctx.fillRect(Math.floor(seamX), py + 1, 2, ts / 2 - 1);
        break;
      }

      case TILE.DIRT: {
        // Layered earthy texture
        ctx.fillStyle = '#7a4028';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.fillStyle = '#5a2818';
        for (let i = 0; i < 5; i++) {
          const ox = ((tx * 11 + ty * 7 + i * 9)  % (ts - 8)) + 4;
          const oy = ((tx *  9 + ty * 13 + i * 11) % (ts - 8)) + 4;
          ctx.fillRect(px + ox, py + oy, 3, 2);
        }
        // Reveal progress: glowing border that brightens as probes accumulate
        const d = world.getData(tx, ty);
        if (d && d.probes > 0) {
          const pct   = d.probes / d.threshold;
          const alpha = Math.min(0.9, pct * 1.2);
          ctx.strokeStyle = `rgba(255,210,80,${alpha})`;
          ctx.lineWidth   = 2;
          ctx.strokeRect(px + 2, py + 2, ts - 4, ts - 4);
        }
        break;
      }

      case TILE.EMPTY: {
        ctx.fillStyle = '#080808';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        break;
      }

      case TILE.GEM_LOW:  this._drawGem(ctx, cx, cy, hs, '#00c864', '#003820'); break;
      case TILE.GEM_MED:  this._drawGem(ctx, cx, cy, hs, '#3a7aff', '#001040'); break;
      case TILE.GEM_HIGH: this._drawGem(ctx, cx, cy, hs, '#ff3333', '#400000'); break;

      case TILE.WATER: {
        const isSource = world.isSpringSource(tx, ty);
        if (isSource) {
          // Spring source: teal background with upwelling bubbles and a bright centre dot
          ctx.fillStyle = '#007a6a';
          ctx.fillRect(px, py, ts, ts);
          // Inner highlight ring to suggest a welling pool
          ctx.fillStyle = '#00b89a';
          ctx.fillRect(px + 3, py + 3, ts - 6, ts - 6);
          // Upward-bubble symbol
          ctx.fillStyle = '#aaffee';
          ctx.font      = '16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⬆', cx, cy + 6);
          // Bright centre dot marking the source point
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, cy + 8, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Spread water: dark blue with animated shimmer
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
        // Glow effect
        ctx.fillStyle = 'rgba(255,100,0,0.3)';
        ctx.fillRect(px, py, ts, ts);
        break;
      }

      case TILE.SHOVEL: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⛏', cx, cy + 8);
        break;
      }

      case TILE.PICK: {
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        ctx.font      = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚒', cx, cy + 8);
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

      case TILE.STONE: {
        // Grey rocky block with crack lines
        ctx.fillStyle = '#484848';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        // Highlight edges (top-left lighter, bottom-right darker)
        ctx.fillStyle = '#686868';
        ctx.fillRect(px + 1, py + 1, ts - 2, 3);
        ctx.fillRect(px + 1, py + 1, 3,       ts - 2);
        ctx.fillStyle = '#282828';
        ctx.fillRect(px + 1, py + ts - 4, ts - 2, 3);
        ctx.fillRect(px + ts - 4, py + 1, 3,       ts - 2);
        // Crack details (deterministic from tile position)
        ctx.strokeStyle = '#333';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        const cx1 = px + ((tx * 7 + ty * 11) % (ts - 10)) + 5;
        const cy1 = py + ((tx * 13 + ty * 5) % (ts - 10)) + 5;
        ctx.moveTo(cx1, cy1);
        ctx.lineTo(cx1 + 6, cy1 + 4);
        ctx.lineTo(cx1 + 10, cy1 + 2);
        ctx.stroke();
        // Label so it's obvious
        ctx.fillStyle = '#aaa';
        ctx.font      = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('STONE', cx, cy + 3);
        break;
      }

      case TILE.ELEVATOR: {
        // Dark shaft with vertical cable and call-button marker
        ctx.fillStyle = '#1e1e3a';
        ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        // Vertical cable lines
        ctx.fillStyle = '#4a4a7a';
        ctx.fillRect(cx - 3, py + 1, 2, ts - 2);
        ctx.fillRect(cx + 1, py + 1, 2, ts - 2);
        // Horizontal guide rails at edges
        ctx.fillStyle = '#383868';
        ctx.fillRect(px + 2, py + 4,  4, 2);
        ctx.fillRect(px + 2, py + ts - 6, 4, 2);
        ctx.fillRect(px + ts - 6, py + 4,  4, 2);
        ctx.fillRect(px + ts - 6, py + ts - 6, 4, 2);
        // 'E' hint glyph
        ctx.fillStyle = '#6a6aaa';
        ctx.font      = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[E]', cx, cy + 3);
        break;
      }
    }
  }

  _drawGem(ctx, cx, cy, hs, color, shadow) {
    const s = hs * 0.52;
    ctx.fillStyle = '#111';
    ctx.fillRect(cx - hs + 2, cy - hs + 2, hs * 2 - 4, hs * 2 - 4);
    // Shadow diamond
    ctx.beginPath();
    ctx.moveTo(cx,     cy - s);
    ctx.lineTo(cx + s, cy    );
    ctx.lineTo(cx,     cy + s);
    ctx.lineTo(cx - s, cy    );
    ctx.closePath();
    ctx.fillStyle = shadow;
    ctx.fill();
    // Gem body
    ctx.beginPath();
    ctx.moveTo(cx,         cy - s + 2);
    ctx.lineTo(cx + s - 2, cy        );
    ctx.lineTo(cx,         cy + s - 2);
    ctx.lineTo(cx - s + 2, cy        );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // Specular highlight
    ctx.beginPath();
    ctx.moveTo(cx,     cy - s + 4);
    ctx.lineTo(cx + 4, cy - 2    );
    ctx.lineTo(cx,     cy + 4    );
    ctx.lineTo(cx - 4, cy - 2    );
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
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

    // During invincibility frames, dim the sprite every other 6-frame window
    // (draw at low alpha instead of disappearing so the player stays visible)
    const blink = player.iFrames > 0 &&
                  Math.floor(player.iFrames / BLINK_INTERVAL) % 2 === 0;
    if (blink) this.ctx.globalAlpha = 0.35;

    // Legs
    this.ctx.fillStyle = '#2a1a08';
    this.ctx.fillRect(px + 8,      py + ts - 10, 6, 10);
    this.ctx.fillRect(px + ts - 14, py + ts - 10, 6, 10);

    // Body
    this.ctx.fillStyle = '#d06010';
    this.ctx.fillRect(px + 7, py + 11, ts - 14, ts - 19);

    // Head
    this.ctx.fillStyle = '#e8a860';
    this.ctx.fillRect(px + 9, py + 3, ts - 18, 10);

    // Hard-hat brim
    this.ctx.fillStyle = '#f0c000';
    this.ctx.fillRect(px + 6,  py + 2, ts - 12, 4);
    // Hard-hat dome
    this.ctx.fillStyle = '#e8b800';
    this.ctx.fillRect(px + 9,  py,     ts - 18, 4);

    // Eyes
    this.ctx.fillStyle = '#222';
    this.ctx.fillRect(px + 11, py + 5, 3, 3);
    this.ctx.fillRect(px + ts - 14, py + 5, 3, 3);

    // Lamp on hat
    this.ctx.fillStyle = '#fff8a0';
    this.ctx.fillRect(cx - 2, py, 4, 3);
    // Lamp glow
    this.ctx.fillStyle = 'rgba(255,255,160,0.15)';
    this.ctx.beginPath();
    this.ctx.arc(cx, py + 1, 10, 0, Math.PI * 2);
    this.ctx.fill();

    // Reset alpha after dimmed-blink draw
    if (blink) this.ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Depth indicator overlay (drawn on canvas, top-right)
  // -------------------------------------------------------------------------

  _drawHeadsUpOverlay(player) {
    const ctx  = this.ctx;
    const text = player.y === 0 ? 'Surface' : `Depth: ${player.y}m`;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(CANVAS_W - 130, 6, 124, 22);
    ctx.fillStyle    = '#ddd';
    ctx.font         = '13px monospace';
    ctx.textAlign    = 'right';
    ctx.fillText(text, CANVAS_W - 10, 22);
    ctx.textAlign    = 'left';  // Reset
  }
}
