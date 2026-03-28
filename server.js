const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const GameRoom = require('./game/GameRoom');
const { SOCKET_EVENTS, PHASES, GAME_MODES } = require('./game/constants');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// ── Room registry ────────────────────────────────────────────────────────────
const rooms = new Map();            // roomCode -> GameRoom
const socketRooms = new Map();      // socketId -> roomCode
const autoStartTimers = new Map();  // roomCode -> setTimeout handle
const turnTimers = new Map();       // roomCode -> setTimeout handle

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

// ── Turn timer helpers ────────────────────────────────────────────────────────

function clearTurnTimer(roomCode) {
  clearTimeout(turnTimers.get(roomCode));
  turnTimers.delete(roomCode);
  const r = rooms.get(roomCode);
  if (r) r.turnDeadline = null;
}

function startTurnTimer(roomCode) {
  clearTurnTimer(roomCode); // always replace any running timer
  const r = rooms.get(roomCode);
  if (!r || !r.game) return;
  if (r.game.trickPendingResolution) return; // 2s display window — no timer
  if (r.game.phase !== PHASES.CALLING_TRUMP && r.game.phase !== PHASES.TRICK_PLAYING) return;

  r.turnDeadline = Date.now() + 20000;

  const timer = setTimeout(() => {
    turnTimers.delete(roomCode);
    const room = rooms.get(roomCode);
    if (!room || !room.game) return;
    room.turnDeadline = null;

    if (room.game.phase === PHASES.CALLING_TRUMP) {
      const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
      const suit = suits[Math.floor(Math.random() * suits.length)];
      const callerSeat = room.game.trumpCallerSeatIndex;
      const callerSocketId = room.seatMap[callerSeat];
      const result = room.handleCallTrump(callerSocketId, suit);
      if (result.success) {
        startTurnTimer(roomCode);
        room.broadcastState(io);
      }
    } else if (room.game.phase === PHASES.TRICK_PLAYING) {
      const currentSeat = room.game.currentPlayerSeatIndex;
      const currentSocketId = room.seatMap[currentSeat];
      const validCards = room.game.getValidCards(currentSocketId);
      if (!validCards.length) return;
      const card = validCards[Math.floor(Math.random() * validCards.length)];
      const result = room.handlePlayCard(currentSocketId, card.id);
      if (result.success) {
        if (result.trickPending) {
          clearTurnTimer(roomCode); // keep timer off during 2s display window
          room.broadcastState(io);
          handleTrickComplete(roomCode);
        } else {
          startTurnTimer(roomCode);
          room.broadcastState(io);
        }
      }
    }
  }, 20000);
  turnTimers.set(roomCode, timer);
}

// Resolves the pending trick after 2s, then chains into auto-start or startTurnTimer.
// Used by both the manual play handler and the auto-play timer.
function handleTrickComplete(roomCode) {
  setTimeout(() => {
    const r = rooms.get(roomCode);
    if (!r || !r.game || !r.game.trickPendingResolution) return;
    r.game.resolvePendingTrick();

    if (r.game.phase === PHASES.TRICK_PLAYING) {
      startTurnTimer(roomCode); // set deadline BEFORE broadcast
    }
    r.broadcastState(io);

    if (r.game.phase === PHASES.HAND_OVER) {
      clearTimeout(autoStartTimers.get(roomCode));
      const handTimer = setTimeout(() => {
        autoStartTimers.delete(roomCode);
        const rr = rooms.get(roomCode);
        if (!rr || !rr.game || rr.game.phase !== PHASES.HAND_OVER) return;
        const nextResult = rr.startNextHand();
        if (nextResult.success) {
          startTurnTimer(roomCode); // trump caller's 20s
          rr.broadcastState(io);
          const callerSeat = rr.game.trumpCallerSeatIndex;
          const callerName = rr.game.playerSeats[callerSeat]?.name;
          io.to(roomCode).emit(SOCKET_EVENTS.GAME_TRUMP_NEEDED, { callerSeatIndex: callerSeat, callerName });
        }
      }, 7000);
      autoStartTimers.set(roomCode, handTimer);
    }
    // GAME_OVER: no timer — clients show the modal
  }, 2000);
}

// ── Socket.io handlers ───────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── room:create ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ROOM_CREATE, ({ name, gameMode }) => {
    if (!checkRate(socket.id, 'room_create', 5, 10000)) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Too many requests' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message: 'Name is required' });
    }
    const playerName = name.trim().slice(0, 20);
    const validatedMode = Object.values(GAME_MODES).includes(gameMode) ? gameMode : GAME_MODES.CLASSIC;
    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode, validatedMode);

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
      players: room.getPlayerList(),
      gameMode: validatedMode
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

    startTurnTimer(room.roomCode);
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

    startTurnTimer(room.roomCode);
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

    if (result.trickPending) {
      // 4th card played — clear timer for the 2s display window, then delegate
      // to handleTrickComplete which resolves and restarts the timer afterwards.
      clearTurnTimer(room.roomCode);
      room.broadcastState(io);
      handleTrickComplete(room.roomCode);
    } else {
      // Cards 1–3 of a trick — start next player's timer before broadcast.
      startTurnTimer(room.roomCode);
      room.broadcastState(io);
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

    startTurnTimer(room.roomCode);
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
    clearTurnTimer(room.roomCode);
    clearTimeout(autoStartTimers.get(room.roomCode));
    autoStartTimers.delete(room.roomCode);
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
      io.to(code).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, { players: room.getPlayerList(), gameMode: room.gameMode });
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
      clearTurnTimer(code);
      clearTimeout(autoStartTimers.get(code));
      autoStartTimers.delete(code);
      rooms.delete(code);
    }
  }
}, 10 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Rung server listening on http://localhost:${PORT}`);
});
