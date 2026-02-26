# ⚔ JJK: Cursed Clash — PvP Hand Gesture Fighting Game

Real-time online PvP built on MediaPipe hand tracking + Three.js particle effects + Socket.io.

---

## 🗂 Project Structure
```
jjk-clash/
├── server/          ← Node.js + Socket.io backend (deploy to Render)
│   ├── server.js
│   └── package.json
├── client/          ← Pure HTML frontend (host anywhere or open locally)
│   └── index.html
└── README.md
```

---

## 🚀 Deployment

### Run locally first
```bash
cd server
npm install
npm start
# Server on http://localhost:3001

# Dev mode with hot-reload:
npm run dev
```

### Deploy server to Render (no yaml needed)
1. Push repo to GitHub
2. **render.com → New → Web Service → connect repo**
3. Set manually in the Render dashboard:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Deploy — copy your URL e.g. `https://jjk-clash-server.onrender.com`

> Render reads `package.json` and the `engines` field automatically.

### Point client at your server
In `client/index.html` find line ~340:
```js
: 'https://YOUR-RENDER-APP.onrender.com'; // <-- UPDATE THIS
```
Replace with your Render URL.

### Host the frontend
```bash
# Netlify Drop — drag client/ folder to https://app.netlify.com/drop

# GitHub Pages — put index.html in docs/, enable Pages in repo settings

# Local quick serve:
npx serve client/
```

---

## 🎮 How to Play

### Connecting
1. Player 1 → enter a room code → **CREATE**
2. Player 2 → same code → **JOIN**
3. Game starts automatically

### Gestures

#### Regular Techniques — 1 second
| Technique | Sequence | Damage |
|-----------|----------|--------|
| Blue | ☝️ Index up | 25 HP |
| Red | ☝️ Index → ✊ Fist | 30 HP |
| Dismantle | 🤌 Pinch → 🖐 Flat | 35 HP |
| Hollow Purple | 🤌 Pinch → 🤘 Horns → 🤌 Pinch | 50 HP |

#### Domain Expansions — 2 seconds
| Technique | Sequence | Damage |
|-----------|----------|--------|
| Infinite Void | ☝️ Index → ✌️ Peace | 55 HP |
| Malevolent Shrine | ✊ Fist → 🖐 Flat | 65 HP |
| Chimera Shadow Garden | 🤘 Horns → ✌️ Peace | 65 HP |
| Coffin of the Iron Mountain | ✊ Fist → 🤘 Horns → ✊ Fist | 70 HP |

#### Block — 🖐🖐 both hands flat (hold)
- Cancels regular techniques
- Fails vs Domains

### Combat Flow
```
Cast one-handed sequence (1–2s charge)
         ↓
Opponent blocking?
  ├─ vs technique  → BLOCKED (0 dmg)
  └─ vs domain     → BLOCK BREAKS → full damage

Opponent also casting?
  └─ CLASH → race through clash sign sequence
       └─ faster player wins, loser takes full damage

Opponent idle?
  └─ HIT → full damage
```

### Counters
- Blue > Red > Dismantle > Blue
- Purple beats all techniques
- Domains beat all techniques
- Domain vs Domain = Clash

---

## 🛠 Stack
Node.js · Express · Socket.io · Three.js · MediaPipe Hands
