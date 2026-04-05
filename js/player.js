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

    // Tool durability (remaining uses before the tool breaks)
    this.pickUses         = 0;
    this.bucketUses       = 0;
    this.extinguisherUses = 0;

    // Elevator state
    this.elevatorCalled = false;  // True after paying the call fee
    this._elevatorRode  = false;  // Internal flag: set true when ride completed

    // Unique novelty items found in the mine (rubber boot, pocket watch, glasses)
    this.specialItems = new Set();

    // Health
    this.hearts    = START_HEARTS;
    this.maxHearts = START_HEARTS;

    // State flags
    this.dead = false;
    this.won  = false;

    // HUD message
    this.message      = '';
    this.messageTimer = 0;

    // Invincibility frames after taking damage (prevents multi-hit)
    this.iFrames = 0;
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

  /** Call once per game tick. */
  tick() {
    if (this.messageTimer > 0) {
      this.messageTimer--;
      if (this.messageTimer === 0) this.message = '';
    }
    if (this.iFrames > 0) this.iFrames--;
  }
}
