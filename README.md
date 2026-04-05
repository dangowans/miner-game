# ⛏ Miner VGA

A faithful modern reimplementation of the 1989 Frodosoft freeware game **Miner VGA**, built as a static HTML5 Canvas game. Open `index.html` directly in any modern browser — no build step required.

---

## How to Run

```
# Option 1 – open directly
double-click index.html

# Option 2 – simple static server (avoids any browser file-protocol quirks)
npx serve .          # Node
python3 -m http.server 8080
```

---

## Controls

| Action   | Keyboard              | On-screen button |
|----------|-----------------------|-----------------|
| Move     | Arrow keys or WASD    | ▲ ◀ ▶ ▼        |
| Interact | **E** or **Enter**    | **USE**         |
| Close overlay | **Esc**         | ✕ button        |

---

## Gameplay Overview

### The Surface
The top row of the map is a small neighbourhood with four buildings:

| Building | Interact (E) |
|----------|-------------|
| 🏪 **Shop** (door at x=5) | Sell gems · buy tools & upgrades |
| 🍺 **Bar** (door at x=9) | Talk to the girl · win condition |
| 🏥 **Doctor** (door at x=13) | Restore hearts · buy extra heart slots |
| ▼ **Mine Entrance** (x=22–24) | Walk south to enter the mine |

### The Mine
- The mine is **randomly generated every game** and extends **infinitely downward**.
- Every tile starts as **dirt** — gems, hazards, stone, and items are all hidden inside.
- The **only way** back to the surface is through the mine-entrance columns (x 22–24).

### Revealing Dirt

| Method | How it works |
|--------|-------------|
| **Probe (safe)** | Move back and forth next to a dirt tile. Each move to an adjacent tile increments that tile's hidden probe counter. When the counter reaches the tile's random threshold it reveals automatically. |
| **Dig-in (risky)** | Walk directly into a dirt tile to reveal it instantly. You skip the probing but immediately trigger whatever is inside. |

**Shovel** (shop $50): reduces each tile's reveal threshold by 12 probes — the only tool that speeds up dirt digging.

---

## Items & Shop

| Item | Price | Effect |
|------|------:|-------|
| ⛏ Shovel | $50 | Reduces dirt reveal effort (−12 probes / tile) |
| ⚒ Pick | $100 | Walk into **stone** to break it → empty |
| 🪣 Bucket | $80 | Walk into spread **water** to clear it |
| 🧯 Fire Extinguisher | $120 | Walk into **lava** to convert it to stone (no damage) |
| 🎒 Large Bag | $75 | Doubles gem carry capacity (10 → 20) |
| 💍 Ring | $500 | Buy this, then visit the Bar to win |

---

## Hazards

### 💧 Water Spring
- Hidden inside some dirt tiles.
- When triggered (probe or dig-in), the source tile becomes **water** and the spring **floods up to 12 adjacent empty spaces**.
- **Water (spread tiles):** blocked normally — use the **Bucket** to walk through.
- **Water (spring source):** permanently blocked; the Bucket **cannot** clear the source.

### 🔥 Lava
- When triggered, lava floods up to 12 adjacent empty spaces.
- **Without a Fire Extinguisher:** walking into lava costs **1 heart** and the tile becomes empty.
- **With a Fire Extinguisher:** walking into lava converts the tile to **stone** (no damage). You can then break the stone with a Pick.

### 🪨 Stone
- Found hidden inside dirt tiles; more common deeper in the mine.
- **Without a Pick:** completely impassable.
- **With a Pick:** walk into stone to break it (instantly, one move).

---

## Health System

- The player starts with **3 hearts ♥**.
- Each hazard hit (lava, or water that bursts adjacent) costs **1 heart**.
- A short invincibility window prevents multiple hits from the same hazard.
- Hearts reach **0 → game over**.

### Doctor Services (surface, door at x=13)

| Service | Cost |
|---------|-----:|
| Restore 1 heart | $40 |
| Buy +1 max heart slot | $150 |

Maximum hearts: **6**. New heart slots are granted full.

---

## Economy

1. Collect **gems** in the mine (auto-picked up by walking over them).
2. Return to the **surface** and visit the **Shop** to sell them.
3. Spend coins on tools, the Large Bag, and ultimately the **Ring**.

| Gem | Value |
|-----|------:|
| 💚 Emerald (low) | $10 |
| 💙 Sapphire (mid) | $30 |
| ❤️ Ruby (high) | $75 |

---

## Win Condition

1. Earn **$500** in the mine.
2. Buy the **Ring 💍** at the Shop.
3. Walk to the **Bar** and press **E** to interact.

---

## Tips

- Move back and forth next to a suspicious dirt tile to reveal it safely before stepping in.
- Buy the **Shovel** early — it cuts reveal time significantly.
- **Bucket** + **Fire Extinguisher** + **Pick** together let you navigate almost any obstacle.
- Gems get more valuable (Sapphires and Rubies more common) the deeper you dig.
- Visit the **Doctor** before a long mining session if you're low on hearts.
