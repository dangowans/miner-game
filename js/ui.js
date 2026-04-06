'use strict';

/**
 * UI – manages HTML overlays (shop, bar, doctor, win, death)
 * and the HTML HUD panel below the canvas.
 */
class UI {
  constructor() {
    this.overlay     = document.getElementById('overlay');
    this.overlayOpen = false;
    this._onCloseCallback  = null;
    this._overlayNavHandler = null;

    // HUD elements
    this._hudHearts     = document.getElementById('hud-hearts');
    this._hudMoney      = document.getElementById('hud-money');
    this._hudGemsDetail = document.getElementById('hud-gems-detail');
    this._hudTools      = document.getElementById('hud-tools');
    this._hudMsg        = document.getElementById('hud-msg');
    this._btnDynamite   = document.getElementById('btn-dynamite');

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

    // Ore breakdown: count each type then build "🥈×2 🥇×1 (3/10)" string
    const oreCounts = {};
    for (const g of player.gems) oreCounts[g] = (oreCounts[g] || 0) + 1;
    const ORE_ICON = {
      [HIDDEN.SILVER]:   '🥈',
      [HIDDEN.GOLD]:     '🥇',
      [HIDDEN.PLATINUM]: '⬜',
      [HIDDEN.DIAMOND]:  '💎',
      [HIDDEN.RUBY]:     '🔴',
    };
    const parts = Object.entries(ORE_ICON)
      .filter(([t]) => (oreCounts[t] || 0) > 0)
      .map(([t, icon]) => `${icon}×${oreCounts[t]}`);
    const breakdown = parts.length ? parts.join(' ') : '—';
    this._hudGemsDetail.textContent = `${breakdown} (${player.gemCount}/${player.maxGems})`;

    const tools = [];
    if (player.hasShovel)       tools.push('⛏');
    if (player.hasPick)         tools.push(`⚒×${player.pickUses}`);
    if (player.hasBucket)       tools.push(`🪣×${player.bucketUses}`);
    if (player.hasExtinguisher) tools.push(`🧯×${player.extinguisherUses}`);
    if (player.hasBag)          tools.push('🎒×2');
    if (player.hasLantern)      tools.push('🔦');
    if (player.hasFlower)       tools.push('🌸');
    if (player.hasRing)         tools.push('💍');
    if (player.specialItems.has('rubber_boot'))  tools.push('🥾');
    if (player.specialItems.has('pocket_watch')) tools.push('⌚');
    if (player.specialItems.has('glasses'))      tools.push('🕶️');
    if (player.dynamiteCount > 0) {
      tools.push(player.placingDynamite
        ? `💣×${player.dynamiteCount} [PLACING]`
        : `💣×${player.dynamiteCount}`);
    }
    this._hudTools.textContent = tools.join(' ');

    // Dynamite button: enabled only when the player has dynamite
    if (this._btnDynamite) {
      this._btnDynamite.disabled = player.dynamiteCount === 0 && !player.placingDynamite;
      this._btnDynamite.textContent = player.placingDynamite ? '✕💣' : '💣';
      this._btnDynamite.style.borderColor = player.placingDynamite ? '#ff6600' : '';
    }

    this._hudMsg.textContent = player.message;
  }

  // -------------------------------------------------------------------------
  // Shop overlay
  // -------------------------------------------------------------------------

