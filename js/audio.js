'use strict';

/**
 * SoundSystem – procedural audio using the Web Audio API.
 * Sounds are synthesised on the fly; no external audio files are required.
 * The AudioContext is lazily resumed on the first sound call to comply with
 * browser autoplay policies (context starts suspended until a user gesture).
 */
class SoundSystem {
  constructor() {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_e) {
      this._ctx = null;  // Audio API unavailable (e.g. old browser)
    }
  }

  /** Resume the context after a user gesture if it was auto-suspended. */
  _resume() {
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
  }

  /**
   * Schedule a single synthesised oscillator tone.
   * @param {OscillatorType} type    - Waveform ('sine'|'square'|'sawtooth'|'triangle')
   * @param {number}         freq    - Start frequency in Hz
   * @param {number}         freqEnd - End frequency in Hz (linear glide); equal to freq for constant pitch
   * @param {number}         dur     - Duration in seconds
   * @param {number}         vol     - Peak gain (0–1)
   * @param {number}        [offset] - Start delay from AudioContext.currentTime (seconds); default 0
   */
  _tone(type, freq, freqEnd, dur, vol, offset = 0) {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const t0  = ctx.currentTime + offset;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) {
      osc.frequency.linearRampToValueAtTime(freqEnd, t0 + dur);
    }

    // Very short attack then exponential decay to silence
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // -------------------------------------------------------------------------
  // Game sound events
  // -------------------------------------------------------------------------

  /**
   * Ascending chime sequence played when ore is collected.
   * Higher-value ores produce brighter, richer arpeggios.
   * @param {string} gemType - HIDDEN.SILVER / GOLD / PLATINUM / DIAMOND / RUBY
   */
  playOreCollect(gemType) {
    this._resume();
    const sequences = {
      silver:   { freqs: [880, 1046],             step: 0.08 },
      gold:     { freqs: [932, 1174, 1480],        step: 0.07 },
      platinum: { freqs: [987, 1318, 1568],        step: 0.07 },
      diamond:  { freqs: [1046, 1318, 1760],       step: 0.06 },
      ruby:     { freqs: [1046, 1318, 1760, 2093], step: 0.06 },
    };
    const { freqs, step } = sequences[gemType] ?? sequences.silver;
    freqs.forEach((f, i) => this._tone('sine', f, f, 0.14, 0.18, i * step));
  }

  /** Harsh descending buzz when a hazard deals damage to the player. */
  playHazardHit() {
    this._resume();
    this._tone('sawtooth', 320, 80,  0.25, 0.30);
    this._tone('square',   200, 60,  0.20, 0.20, 0.04);
  }

  /**
   * Coin-clink sound when any transaction is made
   * (shop purchase, bank sale, drink, heal, heart upgrade).
   */
  playTransaction() {
    this._resume();
    this._tone('sine', 1200, 900,  0.10, 0.20);
    this._tone('sine', 1600, 1100, 0.10, 0.18, 0.08);
  }

  /** Pop/click when a tool or novelty item is picked up in the mine. */
  playItemPickup() {
    this._resume();
    this._tone('sine', 600,  900,  0.09, 0.15);
    this._tone('sine', 900,  1200, 0.07, 0.12, 0.07);
  }

  /** Crack when a durable tool (pick / bucket / extinguisher) breaks. */
  playToolBreak() {
    this._resume();
    this._tone('sawtooth', 400, 100, 0.18, 0.30);
    this._tone('square',   250,  80, 0.15, 0.20, 0.06);
  }

  /** Short metallic tink when the player walks into a stone without a pick. */
  playTinkStone() {
    this._resume();
    this._tone('triangle', 1800, 1300, 0.06, 0.18);
    this._tone('triangle', 1300,  900, 0.05, 0.10, 0.05);
  }

  /** Low rumbling crumble when a stone block is broken with the pick. */
  playCrumbleStone() {
    this._resume();
    this._tone('sawtooth', 200,  60, 0.22, 0.28);
    this._tone('square',   130,  40, 0.18, 0.22, 0.06);
    this._tone('sawtooth',  80,  30, 0.14, 0.15, 0.12);
  }
}

// Global singleton – referenced directly in game.js and ui.js
const sounds = new SoundSystem();