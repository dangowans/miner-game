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
    if (player.hasShovel)       tools.push('🪏');
    if (player.hasPick)         tools.push(`⚒×${player.pickUses}`);
    if (player.hasBucket)       tools.push(`🪣×${player.bucketUses}`);
    if (player.hasExtinguisher) tools.push(`🧯×${player.extinguisherUses}`);
    if (player.hasBag)          tools.push('🎒×2');
    if (player.hasLantern)      tools.push('🔦');
    if (player.hasFlower)       tools.push('🌸');
    if (player.hasRing)         tools.push('💍');
    if (player.hasRadio)        tools.push('📻');
    if (player.specialItems.has('rubber_boot'))  tools.push('🥾');
    if (player.specialItems.has('pocket_watch')) tools.push('⌚');
    if (player.specialItems.has('glasses'))      tools.push('🕶️');
    if (player.specialItems.has('skull'))        tools.push('💀');
    if (player.specialItems.has('canteen'))      tools.push('🧴');
    if (player.specialItems.has('lunchbox'))     tools.push('🍱');
    if (player.specialItems.has('tin_can'))      tools.push('🥫');
    if (player.dynamiteCount > 0) {
      tools.push(player.placingDynamite
        ? `💣×${player.dynamiteCount} [PLACING]`
        : `💣×${player.dynamiteCount}`);
    }
    if (player.firstAidKits > 0) tools.push(`🩹×${player.firstAidKits}`);

    // Family mode status (appended to tool row)
    if (player.familyMode) {
      const supPct  = Math.round(player.suppliesMeter);
      const barFull = Math.round(supPct / 10);
      const supBar  = '█'.repeat(barFull) + '░'.repeat(10 - barFull);
      tools.push(`| 🏦$${player.bankBalance} 🏠[${supBar}]${supPct}%`);
    }

    this._hudTools.textContent = tools.join(' ');

    // Dynamite button: enabled only when the player has dynamite
    if (this._btnDynamite) {
      this._btnDynamite.disabled = player.dynamiteCount === 0 && !player.placingDynamite;
      this._btnDynamite.textContent = player.placingDynamite ? '✕💣' : '💣';
      this._btnDynamite.style.borderColor = player.placingDynamite ? '#ff6600' : '';
    }

    // First Aid Kit button: enabled when kits are in stock
    const btnFirstAid = document.getElementById('btn-firstaid');
    if (btnFirstAid) {
      btnFirstAid.disabled = player.firstAidKits <= 0 || player.hearts >= player.maxHearts;
    }

    // Radio button: hidden until found, then always enabled
    const btnRadio = document.getElementById('btn-radio');
    if (btnRadio) {
      btnRadio.style.display = player.hasRadio ? '' : 'none';
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
      const dynamiteCount  = item.id === 'dynamite'  ? player.dynamiteCount  : null;
      const firstAidCount  = item.id === 'firstaid'  ? player.firstAidKits   : null;
      const affordable = player.money >= item.price;
      // Dynamite is never "owned once" — can always buy more if affordable
      // Same for first aid kits
      const buyable    = (item.id === 'dynamite' || item.id === 'firstaid') ? affordable : (!owned && affordable);
      const cls        = buyable ? 'shop-item buyable' : 'shop-item disabled';
      const stockNote  = (count) => count > 0 ? ` <em>(×${count} in stock)</em>` : '';
      const needNote   = !affordable ? ` <em class="short">(need $${item.price - player.money} more)</em>` : '';
      let note;
      if (item.id === 'dynamite') {
        note = stockNote(dynamiteCount) + needNote;
      } else if (item.id === 'firstaid') {
        note = stockNote(firstAidCount) + needNote;
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
        <div class="shop-item-row">
          <span class="shop-item-icon">${item.icon}</span>
          <div class="shop-item-text">
            <strong>${item.name}</strong> — <span class="price">$${item.price}</span>${note}<br>
            <small>${item.desc}</small>
          </div>
        </div>
      </div>`;
    }).join('');

    this.overlay.innerHTML = `
      <div class="overlay-header">
        <h2>🏪 General Store</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <p style="color:#aaa;font-size:0.85em;margin:4px 0 8px">Sell your ore at the 🏦 Bank next door.</p>
      <div class="section-label">BUY</div>
      ${itemsHtml}
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
        else if (id === 'firstaid')    { player.firstAidKits++; }
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
        <div class="overlay-header">
          <h2>🍺 The Bar</h2>
          <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
        </div>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Pick the 🌸 flower to the left of the outhouse and bring it to her.</p>`;

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
        <div class="overlay-header">
          <h2>🍺 The Bar</h2>
          <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
        </div>
        <p class="bar-girl">👱‍♀️ <em>"That ring is beautiful… but a girl needs security. Come back with $${JEWELER_MONEY_COST}."</em></p>
        <p class="hint">You need $${JEWELER_MONEY_COST - player.money} more to propose.</p>`;

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
        <div class="overlay-header">
          <h2>🍺 The Bar</h2>
          <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
        </div>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Hint: find the ring hidden in the mine around 50 m below the outhouse and come back with $${JEWELER_MONEY_COST}.</p>`;

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
        <div class="overlay-header">
          <h2>🍺 The Bar</h2>
          <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
        </div>
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>
        <p class="hint">Buy her ${drinksLeft} more drink${drinksLeft !== 1 ? 's' : ''} to win her over. (${player.drinksBought}/${DRINKS_TO_UNLOCK} bought)</p>
        <div class="${drinkBtnCls}" id="buy-drink-btn">
          <strong>🍺 Buy a Drink</strong> — <span class="price">$${DRINK_PRICE}</span>${drinkNote}
        </div>`;
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
      <div class="overlay-header">
        <h2>🏥 Doctor's Office</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <p class="shop-balance">Health: <strong style="color:#ff8888">${heartsDisplay()}</strong>
         (${player.hearts}/${player.maxHearts})</p>
      <div class="section-label">HEAL</div>
      ${healHtml}
      <div class="section-label">UPGRADES</div>
      ${expandHtml}
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

  showDead(elapsedTime) {
    const timeHtml = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💀</p>
        <h2 class="overlay-title" style="color:#ff4444">YOU DIED</h2>
        <p>The mine claimed another victim.</p>
        ${timeHtml}
        <p class="overlay-tip">
          Tip: visit the Doctor to increase your max hearts.
        </p>
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showPoliceArrest(elapsedTime) {
    const timeHtml = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">👮</p>
        <h2 class="overlay-title" style="color:#ff4444">BUSTED!</h2>
        <p>You set off dynamite in town! A police officer arrested you on the spot.</p>
        ${timeHtml}
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showMineCollapse(elapsedTime) {
    const timeHtml = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">⛏️💥</p>
        <h2 class="overlay-title" style="color:#ff4444">MINE COLLAPSE!</h2>
        <p>The blast reached the surface and caused a catastrophic mine collapse. You didn't make it out.</p>
        ${timeHtml}
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showWin(elapsedTime, onFamilyMode) {
    const timeHtml = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💍🎉</p>
        <h2 class="overlay-title" style="color:#f5c842">YOU WIN!</h2>
        <p>You found the ring and won her heart!</p>
        <p style="color:#f5c842"><em>💛 "Yes! A thousand times yes!"</em></p>
        ${timeHtml}
        <p style="color:#aaa;font-size:0.85em;margin-top:4px">What would you like to do next?</p>
        <button class="close-btn" id="family-mode-btn" style="border-color:#f5c842;color:#f5c842">
          👨‍👩‍👧‍👦 Enter Family Mode
        </button>
        <button class="close-btn" id="play-again-btn" style="margin-top:4px">
          🎊 Play Again
        </button>
      </div>`;
    this._openOverlay(() => {});

    const familyBtn = document.getElementById('family-mode-btn');
    if (familyBtn) {
      familyBtn.addEventListener('click', () => {
        this._closeOverlay();
        if (onFamilyMode) onFamilyMode();
      });
    }
    const playAgainBtn = document.getElementById('play-again-btn');
    if (playAgainBtn) {
      playAgainBtn.addEventListener('click', () => {
        Storage.clear();
        location.reload();
      });
    }
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

    // Bank account section (family mode only)
    let accountHtml = '';
    if (player.familyMode) {
      const depositStep  = 50;
      const canDeposit   = player.money >= depositStep;
      const canWithdraw  = player.bankBalance >= depositStep;
      const depositCls   = canDeposit  ? 'shop-item buyable' : 'shop-item disabled';
      const withdrawCls  = canWithdraw ? 'shop-item buyable' : 'shop-item disabled';
      const depositNote  = canDeposit  ? '' : ` <em class="short">(need $${depositStep - player.money} more)</em>`;
      const withdrawNote = canWithdraw ? '' : ` <em class="short">(balance too low)</em>`;
      accountHtml = `
        <div class="section-label">BANK ACCOUNT</div>
        <p style="font-size:0.88em;margin:4px 0 8px">
          Account balance: <strong style="color:#f5c842">$${player.bankBalance}</strong>
          <small style="color:#888"> — taxes are debited from here automatically</small>
        </p>
        <div class="${depositCls}" id="deposit-btn" data-amount="${depositStep}">
          💳 Deposit $${depositStep}${depositNote}
        </div>
        <div class="${withdrawCls}" id="withdraw-btn" data-amount="${depositStep}">
          💸 Withdraw $${depositStep}${withdrawNote}
        </div>`;
    }

    this.overlay.innerHTML = `
      <div class="overlay-header">
        <h2>🏦 Town Bank</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <div class="section-label">SELL ORE</div>
      ${itemsHtml}
      ${accountHtml}
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

    const depositBtn = document.getElementById('deposit-btn');
    if (depositBtn && depositBtn.classList.contains('buyable')) {
      depositBtn.addEventListener('click', () => {
        const amt = parseInt(depositBtn.dataset.amount, 10);
        if (player.money < amt) return;
        player.money       -= amt;
        player.bankBalance += amt;
        player.setMessage(`💳 Deposited $${amt} into bank account. Balance: $${player.bankBalance}`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    }

    const withdrawBtn = document.getElementById('withdraw-btn');
    if (withdrawBtn && withdrawBtn.classList.contains('buyable')) {
      withdrawBtn.addEventListener('click', () => {
        const amt = parseInt(withdrawBtn.dataset.amount, 10);
        if (player.bankBalance < amt) return;
        player.bankBalance -= amt;
        player.money       += amt;
        player.setMessage(`💸 Withdrew $${amt} from bank account. Balance: $${player.bankBalance}`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // House overlay (family mode)
  // -------------------------------------------------------------------------

  openHouse(player, onClose) {
    const taxAmount    = FAMILY_BASE_TAX
      + (player.houseLevel - 1) * FAMILY_TAX_PER_LEVEL;

    const supPct  = Math.round(player.suppliesMeter);
    const barFull = Math.round(supPct / 10);
    const supBar  = '█'.repeat(barFull) + '░'.repeat(10 - barFull);
    const supColor = supPct > 40 ? '#88cc44' : supPct > 15 ? '#f5c842' : '#ff4444';

    // House expand
    const canExpand      = player.houseLevel < HOUSE_MAX_LEVEL && player.money >= HOUSE_UPGRADE_COST;
    const maxLevel       = player.houseLevel >= HOUSE_MAX_LEVEL;
    const expandNote     = maxLevel ? ' <em>(maximum size reached)</em>'
      : player.money < HOUSE_UPGRADE_COST
        ? ` <em class="short">(need $${HOUSE_UPGRADE_COST - player.money} more)</em>` : '';
    const expandCls      = canExpand ? 'shop-item buyable' : 'shop-item disabled';

    // Baby
    const canHaveBaby    = player.babyCount < MAX_BABIES && player.money >= BABY_COST;
    const maxBabies      = player.babyCount >= MAX_BABIES;
    const babyNote       = maxBabies ? ' <em>(maximum babies reached)</em>'
      : player.money < BABY_COST
        ? ` <em class="short">(need $${BABY_COST - player.money} more)</em>` : '';
    const babyCls        = canHaveBaby ? 'shop-item buyable' : 'shop-item disabled';

    // Supplies refill
    const canRefill      = player.suppliesMeter < 100 && player.money >= SUPPLIES_REFILL_COST;
    const refillNote     = player.suppliesMeter >= 100 ? ' <em>(supplies full)</em>'
      : player.money < SUPPLIES_REFILL_COST
        ? ` <em class="short">(need $${SUPPLIES_REFILL_COST - player.money} more)</em>` : '';
    const refillCls      = canRefill ? 'shop-item buyable' : 'shop-item disabled';

    const houseEmoji = ['🏠', '🏡', '🏘️', '🏰'][Math.min(player.houseLevel - 1, 3)];
    const babyEmojis = ['👶', '👶👶', '👶👶👶', '👶👶👶👶'][Math.max(0, player.babyCount - 1)] || '—';

    this.overlay.innerHTML = `
      <div class="overlay-header">
        <h2>${houseEmoji} Your Home</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>
      <p style="font-size:0.88em;margin:2px 0 4px">
        House level: <strong>${player.houseLevel} / ${HOUSE_MAX_LEVEL}</strong>
        &nbsp;·&nbsp; Babies: <strong>${player.babyCount}</strong> ${player.babyCount > 0 ? babyEmojis : ''}
      </p>
      <p style="font-size:0.88em;margin:2px 0 8px">
        Taxes every 30 min: <span class="price">$${taxAmount}</span>
        <small style="color:#888"> (paid from bank account)</small>
      </p>

      <div class="section-label">SUPPLIES</div>
      <p style="font-size:0.88em;margin:4px 0 6px">
        👱‍♀️ <em>"We need food and supplies!"</em><br>
        Supplies: <strong style="color:${supColor}">[${supBar}] ${supPct}%</strong>
      </p>
      <div class="${refillCls}" id="refill-btn">
        🛒 Buy supplies (+${SUPPLIES_REFILL_AMOUNT}%) — <span class="price">$${SUPPLIES_REFILL_COST}</span>${refillNote}
      </div>

      <div class="section-label">EXPAND HOME</div>
      <div class="${expandCls}" id="expand-house-btn">
        🏠 Expand house (Level ${player.houseLevel} → ${player.houseLevel + 1}) — <span class="price">$${HOUSE_UPGRADE_COST}</span>${expandNote}
      </div>

      <div class="section-label">FAMILY</div>
      <div class="${babyCls}" id="baby-btn">
        👶 Have a baby (${player.babyCount}/${MAX_BABIES}) — <span class="price">$${BABY_COST}</span>${babyNote}
        <br><small>Each baby speeds up supply depletion.</small>
      </div>
    `;
    this._openOverlay(onClose);

    const refillBtn = document.getElementById('refill-btn');
    if (refillBtn && refillBtn.classList.contains('buyable')) {
      refillBtn.addEventListener('click', () => {
        if (player.money < SUPPLIES_REFILL_COST) return;
        player.money        -= SUPPLIES_REFILL_COST;
        player.suppliesMeter = Math.min(100, player.suppliesMeter + SUPPLIES_REFILL_AMOUNT);
        player.setMessage(`🛒 Supplies restocked! (${Math.round(player.suppliesMeter)}% full)`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    }

    const expandBtn = document.getElementById('expand-house-btn');
    if (expandBtn && expandBtn.classList.contains('buyable')) {
      expandBtn.addEventListener('click', () => {
        if (player.money < HOUSE_UPGRADE_COST || player.houseLevel >= HOUSE_MAX_LEVEL) return;
        player.money      -= HOUSE_UPGRADE_COST;
        player.houseLevel += 1;
        player.setMessage(`🏠 House expanded to level ${player.houseLevel}!`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    }

    const babyBtn = document.getElementById('baby-btn');
    if (babyBtn && babyBtn.classList.contains('buyable')) {
      babyBtn.addEventListener('click', () => {
        if (player.money < BABY_COST || player.babyCount >= MAX_BABIES) return;
        player.money     -= BABY_COST;
        player.babyCount += 1;
        player.setMessage(`👶 Baby #${player.babyCount} welcomed to the family!`);
        sounds.playTransaction();
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Family-mode game-over screens
  // -------------------------------------------------------------------------

  /** Helper – builds the "what you had" summary HTML. */
  _familyStatsHtml(stats) {
    const itemList = stats.items.length
      ? stats.items.join(' · ')
      : '—';
    const babies = stats.babyCount > 0
      ? '👶'.repeat(stats.babyCount)
      : 'none';
    return `
      <p style="font-size:0.82em;color:#aaa;margin:4px 0 0">
        💰 Cash: $${stats.cash}
        &nbsp;·&nbsp; 🏦 Bank: $${stats.bankBalance}
        &nbsp;·&nbsp; ⚖️ Net worth: <strong>$${stats.netWorth}</strong>
      </p>
      <p style="font-size:0.82em;color:#aaa;margin:2px 0">
        🎒 Ore carried: ${stats.gemCarried} (value $${stats.gemValue})
      </p>
      <p style="font-size:0.82em;color:#aaa;margin:2px 0">
        🏠 House level: ${stats.houseLevel} &nbsp;·&nbsp; Babies: ${babies}
      </p>
      <p style="font-size:0.82em;color:#aaa;margin:2px 0 6px">
        🧰 Items: ${itemList}
      </p>`;
  }

  showEviction(stats) {
    const timeHtml = stats.elapsedTime
      ? `<p class="overlay-time">Time: ${stats.elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🏚️</p>
        <h2 class="overlay-title" style="color:#ff4444">EVICTED!</h2>
        <p>You fell behind on your taxes and the bailiff came knocking.</p>
        <p style="color:#ff8888"><em>"Pack your things and get out."</em></p>
        ${timeHtml}
        ${this._familyStatsHtml(stats)}
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showDivorce(stats) {
    const timeHtml = stats.elapsedTime
      ? `<p class="overlay-time">Time: ${stats.elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💔</p>
        <h2 class="overlay-title" style="color:#ff4444">DIVORCED!</h2>
        <p>You let the supplies run dry for too long.</p>
        <p style="color:#ff8888"><em>"I can't do this anymore. The kids are hungry. We're done."</em></p>
        ${timeHtml}
        ${this._familyStatsHtml(stats)}
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------

  openDragons(onClose) {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🐉</p>
        <p class="overlay-title"><em>"There be dragons!"</em></p>
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
      <div class="overlay-header">
        <h2>🚽 Outhouse</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p style="text-align:center;font-size:2.5em;margin:24px 0 12px">🚽</p>
      <p style="text-align:center;font-size:0.95em"><em>"You feel relieved."</em></p>
      <div style="text-align:center;margin-top:20px">
        <button class="close-btn" id="new-game-btn" style="color:#ff8888;border-color:#aa3333">
          🗑️ New Game
        </button>
      </div>
    `;
    this._openOverlay(onClose);

    const newGameBtn = document.getElementById('new-game-btn');
    if (newGameBtn) {
      newGameBtn.addEventListener('click', () => {
        if (confirm('Start a new game? All progress will be lost.')) {
          Storage.clear();
          location.reload();
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // Item pickup overlay (non-ore items found in the mine)
  // -------------------------------------------------------------------------

  showItemPickup(emoji, message, onClose) {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">${emoji}</p>
        <p class="overlay-title">${message}</p>
        <button class="close-btn" id="overlay-close">
          OK
        </button>
      </div>`;
    this._openOverlay(onClose);
  }

  // -------------------------------------------------------------------------
  // "You were warned" game over screen (10 dragon warnings)
  // -------------------------------------------------------------------------

  showWarned(elapsedTime) {
    const timeHtml = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🐉</p>
        <h2 class="overlay-title" style="color:#ff4444">GAME OVER</h2>
        <p>You were warned.</p>
        ${timeHtml}
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
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
