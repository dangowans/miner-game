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
    this._showExtraInventory = false;
    this._lastHudPlayer = null;

    if (this._hudTools) {
      this._hudTools.addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-action="toggle-extra-inventory"]');
        if (!toggle) return;
        this._showExtraInventory = !this._showExtraInventory;
        if (this._lastHudPlayer) this.updateHUD(this._lastHudPlayer);
      });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlayOpen) this._closeOverlay();
    });
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  updateHUD(player) {
    this._lastHudPlayer = player;
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
    const extraTools = [];
    if (player.hasShovel)       tools.push('🪏');
    if (player.hasPick)         tools.push(`⛏×${player.pickUses}`);
    if (player.hasBucket)       tools.push(`🪣×${player.bucketUses}`);
    if (player.hasExtinguisher) tools.push(`🧯×${player.extinguisherUses}`);
    if (player.hasBag)          tools.push('🎒×2');
    if (player.hasLantern)      tools.push('🔦');
    if (player.hasFlower)       tools.push('🌸');
    if (player.hasRing)         tools.push('💍');
    if (player.hasRadio)        tools.push('📻');
    if (player.hasDowsingRod)   tools.push('🪄');
    if (player.hasHeatVision)   tools.push('🥽');
    if (player.treasureMapDepth > 0) tools.push(`🗺️${player.treasureMapDepth}m`);
    if (player.genieWishes > 0) tools.push(`🧞×${player.genieWishes}`);
    if (player.specialItems.has('rubber_boot'))  tools.push('🥾');
    if (player.specialItems.has('helmet'))       tools.push('⛑️');
    if (player.specialItems.has('armor'))        tools.push('🪬');
    if (player.specialItems.has('shield'))       tools.push('🛡️');
    if (player.specialItems.has('sword'))        tools.push('⚔️');

    if (player.specialItems.has('pocket_watch')) extraTools.push('⌚');
    if (player.specialItems.has('glasses'))      extraTools.push('🕶️');
    if (player.specialItems.has('skull'))        extraTools.push('💀');
    if (player.specialItems.has('canteen'))      extraTools.push('🧴');
    if (player.specialItems.has('lunchbox'))     extraTools.push('🍱');
    if (player.specialItems.has('tin_can'))      extraTools.push('🥫');
    if (player.specialItems.has('cash_bag'))     extraTools.push('💰');
    if (player.specialItems.has('scroll'))       extraTools.push('📜');
    if (player.specialItems.has('fossil'))       extraTools.push('🦴');
    if (player.specialItems.has('newspaper'))    extraTools.push('📰');
    if (player.specialItems.has('broken_chain')) extraTools.push('⛓️');
    if (player.specialItems.has('old_coin'))     extraTools.push('🪙');
    if (player.specialItems.has('bottle'))       extraTools.push('🍾');
    if (player.necklaceCount > 0)                tools.push(`📿×${player.necklaceCount}`);
    if (player.dynamiteCount > 0) {
      tools.push(player.placingDynamite
        ? `💣×${player.dynamiteCount} [PLACING]`
        : `💣×${player.dynamiteCount}`);
    }
    if (player.drillCount > 0) tools.push(`🛠️×${player.drillCount}`);
    if (player.firstAidKits > 0) tools.push(`🩹×${player.firstAidKits}`);

    // Bank balance — show whenever the mine cart has been purchased
    if (player.hasMineCart && !player.familyMode) {
      tools.push(`| 🏦$${player.bankBalance}`);
    }

    // Family mode status (appended to tool row)
    if (player.familyMode) {
      const supPct  = Math.round(player.suppliesMeter);
      const barFull = Math.round(supPct / 10);
      const supBar  = '█'.repeat(barFull) + '░'.repeat(10 - barFull);
      const foodIcon = player.babyCount > 0 ? '🍼' : '🍞';
      tools.push(`| 🏦$${player.bankBalance} ${foodIcon}[${supBar}]${supPct}%`);
    }

    const toolsText = tools.join(' ');
    this._hudTools.textContent = toolsText;
    if (extraTools.length > 0) {
      const expanded = this._showExtraInventory;
      const titleText = expanded ? 'Hide extra items' : 'Show extra items';
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'hud-ellipsis-toggle';
      toggleBtn.dataset.action = 'toggle-extra-inventory';
      toggleBtn.title = titleText;
      toggleBtn.setAttribute('aria-label', titleText);
      toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggleBtn.textContent = '…';
      this._hudTools.appendChild(document.createTextNode(' '));
      this._hudTools.appendChild(toggleBtn);

      if (expanded) {
        const extraSpan = document.createElement('span');
        extraSpan.className = 'hud-extra-items';
        extraSpan.textContent = extraTools.join(' ');
        this._hudTools.appendChild(document.createTextNode(' '));
        this._hudTools.appendChild(extraSpan);
      }
    }

    // Dynamite button: enabled only when the player has dynamite
    if (this._btnDynamite) {
      this._btnDynamite.disabled = player.dynamiteCount === 0 && !player.placingDynamite;
      this._btnDynamite.textContent = player.placingDynamite ? '✕💣' : '💣';
      this._btnDynamite.style.borderColor = player.placingDynamite ? '#ff6600' : '';
    }

    const btnDrill = document.getElementById('btn-drill');
    if (btnDrill) {
      btnDrill.disabled = player.drillCount <= 0 || player.y < 3;
    }

    // First Aid Kit button: enabled when kits are in stock
    const btnFirstAid = document.getElementById('btn-firstaid');
    if (btnFirstAid) {
      btnFirstAid.disabled = player.firstAidKits <= 0 || player.hearts >= player.maxHearts;
    }

    // Mine Cart button: visible when purchased, enabled when carrying ore
    const btnMineCart = document.getElementById('btn-minecart');
    if (btnMineCart) {
      btnMineCart.style.display = player.hasMineCart ? '' : 'none';
      btnMineCart.disabled = !player.hasMineCart || player.gemCount === 0;
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
      const drillCount     = item.id === 'drill'     ? player.drillCount     : null;
      const firstAidCount  = item.id === 'firstaid'  ? player.firstAidKits   : null;
      const affordable = player.money >= item.price;
      // Dynamite is never "owned once" — can always buy more if affordable
      // Same for first aid kits
      const buyable    = (item.id === 'dynamite' || item.id === 'drill' || item.id === 'firstaid') ? affordable : (!owned && affordable);
      const cls        = buyable ? 'shop-item buyable' : 'shop-item disabled';
      const stockNote  = (count) => count > 0 ? ` <em>(×${count} in stock)</em>` : '';
      const needNote   = !affordable ? ` <em class="short">(need $${item.price - player.money} more)</em>` : '';
      let note;
      if (item.id === 'dynamite') {
        note = stockNote(dynamiteCount) + needNote;
      } else if (item.id === 'drill') {
        note = stockNote(drillCount) + needNote;
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
        else if (id === 'drill')       { player.drillCount++; }
        else if (id === 'firstaid')    { player.firstAidKits++; }
        const itemName = (SHOP_ITEMS.find(i => i.id === id) || {}).name || id;
        player.setMessage(`Bought: ${itemName}!`);
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
        <p class="bar-girl">👱‍♀️ <em>${line}</em></p>`;

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
        <p class="hint">Rumour has it, a man dropped an engagement ring in the outhouse 50 or so years ago. I wonder if it's still down there?</p>`;

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

  showDead(elapsedTime, stats = null, onGenieWish = null) {
    const timeHtml  = elapsedTime ? `<p class="overlay-time">Time: ${elapsedTime}</p>` : '';
    const statsHtml = stats ? this._familyStatsHtml(stats) : `
        <p class="overlay-tip">
          Tip: visit the Doctor to increase your max hearts.
        </p>`;
    const { html: genieHtml, wireup: genieWireup } = this._genieWishParts(onGenieWish);
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💀</p>
        <h2 class="overlay-title" style="color:#ff4444">YOU DIED</h2>
        <p>The mine claimed another victim.</p>
        ${timeHtml}
        ${statsHtml}
        ${genieHtml}
        <button class="close-btn" id="dead-restart-btn"${onGenieWish ? ' style="margin-top:4px"' : ''}>
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
    genieWireup();
    const restartBtn = document.getElementById('dead-restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', () => { Storage.clear(); location.reload(); });
  }

  showPoliceArrest(elapsedTime, stats = null) {
    const timeHtml  = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    const statsHtml = stats ? this._familyStatsHtml(stats) : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">👮</p>
        <h2 class="overlay-title" style="color:#ff4444">BUSTED!</h2>
        <p>You set off dynamite in town! A police officer arrested you on the spot.</p>
        ${timeHtml}
        ${statsHtml}
        <button class="close-btn" onclick="location.reload()">
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
  }

  showMineCollapse(elapsedTime, stats = null) {
    const timeHtml  = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    const statsHtml = stats ? this._familyStatsHtml(stats) : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">⛏️💥</p>
        <h2 class="overlay-title" style="color:#ff4444">MINE COLLAPSE!</h2>
        <p>The blast reached the surface and caused a catastrophic mine collapse. You didn't make it out.</p>
        ${timeHtml}
        ${statsHtml}
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
        return `<div class="shop-item disabled ore-row">
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

    // Bank account section — visible when mine cart is owned or in family mode
    let accountHtml = '';
    if (player.familyMode || player.hasMineCart) {
      const depositStep  = 50;
      const canDeposit   = player.familyMode && player.money >= depositStep;
      const canWithdraw  = player.familyMode && player.bankBalance >= depositStep;
      const depositCls   = canDeposit  ? 'shop-item buyable' : 'shop-item disabled';
      const withdrawCls  = canWithdraw ? 'shop-item buyable' : 'shop-item disabled';
      const depositNote  = canDeposit  ? '' : player.familyMode ? ` <em class="short">(need $${depositStep - player.money} more)</em>` : '';
      const withdrawNote = canWithdraw ? '' : player.familyMode ? ` <em class="short">(balance too low)</em>` : '';
      const balanceNote  = player.familyMode
        ? '<small style="color:#888"> — taxes are debited from here automatically</small>'
        : '<small style="color:#888"> — mine cart deposits go here</small>';
      accountHtml = `
        <div class="section-label">BANK ACCOUNT</div>
        <p style="font-size:0.88em;margin:4px 0 8px">
          Account balance: <strong style="color:#f5c842">$${player.bankBalance}</strong>
          ${balanceNote}
        </p>
        ${player.familyMode ? `
        <div class="${depositCls}" id="deposit-btn" data-amount="${depositStep}">
          💳 Deposit $${depositStep}${depositNote}
        </div>
        <div class="${withdrawCls}" id="withdraw-btn" data-amount="${depositStep}">
          💸 Withdraw $${depositStep}${withdrawNote}
        </div>` : ''}`;
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
  // Contractor Mike overlay
  // -------------------------------------------------------------------------

  openWorker(player, { onClose, onBuildElevator, onExpandElevatorDepth, onExpandHouse, onBuyMineCart }) {
    const canExpand   = player.houseLevel < HOUSE_MAX_LEVEL && player.money >= HOUSE_UPGRADE_COST;
    const maxLevel    = player.houseLevel >= HOUSE_MAX_LEVEL;
    const expandNote  = maxLevel ? ' <em>(maximum size reached)</em>'
      : player.money < HOUSE_UPGRADE_COST
        ? ` <em class="short">(need $${HOUSE_UPGRADE_COST - player.money} more)</em>` : '';
    const expandCls   = (canExpand && player.familyMode) ? 'shop-item buyable' : 'shop-item disabled';
    const expandAvail = player.familyMode ? '' : ' <em>(available in family mode)</em>';

    const elevatorAlready = player.hasElevator;
    const canElevator     = !elevatorAlready && player.money >= ELEVATOR_COST;
    const elevatorNote    = elevatorAlready ? ' <em>(already built)</em>'
      : player.money < ELEVATOR_COST
        ? ` <em class="short">(need $${ELEVATOR_COST - player.money} more)</em>` : '';
    const elevatorCls     = canElevator ? 'shop-item buyable' : 'shop-item disabled';

    // ── Depth expansion tiers (only when elevator is built) ────────────────
    let depthSectionHtml = '';
    if (player.hasElevator) {
      let tiersHtml = '';
      // Iterate purchasable tiers: 150 m, 200 m, … up to ELEVATOR_DEPTH_MAX.
      // Tiers start one increment above the base (MAX_MINE_DEPTH + ELEVATOR_DEPTH_INCREMENT).
      for (let d = MAX_MINE_DEPTH + ELEVATOR_DEPTH_INCREMENT; d <= ELEVATOR_DEPTH_MAX; d += ELEVATOR_DEPTH_INCREMENT) {
        if (player.unlockedDepth >= d) {
          tiersHtml += `<div class="shop-item disabled">✅ ${d} m <em>(unlocked)</em></div>`;
        } else if (player.unlockedDepth === d - ELEVATOR_DEPTH_INCREMENT) {
          const canBuy = player.money >= ELEVATOR_DEPTH_COST;
          const depthNote = canBuy ? '' : ` <em class="short">(need $${ELEVATOR_DEPTH_COST - player.money} more)</em>`;
          const depthCls  = canBuy ? 'shop-item buyable' : 'shop-item disabled';
          tiersHtml += `<div class="${depthCls}" id="worker-depth-btn">
            ⛏ Expand mine to ${d} m — <span class="price">$${ELEVATOR_DEPTH_COST}</span>${depthNote}
            <br><small>Unlocks deeper ore and extends the elevator shaft.</small>
          </div>`;
        } else {
          tiersHtml += `<div class="shop-item disabled">🔒 ${d} m <em>(unlock previous tier first)</em></div>`;
        }
      }
      depthSectionHtml = `
        <div class="section-label">MINE DEPTH EXPANSION</div>
        <p style="font-size:0.85em;margin:2px 0 6px">Current depth limit: <strong>${player.unlockedDepth} m</strong></p>
        ${tiersHtml}`;
    }

    // ── Mine Cart ──────────────────────────────────────────────────────────
    const cartAlready = player.hasMineCart;
    const canCart     = !cartAlready && player.money >= MINE_CART_COST;
    const cartNote    = cartAlready ? ' <em>(already owned)</em>'
      : player.money < MINE_CART_COST
        ? ` <em class="short">(need $${MINE_CART_COST - player.money} more)</em>` : '';
    const cartCls     = canCart ? 'shop-item buyable' : 'shop-item disabled';

    this.overlay.innerHTML = `
      <div class="overlay-header">
        <h2>🏗️ Contractor Mike</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p class="shop-balance">Your money: <strong>$${player.money}</strong></p>

      <div class="section-label">HOME EXPANSION</div>
      <div class="${expandCls}" id="worker-expand-btn">
        🏠 Expand house (Level ${player.houseLevel} → ${player.houseLevel + 1}) — <span class="price">$${HOUSE_UPGRADE_COST}</span>${expandNote}${expandAvail}
      </div>

      <div class="section-label">ELEVATOR</div>
      <div class="${elevatorCls}" id="worker-elevator-btn">
        🛗 Build elevator shaft (right mine entrance column) — <span class="price">$${ELEVATOR_COST}</span>${elevatorNote}
        <br><small>Digs a shaft in the rightmost mine column. Entry points every 5 m. $${ELEVATOR_RIDE_COST}/ride.</small>
      </div>
      ${depthSectionHtml}

      <div class="section-label">MINE CART</div>
      <div class="${cartCls}" id="worker-cart-btn">
        🚃 Mine cart — <span class="price">$${MINE_CART_COST}</span>${cartNote}
        <br><small>Press 🚃 (or C) to send all carried ore to your bank value instantly for $${MINE_CART_SEND_COST} — requires a clear path to the mine exit (no water or lava blocking the way; cannot use elevator).</small>
      </div>
    `;
    this._openOverlay(onClose);

    const expandBtn = document.getElementById('worker-expand-btn');
    if (expandBtn && expandBtn.classList.contains('buyable')) {
      expandBtn.addEventListener('click', () => {
        if (!player.familyMode || player.money < HOUSE_UPGRADE_COST || player.houseLevel >= HOUSE_MAX_LEVEL) return;
        player.money      -= HOUSE_UPGRADE_COST;
        player.houseLevel += 1;
        player.setMessage(`🏠 House expanded to level ${player.houseLevel}!`);
        sounds.playTransaction();
        if (onExpandHouse) onExpandHouse(player.houseLevel);
        this._closeOverlay();
      });
    }

    const elevatorBtn = document.getElementById('worker-elevator-btn');
    if (elevatorBtn && elevatorBtn.classList.contains('buyable')) {
      elevatorBtn.addEventListener('click', () => {
        if (player.hasElevator || player.money < ELEVATOR_COST) return;
        this._closeOverlay();
        if (onBuildElevator) onBuildElevator();
      });
    }

    const depthBtn = document.getElementById('worker-depth-btn');
    if (depthBtn && depthBtn.classList.contains('buyable')) {
      depthBtn.addEventListener('click', () => {
        if (player.money < ELEVATOR_DEPTH_COST) return;
        this._closeOverlay();
        if (onExpandElevatorDepth) onExpandElevatorDepth();
      });
    }

    const cartBtn = document.getElementById('worker-cart-btn');
    if (cartBtn && cartBtn.classList.contains('buyable')) {
      cartBtn.addEventListener('click', () => {
        if (player.hasMineCart || player.money < MINE_CART_COST) return;
        player.money       -= MINE_CART_COST;
        player.hasMineCart  = true;
        player.setMessage('🚃 Mine cart purchased! Press 🚃 (or C) to send ore to the bank.');
        sounds.playTransaction();
        if (onBuyMineCart) onBuyMineCart();
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

    const houseEmoji = ['🏠', '🏡', '🏘️', '🏰'][Math.min(player.houseLevel - 1, 3)];
    const babyEmojis = player.babyCount > 0
      ? '👶'.repeat(Math.min(player.babyCount, 10))
      : '—';

    let foodSectionHtml;
    if (player.slayedDragon) {
      // Dragon slayed: lifetime supply — no buy button needed
      foodSectionHtml = `
      <div class="section-label">FOOD</div>
      <p style="font-size:0.88em;margin:4px 0 6px">
        👱‍♀️ <em>"We have a lifetime supply of meat! You slayed the beast — I'll never worry about food again!"</em><br>
        Supplies: <strong style="color:#88cc44">[██████████] 100% ∞</strong>
      </p>`;
    } else {
      // Normal food section
      const foodLabel      = player.babyCount > 0 ? 'food and diapers' : 'food';
      const foodLabelCap   = player.babyCount > 0 ? 'Food & diapers'   : 'Food';
      const canRefill      = player.suppliesMeter < 100 && player.money >= SUPPLIES_REFILL_COST;
      const refillNote     = player.suppliesMeter >= 100 ? ` <em>(${foodLabel} fully stocked)</em>`
        : player.money < SUPPLIES_REFILL_COST
          ? ` <em class="short">(need $${SUPPLIES_REFILL_COST - player.money} more)</em>` : '';
      const refillCls      = canRefill ? 'shop-item buyable' : 'shop-item disabled';

      const wifeMsg = supPct > 50
        ? `"You're such a great provider. We have plenty of ${foodLabel}!"`
        : `"We need more ${foodLabel}!"`;

      foodSectionHtml = `
      <div class="section-label">${player.babyCount > 0 ? 'FOOD &amp; DIAPERS' : 'FOOD'}</div>
      <p style="font-size:0.88em;margin:4px 0 6px">
        👱‍♀️ <em>${wifeMsg}</em><br>
        ${foodLabelCap}: <strong style="color:${supColor}">[${supBar}] ${supPct}%</strong>
      </p>
      <div class="${refillCls}" id="refill-btn">
        🛒 Buy ${foodLabel} (+${SUPPLIES_REFILL_AMOUNT}%) — <span class="price">$${SUPPLIES_REFILL_COST}</span>${refillNote}
      </div>`;
    }

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
      ${foodSectionHtml}

      <div class="section-label">FAMILY</div>
      <p style="font-size:0.88em;margin:4px 0 6px">
        Babies: <strong>${player.babyCount}</strong>
        ${player.babyCount > 0 ? babyEmojis : ''}
      </p>
    `;
    this._openOverlay(onClose);

    const refillBtn = document.getElementById('refill-btn');
    if (refillBtn && refillBtn.classList.contains('buyable')) {
      const foodLabel = player.babyCount > 0 ? 'food and diapers' : 'food';
      refillBtn.addEventListener('click', () => {
        if (player.money < SUPPLIES_REFILL_COST) return;
        const wasAlreadyFull = player.suppliesMeter + SUPPLIES_REFILL_AMOUNT > 100;
        player.money        -= SUPPLIES_REFILL_COST;
        player.suppliesMeter = Math.min(100, player.suppliesMeter + SUPPLIES_REFILL_AMOUNT);
        if (wasAlreadyFull) {
          player.setMessage(`👱‍♀️ "What? You think we're made of money?!"`);
        } else {
          player.setMessage(`🛒 Stocked up on ${foodLabel}! (${Math.round(player.suppliesMeter)}% full)`);
        }
        sounds.playTransaction();
        this._closeOverlay();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Family-mode game-over screens
  // -------------------------------------------------------------------------

  /**
   * Helper – builds the "Genie, I wish to continue" button HTML and wires its
   * click handler after the overlay is rendered.  Returns [html, wireup] where
   * wireup() should be called once after innerHTML is set.
   */
  _genieWishParts(onGenieWish) {
    if (!onGenieWish) return { html: '', wireup: () => {} };
    const html = `
      <button class="close-btn" id="genie-wish-btn" style="border-color:#f5c842;color:#f5c842">
        🧞 Genie, I wish to continue
      </button>`;
    const wireup = () => {
      const btn = document.getElementById('genie-wish-btn');
      if (btn) btn.addEventListener('click', () => { this._closeOverlay(); onGenieWish(); });
    };
    return { html, wireup };
  }

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

  showEviction(stats, onGenieWish = null) {
    const timeHtml = stats.elapsedTime ? `<p class="overlay-time">Time: ${stats.elapsedTime}</p>` : '';
    const { html: genieHtml, wireup: genieWireup } = this._genieWishParts(onGenieWish);
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🏚️</p>
        <h2 class="overlay-title" style="color:#ff4444">EVICTED!</h2>
        <p>You fell behind on your taxes and the bailiff came knocking.</p>
        <p style="color:#ff8888"><em>"Pack your things and get out."</em></p>
        ${timeHtml}
        ${this._familyStatsHtml(stats)}
        ${genieHtml}
        <button class="close-btn" id="eviction-restart-btn"${onGenieWish ? ' style="margin-top:4px"' : ''}>
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
    genieWireup();
    const restartBtn = document.getElementById('eviction-restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', () => { Storage.clear(); location.reload(); });
  }

  showDivorce(stats, onGenieWish = null) {
    const timeHtml = stats.elapsedTime ? `<p class="overlay-time">Time: ${stats.elapsedTime}</p>` : '';
    const { html: genieHtml, wireup: genieWireup } = this._genieWishParts(onGenieWish);
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">💔</p>
        <h2 class="overlay-title" style="color:#ff4444">DIVORCED!</h2>
        <p>You let the food run out for too long.</p>
        <p style="color:#ff8888"><em>"I can't do this anymore. The kids are hungry. We're done."</em></p>
        <p style="color:#ff8888"><em>"I'm moving in with Contractor Mike."</em></p>
        ${timeHtml}
        ${this._familyStatsHtml(stats)}
        ${genieHtml}
        <button class="close-btn" id="divorce-restart-btn"${onGenieWish ? ' style="margin-top:4px"' : ''}>
          🔄 Try Again
        </button>
      </div>`;
    this._openOverlay(() => {});
    genieWireup();
    const restartBtn = document.getElementById('divorce-restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', () => { Storage.clear(); location.reload(); });
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------

  openDragons(slayedDragon, onClose) {
    if (slayedDragon) {
      this.overlay.innerHTML = `
        <div class="overlay-centered">
          <p class="overlay-emoji">🐉⚔️</p>
          <p class="overlay-title" style="color:#f5c842"><em>"You slayed the enormous beast!"</em></p>
          <p style="color:#88cc44"><em>"You have a lifetime supply of meat!"</em></p>
          <button class="close-btn" id="overlay-close" style="border-color:#f5c842;color:#f5c842">
            Turn Back (Victorious)
          </button>
        </div>`;
    } else {
      this.overlay.innerHTML = `
        <div class="overlay-centered">
          <p class="overlay-emoji">🐉</p>
          <p class="overlay-title"><em>"There be dragons!"</em></p>
          <button class="close-btn" id="overlay-close">
            Turn Back
          </button>
        </div>`;
    }
    this._openOverlay(onClose);
  }

  // -------------------------------------------------------------------------
  // Outhouse overlay (settings menu)
  openOuthouse({ familyUnlocked, onClose, onEarthquake, onJumpFamily }) {
    const familyBtn = familyUnlocked
      ? `<div class="shop-item buyable" id="jump-family-btn" style="border-color:#f5c842;color:#f5c842">
           👨‍👩‍👧‍👦 Jump to Family Mode
           <br><small>Start a new game already in family mode</small>
         </div>`
      : '';

    this.overlay.innerHTML = `
      <div class="overlay-header">
        <h2>🚽 Outhouse</h2>
        <button class="close-btn" id="overlay-close">✕ &nbsp;<kbd>Esc</kbd></button>
      </div>
      <p style="text-align:center;font-size:2.5em;margin:16px 0 4px">🚽</p>
      <p style="text-align:center;font-size:0.95em;margin:0 0 16px"><em>"You feel relieved."</em></p>

      <div class="section-label">SETTINGS</div>

      <div class="shop-item buyable" id="earthquake-btn">
        🌋 Earthquake
        <br><small>Refill the mine with fresh dirt and minerals</small>
      </div>

      <div class="section-label">DANGER ZONE</div>

      <div class="shop-item buyable" id="new-game-btn" style="border-color:#aa3333;color:#ff8888">
        🗑️ New Game
        <br><small>Erase all progress and start over</small>
      </div>

      ${familyBtn}
    `;
    this._openOverlay(onClose);

    const earthquakeBtn = document.getElementById('earthquake-btn');
    if (earthquakeBtn) {
      earthquakeBtn.addEventListener('click', () => {
        if (confirm('Trigger an earthquake? All minerals and items in the mine will be replaced.')) {
          this._closeOverlay();
          if (onEarthquake) onEarthquake();
        }
      });
    }

    const jumpFamilyBtn = document.getElementById('jump-family-btn');
    if (jumpFamilyBtn) {
      jumpFamilyBtn.addEventListener('click', () => {
        if (confirm('Jump straight to Family Mode? Current progress will be lost.')) {
          if (onJumpFamily) onJumpFamily();
        }
      });
    }

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

  showElevatorRidePrompt(cost, onPay, onDecline) {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🛗</p>
        <p class="overlay-title">Use the elevator?</p>
        <p style="font-size:0.9em">Ride the elevator — <strong>$${cost}</strong> per boarding.</p>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:12px">
          <button class="close-btn" id="elevator-pay-btn">✅ Pay $${cost}</button>
          <button class="close-btn" id="elevator-decline-btn">❌ No thanks</button>
        </div>
      </div>`;
    // Esc / close = decline
    this._openOverlay(() => { if (onDecline) onDecline(); });

    document.getElementById('elevator-pay-btn').addEventListener('click', () => {
      // Prevent the default _onCloseCallback from calling onDecline
      this._onCloseCallback = null;
      this._closeOverlay();
      if (onPay) onPay();
    });
    document.getElementById('elevator-decline-btn').addEventListener('click', () => {
      this._closeOverlay();
    });
  }

  showMineCartSendPrompt(cost, onPay, onDecline) {
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🚃</p>
        <p class="overlay-title">Send the mine cart?</p>
        <p style="font-size:0.9em">Send this load to the bank for <strong>$${cost}</strong>?</p>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:12px">
          <button class="close-btn" id="minecart-pay-btn">✅ Pay $${cost}</button>
          <button class="close-btn" id="minecart-decline-btn">❌ No thanks</button>
        </div>
      </div>`;
    this._openOverlay(() => { if (onDecline) onDecline(); });

    document.getElementById('minecart-pay-btn').addEventListener('click', () => {
      this._onCloseCallback = null;
      this._closeOverlay();
      if (onPay) onPay();
    });
    document.getElementById('minecart-decline-btn').addEventListener('click', () => {
      this._closeOverlay();
    });
  }

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

  showWarned(elapsedTime, stats = null) {
    const timeHtml  = elapsedTime
      ? `<p class="overlay-time">Time: ${elapsedTime}</p>`
      : '';
    const statsHtml = stats ? this._familyStatsHtml(stats) : '';
    this.overlay.innerHTML = `
      <div class="overlay-centered">
        <p class="overlay-emoji">🐉</p>
        <h2 class="overlay-title" style="color:#ff4444">GAME OVER</h2>
        <p>You were warned.</p>
        ${timeHtml}
        ${statsHtml}
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
