const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client")));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "../client/index.html")),
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ── Game Constants ──────────────────────────────────────────────
const HP_MAX = 200;

const TECHNIQUES = {
  blue: { type: "technique", damage: 25, castTime: 1000 },
  red: { type: "technique", damage: 30, castTime: 1000 },
  dismantle: { type: "technique", damage: 35, castTime: 1000 },
  purple: { type: "special", damage: 50, castTime: 1000 },
  void: { type: "domain", damage: 55, castTime: 2000 },
  shrine: { type: "domain", damage: 65, castTime: 2000 },
  shadow: { type: "domain", damage: 65, castTime: 2000 },
  iron: { type: "domain", damage: 70, castTime: 2000 },
};

// Rock-paper-scissors for regular techniques
// blue > red > dismantle > blue, purple beats all techniques
const COUNTER_MAP = {
  blue: { beats: "red", losesTo: "dismantle" },
  red: { beats: "dismantle", losesTo: "blue" },
  dismantle: { beats: "blue", losesTo: "red" },
  purple: { beats: "blue", alsoBeat: ["red", "dismantle"] },
};

// Domain clash: shrine > shadow > void > iron > shrine (cycle)
const DOMAIN_COUNTER = {
  shrine: "shadow",
  shadow: "void",
  void: "iron",
  iron: "shrine",
};

// ── Room State ──────────────────────────────────────────────────
const rooms = {}; // roomCode -> roomState

function createRoom(code) {
  return {
    code,
    players: {}, // socketId -> playerState
    playerOrder: [], // [socketId, socketId]
    phase: "waiting", // waiting | fighting | clash | gameover
    clashData: null,
  };
}

function createPlayer(socketId, playerNum) {
  return {
    socketId,
    playerNum, // 1 or 2
    hp: HP_MAX,
    casting: null, // { tech, startTime, phase: 'one'|'two', sequence: [] }
    blocking: false,
    ready: false,
  };
}

function getOpponent(room, socketId) {
  return room.playerOrder.find((id) => id !== socketId);
}

function resolveAttack(attackerTech, defenderTech, defenderBlocking) {
  // Returns: { attackerWins: bool, draw: bool, reason: string }
  const atkData = TECHNIQUES[attackerTech];

  if (!atkData) return { attackerWins: false, draw: false, reason: "invalid" };

  // Defender blocking
  if (defenderBlocking) {
    if (atkData.type === "domain") {
      return { attackerWins: true, draw: false, reason: "domain_breaks_block" };
    }
    return { attackerWins: false, draw: false, reason: "blocked" };
  }

  // Defender not casting — attacker wins
  if (!defenderTech) {
    return { attackerWins: true, draw: false, reason: "hit" };
  }

  // Both casting — clash (handled separately via clash phase)
  return { attackerWins: false, draw: false, reason: "clash" };
}

