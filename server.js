const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ── Player Management ──────────────────────────────────────────────
const COLORS = ['#00e5ff', '#ff00aa', '#aaff00', '#ff8800'];
const COLOR_NAMES = ['Cyan', 'Magenta', 'Lime', 'Orange'];
const MAX_PLAYERS = 4;

const players = new Map(); // socketId → { playerId, color, colorName, role }
let playerCounter = 0;
let gameSocket = null;

function getNextColor() {
  const usedColors = new Set();
  players.forEach(p => { if (p.role === 'controller') usedColors.add(p.color); });
  for (let i = 0; i < COLORS.length; i++) {
    if (!usedColors.has(COLORS[i])) return { color: COLORS[i], colorName: COLOR_NAMES[i], index: i };
  }
  return null;
}

function getControllerCount() {
  let count = 0;
  players.forEach(p => { if (p.role === 'controller') count++; });
  return count;
}

// ── Socket.IO ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('register', (data) => {
    const { role } = data;

    if (role === 'game') {
      gameSocket = socket;
      players.set(socket.id, { playerId: 'game', role: 'game' });
      console.log(`[🎮] Game screen registered: ${socket.id}`);

      // Send existing players to the new game screen
      players.forEach((p, sid) => {
        if (p.role === 'controller') {
          socket.emit('player-joined', {
            playerId: p.playerId,
            color: p.color,
            colorName: p.colorName
          });
        }
      });

    } else if (role === 'controller') {
      if (getControllerCount() >= MAX_PLAYERS) {
        socket.emit('error-msg', { message: 'Game is full (max 4 players)' });
        return;
      }

      const colorInfo = getNextColor();
      if (!colorInfo) {
        socket.emit('error-msg', { message: 'No colors available' });
        return;
      }

      playerCounter++;
      const playerId = `player-${playerCounter}`;
      const playerData = {
        playerId,
        color: colorInfo.color,
        colorName: colorInfo.colorName,
        role: 'controller'
      };

      players.set(socket.id, playerData);

      // Tell the controller its assigned identity
      socket.emit('player-assigned', {
        playerId,
        color: colorInfo.color,
        colorName: colorInfo.colorName
      });

      // Tell the game screen
      if (gameSocket) {
        gameSocket.emit('player-joined', {
          playerId,
          color: colorInfo.color,
          colorName: colorInfo.colorName
        });
      }

      console.log(`[📱] Controller registered: ${playerId} (${colorInfo.colorName})`);
    }
  });

  // ── Relay controller events to game ──
  socket.on('move', (data) => {
    const player = players.get(socket.id);
    if (player && player.role === 'controller' && gameSocket) {
      gameSocket.emit('move', { playerId: player.playerId, ...data });
    }
  });

  socket.on('boost', (data) => {
    const player = players.get(socket.id);
    if (player && player.role === 'controller' && gameSocket) {
      gameSocket.emit('boost', { playerId: player.playerId, ...data });
    }
  });

  socket.on('jump', () => {
    const player = players.get(socket.id);
    if (player && player.role === 'controller' && gameSocket) {
      gameSocket.emit('jump', { playerId: player.playerId });
    }
  });

  socket.on('flip', () => {
    const player = players.get(socket.id);
    if (player && player.role === 'controller' && gameSocket) {
      gameSocket.emit('flip', { playerId: player.playerId });
    }
  });

  // ── Relay game events to controllers ──
  socket.on('score-update', (data) => {
    io.emit('score-update', data);
  });

  socket.on('timer-update', (data) => {
    io.emit('timer-update', data);
  });

  socket.on('round-end', (data) => {
    io.emit('round-end', data);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      if (player.role === 'game') {
        gameSocket = null;
        console.log(`[🎮] Game screen disconnected`);
      } else if (player.role === 'controller') {
        // Tell game screen
        if (gameSocket) {
          gameSocket.emit('player-left', { playerId: player.playerId });
        }
        console.log(`[📱] Controller disconnected: ${player.playerId}`);
      }
      players.delete(socket.id);
    }
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

// ── Start ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚗 Remote Stunt Car Controller`);
  console.log(`   Server running on http://localhost:${PORT}`);
  console.log(`   Share your local IP to connect from mobile\n`);
});
