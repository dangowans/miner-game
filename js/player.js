'use strict';

/**
 * Player – holds all mutable player state.
 *
 * Health:
 *   - Starts with START_HEARTS hearts (default 3).
 *   - Lose 1 heart when stepping on a hazard (lava or water that spreads).
 *   - Die when hearts reach 0.
 *   - Heal at the Doctor (costs HEAL_PRICE per heart restored).
 *   - Buy extra max hearts at the Doctor (costs EXTRA_HEART_PRICE, up to MAX_HEARTS).
 */
class Player {
  constructor() {
    this.x = PLAYER_START_X;
    this.y = PLAYER_START_Y;

    // Economy
    this.money   = 0;
    this.gems    = [];      // Array of HIDDEN.GEM_* strings currently carried
    this.maxGems = 10;      // Inventory cap

    // Tools / upgrades
    this.hasShovel = false;
    this.hasPick   = false;
    this.hasBag    = false;
    this.hasRing   = false;

    // Health
    this.hearts    = START_HEARTS;
    this.maxHearts = START_HEARTS;

    // State flags
    this.dead = false;
    this.won  = false;

    // Temporary status message shown in the HUD
    this.message      = '';
    this.messageTimer = 0;

    // Invincibility frames after taking damage (prevents multi-hit from same hazard)
    this.iFrames = 0;
  }

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  /** Total probe-threshold reduction from owned tools. */
  get toolReduction() {
    return (this.hasShovel ? TOOL_REDUCTION : 0) +
           (this.hasPick   ? TOOL_REDUCTION : 0);
  }

  get gemCount() { return this.gems.length; }

  canCarry() { return this.gems.length < this.maxGems; }

  // -------------------------------------------------------------------------
  // Inventory actions
  // -------------------------------------------------------------------------

  addGem(gemType) {
    if (this.canCarry()) { this.gems.push(gemType); return true; }
    return false;
  }

  /** Sell all carried gems; returns the total coins earned. */
  sellGems() {
    let total = 0;
    for (const gem of this.gems) total += GEM_VALUE[gem] || 0;
    this.money += total;
    this.gems   = [];
    return total;
  }

  // -------------------------------------------------------------------------
  // Health actions
  // -------------------------------------------------------------------------

  /** Apply 1 point of hazard damage. Returns true if the player just died. */
  takeDamage() {
    if (this.iFrames > 0) return false;   // Still invincible from last hit
    this.hearts = Math.max(0, this.hearts - 1);
    this.iFrames = 90;                    // ~1.5 s at 60 fps
    if (this.hearts <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  /**
   * Heal up to `amount` hearts (capped at maxHearts).
   * Costs HEAL_PRICE per heart actually restored.
   * Returns the number of hearts restored (may be 0 if already full or broke).
   */
  heal(amount) {
    const missing  = this.maxHearts - this.hearts;
    const canHeal  = Math.min(amount, missing);
    const cost     = canHeal * HEAL_PRICE;
    if (canHeal <= 0) return 0;
    if (this.money < cost) {
      // Heal as many as we can afford
      const affordable = Math.floor(this.money / HEAL_PRICE);
      if (affordable <= 0) return 0;
      this.hearts += affordable;
      this.money  -= affordable * HEAL_PRICE;
      return affordable;
    }
    this.hearts += canHeal;
    this.money  -= cost;
    return canHeal;
  }

  /**
   * Buy one extra maximum heart from the Doctor.
   * Returns true on success.
   */
  buyExtraHeart() {
    if (this.maxHearts >= MAX_HEARTS)        return false;
    if (this.money     <  EXTRA_HEART_PRICE) return false;
    this.money    -= EXTRA_HEART_PRICE;
    this.maxHearts++;
    this.hearts++;    // New max heart is given full
    return true;
  }

  // -------------------------------------------------------------------------
  // Message helpers
  // -------------------------------------------------------------------------

  setMessage(msg, duration = 200) {
    this.message      = msg;
    this.messageTimer = duration;
  }

  /** Call once per game tick. */
  tick() {
    if (this.messageTimer > 0) this.messageTimer--;
    if (this.messageTimer === 0) this.message = '';
    if (this.iFrames > 0) this.iFrames--;
  }
}
