const RungGame = require('./RungGame');
const { SOCKET_EVENTS, PHASES, GAME_MODES } = require('./constants');

const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

class GameRoom {
  constructor(roomCode, gameMode = GAME_MODES.CLASSIC) {
    this.roomCode = roomCode;
    this.gameMode = gameMode;
    this.players = new Map();       // socketId -> { socketId, name, seatIndex, disconnectedAt }
    this.seatMap = [null, null, null, null]; // seatIndex -> socketId
    this.game = null;
    this.createdAt = Date.now();
    this.phase = 'LOBBY';
    this.turnDeadline = null;
  }

  // ── Player Management ───────────────────────────────────────────────────────

  addPlayer(socketId, name) {
    const seatIndex = this.seatMap.indexOf(null);
    if (seatIndex === -1) {
      return { success: false, error: 'Room is full' };
    }

    const player = { socketId, name, seatIndex, disconnectedAt: null };
    this.players.set(socketId, player);
    this.seatMap[seatIndex] = socketId;
    return { success: true, seatIndex };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    this.seatMap[player.seatIndex] = null;
    this.players.delete(socketId);
  }

  /**
   * Called on disconnect during PLAYING phase.
   * Marks the player as disconnected without releasing the seat.
   * The seat stays reserved for reconnection via reconnectPlayer().
   */
  markDisconnected(socketId) {
    const player = this.players.get(socketId);
    if (player) player.disconnectedAt = Date.now();
    // seatMap[i] intentionally kept pointing to old (dead) socketId
  }

  getPlayerList() {
    return this.seatMap.map((socketId, seatIndex) => {
      if (!socketId) return { seatIndex, name: null, connected: false };
      const p = this.players.get(socketId);
      if (!p) return { seatIndex, name: null, connected: false };
      return { seatIndex, name: p.name, connected: !p.disconnectedAt };
    });
  }

  canStart() {
    return this.phase === 'LOBBY' && this.seatMap.every(s => s !== null);
  }

  isSeatZero(socketId) {
    return this.seatMap[0] === socketId;
  }

  // ── Game Control ─────────────────────────────────────────────────────────────

  startGame() {
    const playerSeats = this.seatMap.map((socketId) => {
      const p = this.players.get(socketId);
      return { id: socketId, name: p.name };
    });

    this.game = new RungGame(playerSeats, this.gameMode);
    this.game.startHand();
    this.phase = 'PLAYING';
  }

  startNextHand() {
    if (!this.game || this.game.phase !== PHASES.HAND_OVER) {
      return { success: false, error: 'Not in HAND_OVER phase' };
    }
    this.game.startHand();
    return { success: true };
  }

  handleCallTrump(socketId, suit) {
    if (!this.game) return { success: false, error: 'Game not started' };
    try {
      this.game.callTrump(socketId, suit);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  handlePlayCard(socketId, cardId) {
    if (!this.game) return { success: false, error: 'Game not started' };

    // Security: verify socket is the current player (also guards disconnected players)
    const player = this.players.get(socketId);
    if (!player || player.disconnectedAt) return { success: false, error: 'Player not found' };

    const expectedSeat = this.game.currentPlayerSeatIndex;
    if (player.seatIndex !== expectedSeat) {
      return { success: false, error: 'It is not your turn' };
    }

    // Security: verify card is actually in their server-side hand
    const hand = this.game.getPlayerHand(socketId);
    if (!hand.find(c => c.id === cardId)) {
      return { success: false, error: 'Card not found in your hand' };
    }

    try {
      this.game.playCard(socketId, cardId);
      return { success: true, trickPending: this.game.trickPendingResolution };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── State Broadcasting ───────────────────────────────────────────────────────

  broadcastState(io) {
    if (!this.game) return;

    const publicState = { ...this.game.getPublicState(), turnDeadline: this.turnDeadline };
    io.to(this.roomCode).emit(SOCKET_EVENTS.GAME_STATE, publicState);

    // Send each player their private hand (disconnected players get dropped by Socket.io)
    for (const [socketId, player] of this.players) {
      const hand = this.game.getPlayerHand(socketId);
      io.to(socketId).emit(SOCKET_EVENTS.GAME_HAND, { cards: hand });
    }
  }

  sendStateTo(io, socketId) {
    if (!this.game) return;
    const publicState = { ...this.game.getPublicState(), turnDeadline: this.turnDeadline };
    io.to(socketId).emit(SOCKET_EVENTS.GAME_STATE, publicState);

    const hand = this.game.getPlayerHand(socketId);
    io.to(socketId).emit(SOCKET_EVENTS.GAME_HAND, { cards: hand });
  }

  // ── Reconnection ─────────────────────────────────────────────────────────────

  /**
   * Attempt to re-associate a new socketId with a disconnected player by name.
   * Returns the seatIndex if successful, or null.
   *
   * Scans the players map (not seatMap) because markDisconnected() keeps the
   * old dead socketId in seatMap — scanning seatMap would only find the old ID.
   */
  reconnectPlayer(newSocketId, name) {
    for (const [oldSocketId, player] of this.players) {
      if (player.name === name && player.disconnectedAt !== null) {
        // Re-associate: swap socketId, clear disconnectedAt, update seatMap
        this.players.delete(oldSocketId);
        this.seatMap[player.seatIndex] = newSocketId;
        this.players.set(newSocketId, {
          ...player,
          socketId: newSocketId,
          disconnectedAt: null
        });

        // Update game's internal player ID references
        if (this.game) {
          this.game.reconnectPlayer(oldSocketId, newSocketId);
        }
        return player.seatIndex;
      }
    }
    return null;
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  isEmpty() {
    return this.players.size === 0;
  }

  /**
   * Returns true when every player has been disconnected for at least windowMs.
   * Used by the server cleanup interval to GC ghost rooms.
   */
  isAbandoned(windowMs = 2 * 60 * 1000) {
    if (this.players.size === 0) return true;
    const now = Date.now();
    for (const player of this.players.values()) {
      if (!player.disconnectedAt) return false;           // still connected
      if (now - player.disconnectedAt < windowMs) return false; // too recent
    }
    return true;
  }

  isExpired() {
    return Date.now() - this.createdAt > ROOM_TTL_MS && this.isEmpty();
  }
}

module.exports = GameRoom;
