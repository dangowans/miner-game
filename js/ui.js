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
    if (player.hasRing)         tools.push('💍');
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
    const drinksLeft = Math.max(0, DRINKS_TO_UNLOCK - player.drinksBought);
    const unlockedByDrinks = player.drinksBought >= DRINKS_TO_UNLOCK;

    let html;
    if (unlockedByDrinks && player.hasRing) {
      html = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    height:100%;gap:14px;padding:20px;text-align:center">
          <p style="font-size:2em;line-height:1">💍</p>
          <p style="font-size:1.1em;margin:0">You kneel down with the ring in your hand…</p>
          <p style="font-size:1.4em;margin:0"><em>"Will you marry me?"</em></p>
          <p style="font-size:1.5em;color:#f5c842;margin:0">💛 <em>"Yes! A thousand times yes!"</em></p>
          <button class="close-btn" id="overlay-close" style="margin-top:8px">
            Continue →
          </button>
        </div>`;
    } else if (!unlockedByDrinks) {
      const drinkLines = [
        `"I don't know you well enough yet. Buy me a drink?"`,
        `"Slow down, cowboy. A few more rounds first."`,
        `"You seem nice. Keep the drinks coming and we'll see…"`,
        `"I appreciate the company. Another round?"`,
        `"A miner, huh? Buy me a drink and tell me about it."`,
        `"You've got kind eyes. And an empty glass."`,
        `"I like a man who knows how to spend his money wisely."`,
        `"The night's young. You buying?"`,
        `"Another drink wouldn't hurt. For either of us."`,
        `"What's a girl got to do to get a drink around here?"`,
      ];
      const line = drinkLines[Math.floor(Math.random() * drinkLines.length)];
      const canAfford = player.money >= DRINK_PRICE;
      const drinkBtnCls = canAfford ? 'shop-item buyable' : 'shop-item disabled';
      const drinkNote = canAfford ? '' : ` <em class="short">(need $${DRINK_PRICE - player.money} more)</em>`;
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Buy her ${drinksLeft} more drink${drinksLeft !== 1 ? 's' : ''} to win her over. (${player.drinksBought}/${DRINKS_TO_UNLOCK} bought)</p>
        <div class="${drinkBtnCls}" id="buy-drink-btn">
          <strong>🍺 Buy a Drink</strong> — <span class="price">$${DRINK_PRICE}</span>${drinkNote}
        </div>
        <button class="close-btn" id="overlay-close">Close &nbsp;<kbd>Esc</kbd></button>`;
    } else {
      // Drinks done, just need the ring
      const lines = [
        `"Hey there, miner. A girl needs security — and maybe a ring…"`,
        `"Come back when you have something special for me."`,
        `"You smell like dirt. I like it. But I need a ring first."`,
        `"I'm not going anywhere. The mines will still be there tomorrow."`,
        `"You've been so sweet lately. A ring would seal the deal."`,
        `"I keep thinking about us. All I need is a little… sparkle."`,
        `"Six drinks in and I think I'm falling for you. Got a ring?"`,
        `"My heart's open, miner. Is your wallet?"`,
        `"You've done everything right. One last thing — a ring."`,
      ];
      const line = lines[Math.floor(Math.random() * lines.length)];
      html = `
        <h2>🍺 The Bar</h2>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Hint: bring ${JEWELER_DIAMOND_COST} diamonds and $${JEWELER_MONEY_COST} to the Jeweler 💎 to have a ring made.</p>
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
      const isWin = unlockedByDrinks && player.hasRing;
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
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:14px;padding:20px;text-align:center">
        <p style="font-size:3em;line-height:1">💀</p>
        <h2 style="color:#ff4444;font-size:1.8em;margin:0">YOU DIED</h2>
        <p style="margin:0">The mine claimed another victim.</p>
        <p style="color:#aaa;font-size:0.9em;margin:0">
          Tip: visit the Doctor to increase your max hearts.
        </p>
        <button class="close-btn" style="margin-top:8px" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showWin() {
    this.overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:14px;padding:20px;text-align:center">
        <p style="font-size:2.5em;line-height:1">💍🎉</p>
        <h2 style="color:#f5c842;font-size:1.8em;margin:0">YOU WIN!</h2>
        <p style="font-size:1.1em;margin:0">You bought the ring and won her heart!</p>
        <p style="color:#aaa;font-size:0.9em;margin:0">
          Thanks for playing Miner.
        </p>
        <button class="close-btn" style="margin-top:8px" onclick="location.reload()">
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
  // Jeweler overlay
  // -------------------------------------------------------------------------

  openJeweler(player, onClose) {
    const diamondCount = player.gems.filter(g => g === HIDDEN.DIAMOND).length;
    const hasEnoughDiamonds = diamondCount >= JEWELER_DIAMOND_COST;
    const hasEnoughMoney    = player.money  >= JEWELER_MONEY_COST;
    const canCraft = !player.hasRing && hasEnoughDiamonds && hasEnoughMoney;

    let craftHtml;
    if (player.hasRing) {
      craftHtml = `<div class="shop-item disabled">💍 Ring already crafted!</div>`;
    } else if (canCraft) {
      craftHtml = `
        <div class="shop-item buyable" id="craft-ring-btn">
          💍 Craft a Ring —
          <span class="price">${JEWELER_DIAMOND_COST}💎 + $${JEWELER_MONEY_COST}</span>
        </div>`;
    } else {
      const diamondsNeeded = JEWELER_DIAMOND_COST - diamondCount;
      const needDiamondsMsg = hasEnoughDiamonds
        ? ''
        : ` <em class="short">(need ${diamondsNeeded} more diamond${diamondsNeeded !== 1 ? 's' : ''})</em>`;
      const needMoneyMsg = hasEnoughMoney
        ? ''
        : ` <em class="short">(need $${JEWELER_MONEY_COST - player.money} more)</em>`;
      craftHtml = `
        <div class="shop-item disabled">
          💍 Craft a Ring — <span class="price">${JEWELER_DIAMOND_COST}💎 + $${JEWELER_MONEY_COST}</span>
          ${needDiamondsMsg}${needMoneyMsg}
        </div>`;
    }

    this.overlay.innerHTML = `
      <h2>💎 Jeweler</h2>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <p class="shop-balance">Diamonds carried: <strong>${diamondCount}</strong></p>
      <p class="hint">Bring ${JEWELER_DIAMOND_COST} diamonds and $${JEWELER_MONEY_COST} to have a ring made for the girl at the bar.</p>
      <div class="section-label">COMMISSION</div>
      ${craftHtml}
      <button class="close-btn" id="overlay-close">✕ Close &nbsp;<kbd>Esc</kbd></button>
    `;
    this._openOverlay(onClose);

    const craftBtn = document.getElementById('craft-ring-btn');
    if (craftBtn) {
      craftBtn.addEventListener('click', () => {
        if (player.money < JEWELER_MONEY_COST) return;
        // Remove JEWELER_DIAMOND_COST diamonds from carried gems
        let removed = 0;
        player.gems = player.gems.filter(g => {
          if (g === HIDDEN.DIAMOND && removed < JEWELER_DIAMOND_COST) {
            removed++;
            return false;
          }
          return true;
        });
        player.money   -= JEWELER_MONEY_COST;
        player.hasRing  = true;
        player.setMessage('💍 Ring crafted! Take it to the girl at the Bar.');
        sounds.playTransaction();
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------

  openDragons(onClose) {
    this.overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:14px;padding:20px;text-align:center">
        <p style="font-size:3em;line-height:1">🐉</p>
        <p style="font-size:1.3em;margin:0"><em>"Thar be dragons!"</em></p>
        <button class="close-btn" id="overlay-close" style="margin-top:8px">
          Turn Back
        </button>
      </div>`;
    this._openOverlay(onClose);
  }

  // -------------------------------------------------------------------------
  // Outhouse overlay
  openOuthouse(onClose) {
    this.overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:14px;padding:20px;text-align:center">
        <p style="font-size:3em;line-height:1">🚽</p>
        <p style="font-size:1.3em;margin:0"><em>"You feel relieved."</em></p>
        <button class="close-btn" id="overlay-close" style="margin-top:8px">
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
