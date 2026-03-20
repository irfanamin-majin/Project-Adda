const RungGame = require('./RungGame');
const { SOCKET_EVENTS, PHASES } = require('./constants');

const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

class GameRoom {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = new Map();       // socketId -> { socketId, name, seatIndex }
    this.seatMap = [null, null, null, null]; // seatIndex -> socketId
    this.game = null;
    this.createdAt = Date.now();
    this.phase = 'LOBBY';
  }

  // ── Player Management ───────────────────────────────────────────────────────

  addPlayer(socketId, name) {
    const seatIndex = this.seatMap.indexOf(null);
    if (seatIndex === -1) {
      return { success: false, error: 'Room is full' };
    }

    const player = { socketId, name, seatIndex };
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

  getPlayerList() {
    return this.seatMap.map((socketId, seatIndex) => {
      if (!socketId) return { seatIndex, name: null, connected: false };
      const p = this.players.get(socketId);
      return { seatIndex, name: p ? p.name : null, connected: !!p };
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
    const playerSeats = this.seatMap.map((socketId, i) => {
      const p = this.players.get(socketId);
      return { id: socketId, name: p.name };
    });

    this.game = new RungGame(playerSeats);
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

    // Security: verify socket is the current player
    const player = this.players.get(socketId);
    if (!player) return { success: false, error: 'Player not found' };

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
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── State Broadcasting ───────────────────────────────────────────────────────

  broadcastState(io) {
    if (!this.game) return;

    const publicState = this.game.getPublicState();
    io.to(this.roomCode).emit(SOCKET_EVENTS.GAME_STATE, publicState);

    // Send each player their private hand
    for (const [socketId, player] of this.players) {
      const hand = this.game.getPlayerHand(socketId);
      io.to(socketId).emit(SOCKET_EVENTS.GAME_HAND, { cards: hand });
    }
  }

  sendStateTo(io, socketId) {
    if (!this.game) return;
    const publicState = this.game.getPublicState();
    io.to(socketId).emit(SOCKET_EVENTS.GAME_STATE, publicState);

    const hand = this.game.getPlayerHand(socketId);
    io.to(socketId).emit(SOCKET_EVENTS.GAME_HAND, { cards: hand });
  }

  // ── Reconnection ─────────────────────────────────────────────────────────────

  /**
   * Attempt to re-associate a new socketId with an existing player by name.
   * Returns the seatIndex if successful, or null.
   */
  reconnectPlayer(newSocketId, name) {
    // Find a seat with the same name but no live socket
    for (let i = 0; i < this.seatMap.length; i++) {
      const existingSocketId = this.seatMap[i];
      if (!existingSocketId) {
        // Seat is empty — can't reconnect to it
        continue;
      }
      const existing = this.players.get(existingSocketId);
      if (existing && existing.name === name) {
        // Re-associate
        this.players.delete(existingSocketId);
        this.seatMap[i] = newSocketId;
        const player = { socketId: newSocketId, name, seatIndex: i };
        this.players.set(newSocketId, player);

        // Update game's internal player ID references if game is running
        if (this.game) {
          this.game.reconnectPlayer(existingSocketId, newSocketId);
        }
        return i;
      }
    }
    return null;
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  isEmpty() {
    return this.players.size === 0;
  }

  isExpired() {
    return Date.now() - this.createdAt > ROOM_TTL_MS && this.isEmpty();
  }
}

module.exports = GameRoom;
