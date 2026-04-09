'use strict';

/**
 * Input – collects keyboard and on-screen button presses into a queue.
 * The game loop dequeues one action per tick so rapid-fire tapping
 * doesn't instantly flood movement.
 */
class Input {
  constructor() {
    this._queue = [];
    this._setupKeyboard();
    this._setupButtons();
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowUp':    case 'w': case 'W': this._push('up');       break;
        case 'ArrowDown':  case 's': case 'S': this._push('down');     break;
        case 'ArrowLeft':  case 'a': case 'A': this._push('left');     break;
        case 'ArrowRight': case 'd': case 'D': this._push('right');    break;
        case 'e': case 'E': case 'Enter':       this._push('interact'); break;
        case 'x': case 'X':                     this._push('dynamite'); break;
        case 'c': case 'C':                     this._push('minecart'); break;
        default: return;
      }
      // Prevent page scrolling on arrow keys
      if (e.key.startsWith('Arrow')) e.preventDefault();
    });
  }

  // -------------------------------------------------------------------------
  // On-screen D-pad buttons
  // -------------------------------------------------------------------------

  _setupButtons() {
    const MAP = {
      'btn-up':       'up',
      'btn-down':     'down',
      'btn-left':     'left',
      'btn-right':    'right',
      'btn-dynamite': 'dynamite',
      'btn-firstaid': 'firstaid',
      'btn-minecart': 'minecart',
      'btn-radio':    'radio',
    };
    for (const [id, action] of Object.entries(MAP)) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      // Click (desktop fallback)
      btn.addEventListener('click', () => this._push(action));
      // Touch – prevent ghosting mouse events on mobile
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this._push(action);
      }, { passive: false });
    }
  }

  // -------------------------------------------------------------------------
  // Queue helpers
  // -------------------------------------------------------------------------

  _push(action) {
    if (this._queue.length < MAX_INPUT_QUEUE) this._queue.push(action);
  }

  /** Pop the next action from the queue, or null if empty. */
  dequeue() {
    return this._queue.shift() ?? null;
  }

  clear() { this._queue = []; }
}
