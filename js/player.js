'use strict';

/**
 * Player – all mutable player state.
 *
 * Health system:
 *   - Starts with START_HEARTS (3) hearts out of START_HEARTS max.
 *   - Walking into a hazard tile (lava / water) costs 1 heart.
 *   - Hearts reach 0 → dead.
 *   - Visit the Doctor on the surface to restore hearts (HEAL_PRICE per heart).
 *   - Also buy additional max-heart slots (EXTRA_HEART_PRICE each, up to MAX_HEARTS=6).
 *
 * Tool durability:
 *   - Pick, bucket, and fire extinguisher each last TOOL_USES uses.
 *   - When uses reach 0 the tool breaks (hasTool → false) and must be replaced.
 */
class Player {
  constructor() {
    this.x = PLAYER_START_X;
    this.y = PLAYER_START_Y;

    // Economy
    this.money   = 0;
    this.gems    = [];      // Array of HIDDEN.GEM_* strings currently carried
    this.maxGems = 10;      // Inventory cap (20 with large bag)

    // Tools / one-time upgrades
    this.hasShovel      = false;
    this.hasPick        = false;   // Breaks stone blocks (TOOL_USES uses)
    this.hasBucket      = false;   // Clears spread water (TOOL_USES uses; not spring source)
    this.hasExtinguisher = false;  // Converts lava to stone (TOOL_USES uses)
    this.hasBag         = false;
    this.hasRing        = false;
    this.drinksBought   = 0;
    this.dynamiteCount  = 0;       // Sticks of dynamite owned
    this.placingDynamite = false;  // True while in dynamite-placement mode

    // Tool durability (remaining uses before the tool breaks)
    this.pickUses         = 0;
    this.bucketUses       = 0;
    this.extinguisherUses = 0;

    // Elevator state

    // Unique novelty items found in the mine (rubber boot, pocket watch, glasses)
    this.specialItems = new Set();

    // Unique key items
    this.hasLantern    = false;   // Enables adjacent dirt probing when true
    this.hasFlower     = false;   // Flower collected from the surface
    this.hasGivenFlower = false;  // True once the flower has been given to the bar girl
    this.hasRadio      = false;   // Radio found in the mine – teleports to mine entrance

    // Consumable items
    this.firstAidKits  = 0;       // First Aid Kits in inventory (bought at shop)

    // Health
    this.hearts    = START_HEARTS;
    this.maxHearts = START_HEARTS;

    // State flags
    this.dead = false;
    this.won  = false;

    // Family-mode state
    this.familyMode     = false;
    this.bankBalance    = 0;     // Bank account balance (separate from cash)
    this.babyCount      = 0;     // Number of babies
    this.houseLevel     = 1;     // House expansion level (1 = base)
    this.suppliesMeter  = 100;   // Household supplies 0–100 %
    this.necklaceCount  = 0;     // Necklaces found in the mine (deliver at home for a baby)
    this.hasElevator    = false; // True once the elevator shaft has been built
    this.inElevator     = false; // True while the player is riding in the elevator cabin
    this.unlockedDepth  = MAX_MINE_DEPTH; // Mine depth limit in metres (expandable)

    // HUD message
    this.message      = '';
    this.messageTimer = 0;

    // Invincibility frames after taking damage (prevents multi-hit)
    this.iFrames = 0;

    // Ore-collect flash (coloured highlight drawn behind the player sprite)
    this.collectFlash      = 0;
    this.collectFlashColor = '#ffffff';
  }

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  /**
   * Probe-threshold reduction applied to dirt tiles.
   * Only the shovel reduces digging effort; the pick is for stone only.
   */
  get toolReduction() {
    return this.hasShovel ? SHOVEL_REDUCTION : 0;
  }

  get gemCount() { return this.gems.length; }

  canCarry() { return this.gems.length < this.maxGems; }

  /** Current mine depth (0 = surface). */
  get depth() { return Math.max(0, this.y); }

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------

  addGem(gemType) {
    if (this.canCarry()) { this.gems.push(gemType); return true; }
    return false;
  }

  /** Sell all carried gems; returns coins earned. */
  sellGems() {
    let total = 0;
    for (const g of this.gems) total += GEM_VALUE[g] || 0;
    this.money += total;
    this.gems   = [];
    return total;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /**
   * Apply 1 point of hazard damage.
   * Returns true if the player just died.
   * iFrames is set for the blink animation only; damage is not gated by it
   * because hazard hits only occur on explicit player moves (never passively).
   */
  takeDamage() {
    this.hearts  = Math.max(0, this.hearts - 1);
    this.iFrames = INVINCIBILITY_FRAMES;   // Blink timer – visual feedback only
    if (this.hearts <= 0) { this.dead = true; return true; }
    return false;
  }

  /**
   * Apply multiple points of damage at once (e.g. dynamite blast).
   * Returns true if the player just died.
   */
  takeDamageMultiple(n) {
    this.hearts  = Math.max(0, this.hearts - n);
    this.iFrames = INVINCIBILITY_FRAMES;
    if (this.hearts <= 0) { this.dead = true; return true; }
    return false;
  }

  /**
   * Heal at the Doctor; costs HEAL_PRICE per heart.
   * Restores as many hearts as the player can afford (up to maxHearts).
   * Returns the number of hearts actually restored.
   */
  heal() {
    const missing    = this.maxHearts - this.hearts;
    if (missing <= 0) return 0;
    const affordable = Math.floor(this.money / HEAL_PRICE);
    const toHeal     = Math.min(missing, affordable);
    if (toHeal <= 0) return 0;
    this.hearts += toHeal;
    this.money  -= toHeal * HEAL_PRICE;
    return toHeal;
  }

  /**
   * Purchase one extra maximum-heart slot from the Doctor.
   * Returns true on success.
   */
  buyExtraHeart() {
    if (this.maxHearts >= MAX_HEARTS)        return false;
    if (this.money     <  EXTRA_HEART_PRICE) return false;
    this.money    -= EXTRA_HEART_PRICE;
    this.maxHearts++;
    this.hearts++;    // Grant the new heart filled
    return true;
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  setMessage(msg, duration = 200) {
    this.message      = msg;
    this.messageTimer = duration;
  }

  /**
   * Trigger a brief coloured flash behind the player sprite when ore is collected.
   * @param {string} color - CSS colour string matching the ore type
   */
  triggerCollectFlash(color) {
    this.collectFlash      = COLLECT_FLASH_FRAMES;
    this.collectFlashColor = color;
  }

  /** Call once per game tick. */
  tick() {
    if (this.messageTimer > 0) {
      this.messageTimer--;
      if (this.messageTimer === 0) this.message = '';
    }
    if (this.iFrames     > 0) this.iFrames--;
    if (this.collectFlash > 0) this.collectFlash--;
  }
}
