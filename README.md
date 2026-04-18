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
The surface consists of three rows:

**Row y=0 — Sky** (decorative):
Open sky above the buildings — purely decorative.

**Row y=1 — Building facades** (impassable wall):
The entire row is a solid wall of buildings. Special door tiles mark the buildings you can interact with.

**Row y=2 — Pavement** (walkable):
The player walks along this stone pavement. Stand below a building door and press **E** to interact.

| Building | Door (x) | Interact (E) |
|----------|----------|-------------|
| 🏪 **Shop** | x=5 | Buy tools & items |
| 🍺 **Bar** | x=9 | Talk to the girl · win condition |
| 🏥 **Doctor** | x=13 | Restore hearts · buy extra heart slots |
| 🏦 **Bank** | x=17 | Sell ore for coins |
| ▼ **Mine Entrance** | x=22–23 | Walk south (↓) to enter the mine |

The pavement **cannot be crossed** downward except at the mine entrance (x=22–23).

### The Mine
- The mine is **randomly generated every game** and extends **infinitely downward**.
- Every tile starts as **dirt** — gems, hazards, stone, and items are all hidden inside.
- The **only way** back to the surface is through the mine-entrance columns (x=22–23).

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
| ⚒ Pick | $100 | Walk into **stone** to break it → empty (10 uses) |
| 🪣 Bucket | $80 | Walk into spread **water** to clear it to empty — free passage, no heart cost (10 uses) |
| 🧯 Fire Extinguisher | $120 | Walk into **lava** to convert it to stone (no damage; 10 uses) |
| 🎒 Large Bag | $75 | Doubles ore carry capacity (10 → 20) |
| 💣 Dynamite | $75 | Place a charge with a 5-second fuse; usually blasts in a 3-tile radius, with occasional larger explosions |
| 🛠️ Drill | $100 | Use from inventory to drill 15 m straight down, clearing dirt and stone and revealing hazards/ore/items without hazard spread |
| 🩹 First Aid Kit | $65 | Restore health to full from inventory |

## Contractor Mike

Available in Family Mode (stand at x=20 and press E):

| Item | Price | Effect |
|------|------:|-------|
| 🏠 House Expansion | $1000 | Upgrade the house level (up to level 4) |
| 🛗 Elevator Shaft | $500 | Build a shaft at x=23 with entry points every 5 m ($5/ride) |
| ⛏ Mine Depth | $200 | Expand elevator depth by 50 m (up to 300 m) |
| 🚃 Mine Cart | $200 | Press 🚃 (or **C**) to send all carried ore to your bank account for a **$5 delivery fee** — requires a clear walkable path from your location to the mine exit; cannot use the elevator; blocked by water or lava |

---

## Hazards

### 💧 Water Spring
- Hidden inside some dirt tiles.
- When triggered (probe or dig-in), the source tile becomes **water** and the spring **floods up to 12 adjacent empty spaces**.
- If flooding water hits lava, that lava tile turns into **stone**.
- **Water (spread tiles):** walk through at the cost of **1 heart** — the tile clears to empty after wading. Use the **Bucket** to clear it for free (no damage).
- **Water (spring source):** walk through at the cost of **1 heart** — the spring keeps refilling so the source tile stays as water. The Bucket **cannot** clear the source.

### 🔥 Lava
- When triggered, lava floods up to 12 adjacent empty spaces.
- If erupting lava hits water, that water tile turns into **stone**.
- **Without a Fire Extinguisher:** walking into lava costs **1 heart**.
- **With a Fire Extinguisher:** walking into lava converts the tile to **stone** (no damage). You can then break the stone with a Pick.

### 🪨 Stone
- Found hidden inside dirt tiles; more common deeper in the mine.
- **Without a Pick:** completely impassable.
- **With a Pick:** walk into stone to break it (instantly, one move).

---

## Health System

- The player starts with **3 hearts ♥**.
- Each hazard interaction costs **1 heart**: wading through water or walking into lava without gear.
- A short invincibility window prevents multiple rapid hits.
- Hearts reach **0 → game over**.

### Doctor Services (surface, door at x=13)

| Service | Cost |
|---------|-----:|
| Restore 1 heart | $30 |
| Buy +1 max heart slot | $150 |

Maximum hearts: **6**. New heart slots are granted full.

---

## Economy

1. Collect **ore** in the mine (auto-picked up by walking over it).
2. Return to the **surface** and visit the **Bank** (x=17) to sell it.
3. Spend coins on tools and items at the **Shop** (x=5).

| Ore | Value |
|-----|------:|
| 🥈 Silver | $8 |
| 🥇 Gold | $25 |
| ⬜ Platinum | $65 |
| 💎 Diamond | $200 |
| 🔴 Ruby (unique) | $500 |

---

## Win Condition

1. Pick up the 🌸 **flower** to the left of the outhouse and give it to the girl at the Bar.
2. Buy **3 drinks** 🍺 at the Bar ($10 each).
3. Find the 💍 **ring** hidden in the mine (~50 m below the outhouse, x=1).
4. Have **$1,000** in your pocket.
5. Return to the **Bar** and propose.

---

## Tips

- Move back and forth next to a suspicious dirt tile to reveal it safely before stepping in.
- Buy the **Shovel** early — it cuts reveal time significantly.
- **Bucket** + **Fire Extinguisher** + **Pick** together let you navigate almost any obstacle.
- Extra novelty collectibles in the HUD inventory are hidden behind an **…** toggle.
- Ore gets more valuable (Platinum and Diamonds more common) the deeper you dig.
- Visit the **Doctor** before a long mining session if you're low on hearts.