  openShop(player, onClose) {
    const itemsHtml = SHOP_ITEMS.map(item => {
      const owned = (item.id === 'shovel'       && player.hasShovel)      ||
                    (item.id === 'pick'          && player.hasPick)        ||
                    (item.id === 'bucket'        && player.hasBucket)      ||
                    (item.id === 'extinguisher'  && player.hasExtinguisher)||
                    (item.id === 'bag'           && player.hasBag);
      const dynamiteCount = item.id === 'dynamite' ? player.dynamiteCount : null;
      const affordable = player.money >= item.price;
      // Dynamite is never "owned once" — can always buy more if affordable
      const buyable    = item.id === 'dynamite' ? affordable : (!owned && affordable);
      const cls        = buyable ? 'shop-item buyable' : 'shop-item disabled';
      let note;
      if (item.id === 'dynamite') {
        note = dynamiteCount > 0
          ? ` <em>(×${dynamiteCount} in stock)</em>`
          : '';
        if (!affordable) note += ` <em class="short">(need $${item.price - player.money} more)</em>`;
      } else if (owned) {
        const usesMap = { pick: player.pickUses, bucket: player.bucketUses, extinguisher: player.extinguisherUses };
        const uses    = usesMap[item.id] ?? null;
        note = uses !== null
          ? ` <em>(owned — ${uses} use${uses !== 1 ? 's' : ''} left)</em>`
          : ' <em>(owned)</em>';
      } else if (!affordable) {
        note = ` <em class="short">(need $${item.price - player.money} more)</em>`;
      } else {
        note = '';
      }
      return `<div class="${cls}" data-id="${item.id}" data-price="${item.price}">
        <strong>${item.name}</strong> — <span class="price">$${item.price}</span>${note}<br>
        <small>${item.desc}</small>
      </div>`;
    }).join('');

    this.overlay.innerHTML = `
      <h2>🏪 General Store</h2>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <p style="color:#aaa;font-size:0.85em;margin:4px 0 8px">Sell your ore at the 🏦 Bank next door.</p>
      <div class="section-label">BUY</div>
      ${itemsHtml}
      <button class="close-btn" id="overlay-close">✕ Close &nbsp;<kbd>Esc</kbd></button>
    `;
    this._openOverlay(onClose);

    this.overlay.querySelectorAll('.shop-item.buyable').forEach(el => {
      el.addEventListener('click', () => {
        const id    = el.dataset.id;
        const price = parseInt(el.dataset.price, 10);
        if (player.money < price) return;
        player.money -= price;
        if      (id === 'shovel')      { player.hasShovel = true; }
        else if (id === 'pick')        { player.hasPick = true;   player.pickUses = TOOL_USES; }
        else if (id === 'bucket')      { player.hasBucket = true; player.bucketUses = TOOL_USES; }
        else if (id === 'extinguisher'){ player.hasExtinguisher = true; player.extinguisherUses = TOOL_USES; }
        else if (id === 'bag')         { player.hasBag = true; player.maxGems = 20; }
        else if (id === 'dynamite')    { player.dynamiteCount++; }
        player.setMessage(`Bought: ${id}!`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Bar overlay
  // -------------------------------------------------------------------------

  openBar(player, onClose) {
    // ── Step 0: Give the flower if not yet done ───────────────────────────
    if (player.hasFlower && !player.hasGivenFlower) {
      player.hasFlower     = false;
      player.hasGivenFlower = true;
      sounds.playTransaction();
    }

    const drinksLeft      = Math.max(0, DRINKS_TO_UNLOCK - player.drinksBought);
    const unlockedByDrinks = player.drinksBought >= DRINKS_TO_UNLOCK;
    const hasRingAndMoney  = player.hasRing && player.money >= JEWELER_MONEY_COST;

    let html;

    // ── Step 0: Needs the flower first ───────────────────────────────────
    if (!player.hasGivenFlower) {
      const flowerLines = [
        `"Oh, how sweet! But you didn't bring me a flower…"`,
        `"A miner? That's interesting. Do you know what I'd really love? A flower."`,
        `"You seem nice. Bring me a flower and maybe we can talk."`,
        `"I appreciate the visit, but a flower would make my day."`,
      ];
      const line = flowerLines[Math.floor(Math.random() * flowerLines.length)];
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Pick the 🌸 flower to the left of the outhouse and bring it to her.</p>
        <button class="close-btn" id="overlay-close">Close &nbsp;<kbd>Esc</kbd></button>`;

    // ── Proposal: drinks done, ring in hand, $1000 available ─────────────
    } else if (unlockedByDrinks && hasRingAndMoney) {
      html = `
        <div class="overlay-centered">
          <p class="overlay-emoji">💍</p>
          <p class="overlay-title" style="color:#f5c842">You kneel down…</p>
          <p><em>"Will you marry me?"</em></p>
          <p style="color:#f5c842"><em>💛 "Yes! A thousand times yes!"</em></p>
          <button class="close-btn" id="overlay-close">
            Continue →
          </button>
        </div>`;

    // ── Ring in hand but not enough money ─────────────────────────────────
    } else if (unlockedByDrinks && player.hasRing && player.money < JEWELER_MONEY_COST) {
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>"That ring is beautiful… but a girl needs security. Come back with $${JEWELER_MONEY_COST}."</em></p>
        <p class="hint">You need $${JEWELER_MONEY_COST - player.money} more to propose.</p>
        <button class="close-btn" id="overlay-close">Close &nbsp;<kbd>Esc</kbd></button>`;

    // ── Drinks done, waiting for the ring ─────────────────────────────────
    } else if (unlockedByDrinks) {
      const lines = [
        `"Hey there, miner. A girl needs security — and maybe a ring…"`,
        `"Come back when you have something special for me."`,
        `"You smell like dirt. I like it. But I need a ring first."`,
        `"I'm not going anywhere. The mines will still be there tomorrow."`,
        `"You've been so sweet lately. A ring would seal the deal."`,
        `"I keep thinking about us. All I need is a little… sparkle."`,
        `"Three drinks in and I think I'm falling for you. Got a ring?"`,
        `"My heart's open, miner. Is your wallet?"`,
        `"You've done everything right. One last thing — a ring."`,
      ];
      const line = lines[Math.floor(Math.random() * lines.length)];
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Hint: find the ring hidden in the mine at 67m depth (directly below the outhouse) and come back with $${JEWELER_MONEY_COST}.</p>
        <button class="close-btn" id="overlay-close">Close &nbsp;<kbd>Esc</kbd></button>`;

    // ── Step 1: Flower given; buy drinks ─────────────────────────────────
    } else {
      const drinkLines = player.drinksBought === 0
        ? [
          `"Oh! Thank you for the flower, it's gorgeous! 🌸 Can I offer you a drink?"`,
          `"A flower! How thoughtful! Let me get you something. And maybe another round for me?"`,
        ]
        : [
          `"Slow down, cowboy. A few more rounds first."`,
          `"You seem nice. Keep the drinks coming and we'll see…"`,
          `"I appreciate the company. Another round?"`,
          `"A miner, huh? Buy me a drink and tell me about it."`,
          `"You've got kind eyes. And an empty glass."`,
          `"Another drink wouldn't hurt. For either of us."`,
        ];
      const line = drinkLines[Math.floor(Math.random() * drinkLines.length)];
      const canAfford    = player.money >= DRINK_PRICE;
      const drinkBtnCls  = canAfford ? 'shop-item buyable' : 'shop-item disabled';
      const drinkNote    = canAfford ? '' : ` <em class="short">(need $${DRINK_PRICE - player.money} more)</em>`;
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Buy her ${drinksLeft} more drink${drinksLeft !== 1 ? 's' : ''} to win her over. (${player.drinksBought}/${DRINKS_TO_UNLOCK} bought)</p>
        <div class="${drinkBtnCls}" id="buy-drink-btn">
          <strong>🍺 Buy a Drink</strong> — <span class="price">$${DRINK_PRICE}</span>${drinkNote}
        </div>
        <button class="close-btn" id="overlay-close">Close &nbsp;<kbd>Esc</kbd></button>`;
    }

    this.overlay.innerHTML = html;
    this._openOverlay((win) => onClose(win));

    const drinkBtn = document.getElementById('buy-drink-btn');
    if (drinkBtn && drinkBtn.classList.contains('buyable')) {
      drinkBtn.addEventListener('click', () => {
        if (player.money < DRINK_PRICE) return;
        player.money -= DRINK_PRICE;
        player.drinksBought++;
        sounds.playTransaction();
        this._closeOverlay();
        onClose(false);
      });
    }

    document.getElementById('overlay-close').addEventListener('click', () => {
      const isWin = unlockedByDrinks && hasRingAndMoney;
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
    // Compute how many hearts will actually be restored (mirrors player.heal() logic)
    const affordable = Math.floor(player.money / healCost);
    const toHeal     = Math.min(missing, affordable);
    const canHeal    = toHeal > 0;
    const totalCost  = toHeal * healCost;
    const canExpand  = player.maxHearts < MAX_HEARTS && player.money >= EXTRA_HEART_PRICE;

    const heartsDisplay = () => {
      let s = '';
      for (let i = 0; i < player.maxHearts; i++) s += i < player.hearts ? '♥' : '♡';
      return s;
    };

    const healHtml = canHeal
      ? `<div class="shop-item buyable" id="heal-btn">
           ❤️ Restore ${toHeal} heart${toHeal !== 1 ? 's' : ''} — <span class="price">$${totalCost}</span>
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
        sounds.playTransaction();
        this._closeOverlay();
      });
    }

    const expandBtn = document.getElementById('expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        if (player.buyExtraHeart()) {
          player.setMessage(`New heart slot unlocked! (${player.maxHearts} max)`);
        }
        sounds.playTransaction();
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Death / win screens
  // -------------------------------------------------------------------------

  showDead() {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💀</p>
        <h2 class="overlay-title" style="color:#ff4444">YOU DIED</h2>
        <p>The mine claimed another victim.</p>
        <p style="color:#aaa;font-size:0.85em">
          Tip: visit the Doctor to increase your max hearts.
        </p>
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showWin() {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💍🎉</p>
        <h2 class="overlay-title" style="color:#f5c842">YOU WIN!</h2>
        <p>You found the ring and won her heart!</p>
        <p style="color:#aaa;font-size:0.85em">Thanks for playing Miner.</p>
        <button class="close-btn" onclick="location.reload()">
          🎊 Play Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  // -------------------------------------------------------------------------
  // Bank overlay
  // -------------------------------------------------------------------------

  openBank(player, onClose) {
    const hasSomethingToSell = player.gemCount > 0;

    // Build a breakdown by ore type
    const counts = {};
    for (const g of player.gems) counts[g] = (counts[g] || 0) + 1;
    const oreTypes = Object.keys(counts);
    const total = player.gems.reduce((s, g) => s + (GEM_VALUE[g] || 0), 0);

    let itemsHtml;
    if (hasSomethingToSell) {
      const rows = oreTypes.map(type => {
        const qty   = counts[type];
        const each  = GEM_VALUE[type] || 0;
        const sub   = qty * each;
        const label = ORE_NAME[type] || type;
        return `<div class="shop-item disabled" style="cursor:default">
          ${label} ×${qty} — <span class="price">$${sub}</span>
          <small> ($${each} each)</small>
        </div>`;
      }).join('');
      itemsHtml = `
        ${rows}
        <div class="shop-item buyable" id="sell-all-btn" style="margin-top:8px">
          💰 Sell all — <span class="price">$${total}</span>
          <small> (${player.gemCount} item${player.gemCount !== 1 ? 's' : ''})</small>
        </div>`;
    } else {
      itemsHtml = `<div class="shop-item disabled">No ore to sell — go mining!</div>`;
    }

    this.overlay.innerHTML = `
      <h2>🏦 Town Bank</h2>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <div class="section-label">SELL ORE</div>
      ${itemsHtml}
      <button class="close-btn" id="overlay-close">✕ Close &nbsp;<kbd>Esc</kbd></button>
    `;
    this._openOverlay(onClose);

    const sellBtn = document.getElementById('sell-all-btn');
    if (sellBtn) {
      sellBtn.addEventListener('click', () => {
        const earned = player.sellGems();
        player.setMessage(`Sold ore for $${earned}!`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------

  openDragons(onClose) {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🐉</p>
        <p class="overlay-title"><em>"Thar be dragons!"</em></p>
        <button class="close-btn" id="overlay-close">
          Turn Back
        </button>
      </div>`;
    this._openOverlay(onClose);
  }

  // -------------------------------------------------------------------------
  // Outhouse overlay
  openOuthouse(onClose) {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🚽</p>
        <p class="overlay-title"><em>"You feel relieved."</em></p>
        <button class="close-btn" id="overlay-close">
          Leave
        </button>
      </div>`;
    this._openOverlay(onClose);
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

    this._setupOverlayKeyNav();
  }

  _closeOverlay() {
    this.overlay.classList.remove('active');
    this.overlay.innerHTML = '';
    this.overlayOpen       = false;
    if (this._overlayNavHandler) {
      document.removeEventListener('keydown', this._overlayNavHandler);
      this._overlayNavHandler = null;
    }
    const cb = this._onCloseCallback;
    this._onCloseCallback  = null;
    if (cb) cb();
  }

  /**
   * Set up arrow-key + Enter navigation for the currently open overlay.
   * Collects all buyable items and the close button as navigable targets.
   * ArrowUp / ArrowDown cycle through them; Enter activates the focused one.
   */
  _setupOverlayKeyNav() {
    const items = Array.from(
      this.overlay.querySelectorAll('.shop-item.buyable, .close-btn')
    );
    if (items.length === 0) return;

    let focusIdx = 0;
    const setFocus = (i) => {
      items.forEach((el, j) => el.classList.toggle('focused', j === i));
    };
    setFocus(focusIdx);

    const handler = (e) => {
      if (!this.overlayOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusIdx = (focusIdx + 1) % items.length;
        setFocus(focusIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusIdx = (focusIdx + items.length - 1) % items.length;
        setFocus(focusIdx);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[focusIdx].click();
      }
    };

    document.addEventListener('keydown', handler);
    this._overlayNavHandler = handler;
  }
}
