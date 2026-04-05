'use strict';

/**
 * UI – manages HTML overlays (shop, bar, doctor, win, death)
 * and the HTML HUD panel below the canvas.
 */
class UI {
  constructor() {
    this.overlay     = document.getElementById('overlay');
    this.overlayOpen = false;
    this._onCloseCallback = null;

    // HUD elements
    this._hudHearts = document.getElementById('hud-hearts');
    this._hudMoney  = document.getElementById('hud-money');
    this._hudGems   = document.getElementById('hud-gems');
    this._hudCap    = document.getElementById('hud-cap');
    this._hudTools  = document.getElementById('hud-tools');
    this._hudMsg    = document.getElementById('hud-msg');

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlayOpen) this._closeOverlay();
    });
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  updateHUD(player) {
    // Hearts: filled ♥ and empty ♡
    let hearts = '';
    for (let i = 0; i < player.maxHearts; i++) {
      hearts += i < player.hearts ? '♥' : '♡';
    }
    this._hudHearts.textContent = hearts;
    this._hudHearts.style.color = player.hearts <= 1 ? '#ff4444' : '#ff8888';

    this._hudMoney.textContent = player.money;
    this._hudGems.textContent  = player.gemCount;
    this._hudCap.textContent   = player.maxGems;

    const tools = [];
    if (player.hasShovel) tools.push('⛏');
    if (player.hasPick)   tools.push('⚒');
    if (player.hasBag)    tools.push('🎒×2');
    if (player.hasRing)   tools.push('💍');
    this._hudTools.textContent = tools.join(' ');

    this._hudMsg.textContent = player.message;
  }

  // -------------------------------------------------------------------------
  // Shop overlay
  // -------------------------------------------------------------------------

  openShop(player, onClose) {
    const gemTotal = player.gems.reduce((s, g) => s + (GEM_VALUE[g] || 0), 0);
    const hasSomethingToSell = player.gemCount > 0;

    const itemsHtml = SHOP_ITEMS.map(item => {
      const owned = (item.id === 'shovel' && player.hasShovel) ||
                    (item.id === 'pick'   && player.hasPick)   ||
                    (item.id === 'bag'    && player.hasBag)    ||
                    (item.id === 'ring'   && player.hasRing);
      const affordable = player.money >= item.price;
      const buyable    = !owned && affordable;
      const cls        = buyable ? 'shop-item buyable' : 'shop-item disabled';
      const note       = owned      ? ' <em>(owned)</em>'
                       : !affordable ? ` <em class="short">(need $${item.price - player.money} more)</em>`
                       : '';
      return `<div class="${cls}" data-id="${item.id}" data-price="${item.price}">
        <strong>${item.name}</strong> — <span class="price">$${item.price}</span>${note}<br>
        <small>${item.desc}</small>
      </div>`;
    }).join('');

    const sellSection = hasSomethingToSell
      ? `<div class="shop-item buyable sell-btn" id="sell-gems-btn">
           💰 Sell all gems — <span class="price">$${gemTotal}</span>
           <small> (${player.gemCount} gem${player.gemCount !== 1 ? 's' : ''})</small>
         </div>`
      : `<div class="shop-item disabled">💰 No gems to sell</div>`;

    this.overlay.innerHTML = `
      <h2>🏪 General Store</h2>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <div class="section-label">SELL</div>
      ${sellSection}
      <div class="section-label">BUY</div>
      ${itemsHtml}
      <button class="close-btn" id="overlay-close">✕ Close &nbsp;<kbd>Esc</kbd></button>
    `;
    this._openOverlay(onClose);

    if (hasSomethingToSell) {
      document.getElementById('sell-gems-btn').addEventListener('click', () => {
        const earned = player.sellGems();
        player.setMessage(`Sold gems for $${earned}!`);
        this._closeOverlay();
      });
    }

    this.overlay.querySelectorAll('.shop-item.buyable:not(.sell-btn)').forEach(el => {
      el.addEventListener('click', () => {
        const id    = el.dataset.id;
        const price = parseInt(el.dataset.price, 10);
        if (player.money < price) return;
        player.money -= price;
        if      (id === 'shovel') { player.hasShovel = true; }
        else if (id === 'pick')   { player.hasPick   = true; }
        else if (id === 'bag')    { player.hasBag = true; player.maxGems = 20; }
        else if (id === 'ring')   { player.hasRing = true; }
        player.setMessage(`Bought: ${id}!`);
        this._closeOverlay();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Bar overlay
  // -------------------------------------------------------------------------

  openBar(player, onClose) {
    let html;
    if (player.hasRing) {
      html = `
        <div style="text-align:center;padding-top:20px">
          <p style="font-size:1.1em">You walk up to her with the ring in your hand…</p>
          <p style="font-size:1.4em;margin-top:18px">💍 <em>"Will you marry me?"</em></p>
          <p style="font-size:1.5em;color:#f5c842;margin-top:14px">💛 <em>"Yes! A thousand times yes!"</em></p>
          <p style="font-size:1.3em;margin-top:22px">🎉 <strong>YOU WIN!</strong></p>
          <p style="color:#aaa;margin-top:8px">Congratulations, you lucky miner!</p>
          <button class="close-btn" id="overlay-close" style="margin-top:28px">
            🎊 Play Again
          </button>
        </div>`;
    } else {
      const lines = [
        `"Hey there, miner. A girl needs security — and maybe a ring…"`,
        `"Come back when you have something special for me."`,
        `"You smell like dirt. I like it. But I need a ring first."`,
        `"I'm not going anywhere. The mines will still be there tomorrow."`,
      ];
      const line = lines[Math.floor(Math.random() * lines.length)];
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Hint: buy a ring at the Shop for $${SHOP_ITEMS.find(i => i.id === 'ring').price}.</p>
        <button class="close-btn" id="overlay-close">Close &nbsp;<kbd>Esc</kbd></button>`;
    }
    this.overlay.innerHTML = html;
    this._openOverlay((win) => onClose(win));

    document.getElementById('overlay-close').addEventListener('click', () => {
      const isWin = player.hasRing;
      this._closeOverlay();
      onClose(isWin);
    });
  }

  // -------------------------------------------------------------------------
  // Doctor overlay
  // -------------------------------------------------------------------------

  openDoctor(player, onClose) {
    const missing    = player.maxHearts - player.hearts;
    const healCost   = HEAL_PRICE;
    const canHeal    = missing > 0 && player.money >= healCost;
    const canExpand  = player.maxHearts < MAX_HEARTS && player.money >= EXTRA_HEART_PRICE;

    const heartsDisplay = () => {
      let s = '';
      for (let i = 0; i < player.maxHearts; i++) s += i < player.hearts ? '♥' : '♡';
      return s;
    };

    const healHtml = canHeal
      ? `<div class="shop-item buyable" id="heal-btn">
           ❤️ Restore 1 heart — <span class="price">$${healCost}</span>
         </div>`
      : missing === 0
        ? `<div class="shop-item disabled">❤️ You are already at full health</div>`
        : `<div class="shop-item disabled">❤️ Not enough money to heal ($${healCost} needed)</div>`;

    const expandHtml = player.maxHearts >= MAX_HEARTS
      ? `<div class="shop-item disabled">💛 Maximum hearts reached (${MAX_HEARTS})</div>`
      : canExpand
        ? `<div class="shop-item buyable" id="expand-btn">
             💛 Buy extra heart slot — <span class="price">$${EXTRA_HEART_PRICE}</span>
             <small> (${player.maxHearts} → ${player.maxHearts + 1} max)</small>
           </div>`
        : `<div class="shop-item disabled">💛 Extra heart slot — $${EXTRA_HEART_PRICE}
             <em class="short">(need $${EXTRA_HEART_PRICE - player.money} more)</em>
           </div>`;

    this.overlay.innerHTML = `
      <h2>🏥 Doctor's Office</h2>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <p class="shop-balance">Health: <strong style="color:#ff8888">${heartsDisplay()}</strong>
         (${player.hearts}/${player.maxHearts})</p>
      <div class="section-label">HEAL</div>
      ${healHtml}
      <div class="section-label">UPGRADES</div>
      ${expandHtml}
      <button class="close-btn" id="overlay-close">✕ Close &nbsp;<kbd>Esc</kbd></button>
    `;
    this._openOverlay(onClose);

    const healBtn = document.getElementById('heal-btn');
    if (healBtn) {
      healBtn.addEventListener('click', () => {
        const restored = player.heal();
        player.setMessage(`Restored ${restored} heart${restored !== 1 ? 's' : ''}!`);
        this._closeOverlay();
      });
    }

    const expandBtn = document.getElementById('expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        if (player.buyExtraHeart()) {
          player.setMessage(`New heart slot unlocked! (${player.maxHearts} max)`);
        }
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Death / win screens
  // -------------------------------------------------------------------------

  showDead() {
    this.overlay.innerHTML = `
      <div style="text-align:center;padding-top:30px">
        <p style="font-size:3em">💀</p>
        <h2 style="color:#ff4444;font-size:1.8em;margin:12px 0">YOU DIED</h2>
        <p>The mine claimed another victim.</p>
        <p style="color:#aaa;margin-top:8px;font-size:0.9em">
          Tip: visit the Doctor to increase your max hearts.
        </p>
        <button class="close-btn" style="margin-top:28px" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showWin() {
    this.overlay.innerHTML = `
      <div style="text-align:center;padding-top:24px">
        <p style="font-size:2.5em">💍🎉</p>
        <h2 style="color:#f5c842;font-size:1.8em;margin:10px 0">YOU WIN!</h2>
        <p style="font-size:1.1em">You bought the ring and won her heart!</p>
        <p style="color:#aaa;margin-top:10px;font-size:0.9em">
          Thanks for playing Miner VGA.
        </p>
        <button class="close-btn" style="margin-top:28px" onclick="location.reload()">
          🎊 Play Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _openOverlay(onClose) {
    this.overlayOpen      = true;
    this._onCloseCallback = onClose;
    this.overlay.classList.add('active');

    const closeBtn = document.getElementById('overlay-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._closeOverlay());
    }
  }

  _closeOverlay() {
    this.overlay.classList.remove('active');
    this.overlay.innerHTML = '';
    this.overlayOpen       = false;
    const cb = this._onCloseCallback;
    this._onCloseCallback  = null;
    if (cb) cb();
  }
}
