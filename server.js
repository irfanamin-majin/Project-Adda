const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const GameRoom = require('./game/GameRoom');
const { SOCKET_EVENTS, PHASES } = require('./game/constants');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// ── Room registry ────────────────────────────────────────────────────────────
const rooms = new Map();          // roomCode -> GameRoom
const socketRooms = new Map();    // socketId -> roomCode

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateLimits = new Map();     // socketId -> { [event]: timestamp[] }

function checkRate(socketId, event, maxCalls, windowMs) {
  if (!rateLimits.has(socketId)) rateLimits.set(socketId, {});
  const bucket = rateLimits.get(socketId);
  const now = Date.now();
  bucket[event] = (bucket[event] || []).filter(t => now - t < windowMs);
  if (bucket[event].length >= maxCalls) return false;
  bucket[event].push(now);
  return true;
}

// ── HTTP routes ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/room', (req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));

app.get('/api/room/:code/exists', (req, res) => {
  res.json({ exists: rooms.has(req.params.code.toUpperCase()) });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getRoomForSocket(socketId) {
  const code = socketRooms.get(socketId);
  return code ? rooms.get(code) : null;
}

// ── Socket.io handlers ───────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── room:create ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ROOM_CREATE, ({ name }) => {
    if (!checkRate(socket.id, 'room_create', 5, 10000)) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Too many requests' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Name is required' });
    }
    const playerName = name.trim().slice(0, 20);
    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode);

    const result = room.addPlayer(socket.id, playerName);
    if (!result.success) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: result.error });
    }

    rooms.set(roomCode, room);
    socketRooms.set(socket.id, roomCode);
    socket.join(roomCode);

    socket.emit(SOCKET_EVENTS.ROOM_CREATED, {
      roomCode,
      seatIndex: result.seatIndex,
      players: room.getPlayerList()
    });
  });

  // ── room:join ──────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ROOM_JOIN, ({ name, roomCode }) => {
    if (!checkRate(socket.id, 'room_join', 5, 10000)) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Too many requests' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Name is required' });
    }
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Room not found' });
    }
    if (room.phase !== 'LOBBY') {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Game already in progress' });
    }

    const playerName = name.trim().slice(0, 20);
    const result = room.addPlayer(socket.id, playerName);
    if (!result.success) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: result.error });
    }

    socketRooms.set(socket.id, code);
    socket.join(code);

    socket.emit(SOCKET_EVENTS.ROOM_JOINED, {
      roomCode: code,
      seatIndex: result.seatIndex,
      players: room.getPlayerList()
    });

    socket.to(code).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, {
      players: room.getPlayerList()
    });
  });

  // ── room:leave ─────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ROOM_LEAVE, () => {
    handleLeave(socket);
  });

  // ── game:start ─────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GAME_START, () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Not in a room' });
    if (!room.isSeatZero(socket.id)) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Only the room creator can start the game' });
    }
    if (!room.canStart()) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Need 4 players to start' });
    }

    room.startGame();

    io.to(room.roomCode).emit(SOCKET_EVENTS.GAME_STARTED, {
      dealerSeatIndex: room.game.dealerSeatIndex
    });

    room.broadcastState(io);

    // Notify trump caller to pick trump
    const callerSeat = room.game.trumpCallerSeatIndex;
    const callerSocketId = room.seatMap[callerSeat];
    const callerName = room.players.get(callerSocketId)?.name;
    io.to(room.roomCode).emit(SOCKET_EVENTS.GAME_TRUMP_NEEDED, {
      callerSeatIndex: callerSeat,
      callerName
    });
  });

  // ── game:trump_call ────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GAME_TRUMP_CALL, ({ suit }) => {
    if (!checkRate(socket.id, 'trump_call', 3, 5000)) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Too many requests' });
    }
    const room = getRoomForSocket(socket.id);
    if (!room) return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Not in a room' });

    const validSuits = ['spades', 'hearts', 'diamonds', 'clubs'];
    if (!validSuits.includes(suit)) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Invalid suit' });
    }

    const result = room.handleCallTrump(socket.id, suit);
    if (!result.success) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: result.error });
    }

    room.broadcastState(io);
  });

  // ── game:play_card ─────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GAME_PLAY_CARD, ({ cardId }) => {
    if (!checkRate(socket.id, 'play_card', 5, 2000)) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Too many requests' });
    }
    const room = getRoomForSocket(socket.id);
    if (!room) return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Not in a room' });
    if (typeof cardId !== 'string') {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Invalid card' });
    }

    const result = room.handlePlayCard(socket.id, cardId);
    if (!result.success) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: result.error });
    }

    room.broadcastState(io);

    // If hand is over, auto-start next hand after a brief delay
    if (room.game.phase === PHASES.HAND_OVER || room.game.phase === PHASES.GAME_OVER) {
      // Clients handle the UI — they'll request next hand via game:next_hand
    }
  });

  // ── game:next_hand ─────────────────────────────────────────────────────────
  // Any connected player can trigger — server verifies phase so this can't be
  // abused, and it unblocks the room if seat 0 disconnected after a hand ends.
  socket.on('game:next_hand', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    if (!room.game || room.game.phase !== PHASES.HAND_OVER) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Not ready for next hand' });
    }

    const result = room.startNextHand();
    if (!result.success) {
      return socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: result.error });
    }

    room.broadcastState(io);

    const callerSeat = room.game.trumpCallerSeatIndex;
    const callerSocketId = room.seatMap[callerSeat];
    const callerName = room.players.get(callerSocketId)?.name;
    io.to(room.roomCode).emit(SOCKET_EVENTS.GAME_TRUMP_NEEDED, {
      callerSeatIndex: callerSeat,
      callerName
    });
  });

  // ── game:abandon ───────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GAME_ABANDON, () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    if (!room.isSeatZero(socket.id)) return; // only host can abandon
    io.to(room.roomCode).emit(SOCKET_EVENTS.GAME_ABANDONED);
    rooms.delete(room.roomCode);
  });

  // ── game:request_state ─────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GAME_REQUEST_STATE, ({ roomCode, name, seatIndex }) => {
    if (!checkRate(socket.id, 'request_state', 5, 60000)) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Too many requests' });
    }
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Room not found' });

    // Try reconnection if game is running
    if (room.phase === 'PLAYING') {
      const reconnectedSeat = room.reconnectPlayer(socket.id, name);
      if (reconnectedSeat !== null) {
        socketRooms.set(socket.id, code);
        socket.join(code);
        room.sendStateTo(io, socket.id);
        // Re-deliver trump_needed if we reconnected during that phase
        if (room.game && room.game.phase === PHASES.CALLING_TRUMP) {
          const callerSeat = room.game.trumpCallerSeatIndex;
          const callerName = room.game.playerSeats[callerSeat]?.name;
          socket.emit(SOCKET_EVENTS.GAME_TRUMP_NEEDED, { callerSeatIndex: callerSeat, callerName });
        }
        return;
      }
    }

    // Lobby reconnect — re-register the player (page navigation killed the old socket)
    const reconnectedSeat = room.reconnectPlayer(socket.id, name);
    if (reconnectedSeat === null) {
      // Player wasn't previously in the room — try adding as new
      const result = room.addPlayer(socket.id, name);
      if (!result.success) {
        return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: result.error });
      }
    }
    socketRooms.set(socket.id, code);
    socket.join(code);
    if (room.game) {
      room.sendStateTo(io, socket.id);
      // Re-deliver trump_needed if we reconnected during that phase
      if (room.game.phase === PHASES.CALLING_TRUMP) {
        const callerSeat = room.game.trumpCallerSeatIndex;
        const callerName = room.game.playerSeats[callerSeat]?.name;
        socket.emit(SOCKET_EVENTS.GAME_TRUMP_NEEDED, { callerSeatIndex: callerSeat, callerName });
      }
    } else {
      io.to(code).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, { players: room.getPlayerList() });
    }
  });

  // ── disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const code = socketRooms.get(socket.id);
  if (!code) return;

  const room = rooms.get(code);
  if (room) {
    const player = room.players.get(socket.id);
    const name = player?.name;
    const seatIndex = player?.seatIndex;

    // Mark disconnected for ALL phases (not just PLAYING).
    // For LOBBY, this gives a 30-second grace period for page-navigation
    // reconnects instead of instantly deleting the room.
    room.markDisconnected(socket.id);

    // Notify remaining players in both cases
    if (name !== undefined) {
      io.to(code).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, { seatIndex, name });
    }
  }
  socketRooms.delete(socket.id);
  rateLimits.delete(socket.id);
}

// ── Periodic cleanup ─────────────────────────────────────────────────────────
// Runs every 10 seconds. LOBBY rooms get a 30-second grace period (for page
// navigation reconnects). PLAYING rooms get 2 minutes before being considered
// abandoned.
setInterval(() => {
  for (const [code, room] of rooms) {
    const abandonWindow = room.phase === 'PLAYING' ? 2 * 60 * 1000 : 30 * 1000;
    if (room.isAbandoned(abandonWindow) || room.isExpired()) {
      rooms.delete(code);
    }
  }
}, 10 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Rung server listening on http://localhost:${PORT}`);
});