// ── Socket Logic ────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // ── Create Room ──
  socket.on("create_room", ({ roomCode }) => {
    if (rooms[roomCode]) {
      socket.emit("error", { msg: "Room code taken. Try another." });
      return;
    }
    const room = createRoom(roomCode);
    rooms[roomCode] = room;
    const player = createPlayer(socket.id, 1);
    room.players[socket.id] = player;
    room.playerOrder.push(socket.id);
    socket.join(roomCode);
    socket.emit("room_created", { roomCode, playerNum: 1 });
    console.log(`Room ${roomCode} created by ${socket.id}`);
  });

  // ── Join Room ──
  socket.on("join_room", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("error", { msg: "Room not found." });
      return;
    }
    if (room.playerOrder.length >= 2) {
      socket.emit("error", { msg: "Room is full." });
      return;
    }

    const player = createPlayer(socket.id, 2);
    room.players[socket.id] = player;
    room.playerOrder.push(socket.id);
    socket.join(roomCode);
    room.phase = "fighting";

    socket.emit("room_joined", { roomCode, playerNum: 2 });
    io.to(roomCode).emit("game_start", {
      p1: room.playerOrder[0],
      p2: room.playerOrder[1],
      hp: HP_MAX,
    });
    console.log(`Room ${roomCode} started`);
  });

  // ── Player casts one-handed sign (intent) ──
  socket.on("cast_intent", ({ roomCode, tech }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "fighting") return;

    const player = room.players[socket.id];
    const oppId = getOpponent(room, socket.id);
    const opp = room.players[oppId];
    if (!player || !opp) return;

    player.blocking = false;
    player.casting = {
      tech,
      startTime: Date.now(),
      phase: "one",
      sequence: [],
    };

    // Tell opponent someone is casting
    io.to(roomCode).emit("player_casting", {
      casterNum: player.playerNum,
      tech,
      castTime: TECHNIQUES[tech]?.castTime || 1000,
    });
  });

  // ── Player activates (one-handed cast complete) ──
  socket.on("cast_activate", ({ roomCode, tech }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "fighting") return;

    const player = room.players[socket.id];
    const oppId = getOpponent(room, socket.id);
    const opp = room.players[oppId];
    if (!player || !opp) return;

    const atkData = TECHNIQUES[tech];
    if (!atkData) return;

    const oppTech = opp.casting?.tech;
    const oppBlocking = opp.blocking;

    // If opponent is also casting — enter CLASH phase
    if (oppTech && opp.casting?.phase === "one") {
      room.phase = "clash";
      room.clashData = {
        [socket.id]: { tech, sequenceDone: 0 },
        [oppId]: { tech: oppTech, sequenceDone: 0 },
        winner: null,
      };

      // Generate clash sequence (random 4-sign sequence both must do)
      const clashSigns = generateClashSequence(tech, oppTech);
      room.clashData.sequence = clashSigns;
      room.clashData.startTime = Date.now();

      io.to(roomCode).emit("clash_start", {
        p1Tech: room.players[room.playerOrder[0]].casting?.tech,
        p2Tech: room.players[room.playerOrder[1]].casting?.tech,
        sequence: clashSigns,
        timeLimit: 8000,
      });
      return;
    }

    // No clash — resolve immediately
    const result = resolveAttack(tech, oppTech, oppBlocking);

    if (result.reason === "blocked") {
      io.to(roomCode).emit("attack_blocked", {
        attackerNum: player.playerNum,
        tech,
      });
      player.casting = null;
      return;
    }

    if (result.attackerWins) {
      const dmg = atkData.damage;
      opp.hp = Math.max(0, opp.hp - dmg);
      player.casting = null;
      opp.casting = null;

      io.to(roomCode).emit("attack_hit", {
        attackerNum: player.playerNum,
        tech,
        damage: dmg,
        reason: result.reason,
        p1hp: room.players[room.playerOrder[0]].hp,
        p2hp: room.players[room.playerOrder[1]].hp,
      });

      checkGameOver(room, roomCode);
    }
  });

  // ── Block ──
  socket.on("set_block", ({ roomCode, blocking }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    player.blocking = blocking;
    player.casting = null;
    io.to(roomCode).emit("player_blocking", {
      playerNum: player.playerNum,
      blocking,
    });
  });

  // ── Clash sequence progress ──
  socket.on("clash_sign", ({ roomCode, signIndex }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "clash" || !room.clashData) return;

    const player = room.players[socket.id];
    const oppId = getOpponent(room, socket.id);
    const clash = room.clashData;

    if (!clash[socket.id]) return;

    // Validate sign is next in sequence
    const expected =
      clash.sequenceDone !== undefined ? clash[socket.id].sequenceDone : 0;

    if (signIndex === clash[socket.id].sequenceDone) {
      clash[socket.id].sequenceDone++;

      io.to(roomCode).emit("clash_progress", {
        playerNum: player.playerNum,
        progress: clash[socket.id].sequenceDone,
        total: clash.sequence.length,
      });

      // Check if this player finished the sequence
      if (clash[socket.id].sequenceDone >= clash.sequence.length) {
        resolveClash(room, roomCode, socket.id, oppId);
      }
    }
  });

  // ── Clash timeout (server-side enforced) ──
  // handled via resolveClash called on both sides

  // ── Cancel cast ──
  socket.on("cancel_cast", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (player) {
      player.casting = null;
      io.to(roomCode).emit("cast_cancelled", { playerNum: player.playerNum });
    }
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players[socket.id]) {
        io.to(code).emit("opponent_disconnected");
        delete rooms[code];
        break;
      }
    }
    console.log("disconnected:", socket.id);
  });
});

// ── Helpers ────────────────────────────────────────────────────

function generateClashSequence(tech1, tech2) {
  // Each technique has its own clash signs;
  // the sequence shown is whichever technique is a domain (longer),
  // otherwise a merged 4-sign sequence
  const techSigns = {
    blue: ["index_up", "peace", "pinch", "fist"],
    red: ["index_up", "fist", "index_up", "horns"],
    dismantle: ["pinch", "flat", "pinch", "peace"],
    purple: ["pinch", "horns", "pinch", "flat"],
    void: ["index_up", "peace", "both_pinch", "flat"],
    shrine: ["fist", "flat", "horns", "fist"],
    shadow: ["horns", "peace", "flat", "horns"],
    iron: ["fist", "horns", "fist", "flat"],
  };

  // Use domain's sequence if one is a domain, else winner's (higher damage)
  const d1 = TECHNIQUES[tech1],
    d2 = TECHNIQUES[tech2];
  let base = tech1;
  if (d2?.type === "domain" && d1?.type !== "domain") base = tech2;
  else if (d1?.damage < d2?.damage) base = tech2;

  return techSigns[base] || ["index_up", "pinch", "fist", "flat"];
}

function resolveClash(room, roomCode, winnerId, loserId) {
  if (!room.clashData || room.clashData.winner) return;
  room.clashData.winner = winnerId;
  room.phase = "fighting";

  const winner = room.players[winnerId];
  const loser = room.players[loserId];
  if (!winner || !loser) return;

  const winTech = room.clashData[winnerId]?.tech;
  const loseTech = room.clashData[loserId]?.tech;
  const atkData = TECHNIQUES[winTech];

  if (atkData) {
    loser.hp = Math.max(0, loser.hp - atkData.damage);
  }

  winner.casting = null;
  loser.casting = null;

  io.to(roomCode).emit("clash_resolved", {
    winnerNum: winner.playerNum,
    winTech,
    loseTech,
    damage: atkData?.damage || 0,
    p1hp: room.players[room.playerOrder[0]].hp,
    p2hp: room.players[room.playerOrder[1]].hp,
  });

  room.clashData = null;
  checkGameOver(room, roomCode);
}

function checkGameOver(room, roomCode) {
  for (const id of room.playerOrder) {
    if (room.players[id].hp <= 0) {
      room.phase = "gameover";
      const loserNum = room.players[id].playerNum;
      const winnerNum = loserNum === 1 ? 2 : 1;
      io.to(roomCode).emit("game_over", { winnerNum, loserNum });
      // Clean up after 30s
      setTimeout(() => {
        delete rooms[roomCode];
      }, 30000);
      return;
    }
  }
}

// Health check for Render
app.get("/", (req, res) => res.json({ status: "JJK Clash Server Online" }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`JJK Clash server on port ${PORT}`));
