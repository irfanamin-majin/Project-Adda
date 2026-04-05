const { createDeck, shuffle, compareCards } = require('./Deck');
const { PHASES, TEAMS, GAME_MODES } = require('./constants');

class RungGame {
  constructor(playerSeats, gameMode = GAME_MODES.CLASSIC) {
    // playerSeats: [{ id, name }, ...] in seat order, length 4
    this.playerSeats = playerSeats; // index = seatIndex
    this.playerIdToSeat = {};
    for (let i = 0; i < playerSeats.length; i++) {
      this.playerIdToSeat[playerSeats[i].id] = i;
    }

    this.gameMode = gameMode;

    this.phase = PHASES.WAITING;
    this.deck = [];
    this.hands = {};           // { [playerId]: Card[] }
    this.dealerSeatIndex = Math.floor(Math.random() * 4);
    this.trumpCallerSeatIndex = null;
    this.trumpSuit = null;
    this.currentTrick = { cards: [], ledSuit: null, leaderSeatIndex: null };
    this.tricksTaken = { A: 0, B: 0 };
    this.currentPlayerSeatIndex = null;
    this.scores = { A: 0, B: 0 };
    this.consecutiveWins = { A: 0, B: 0 };
    this.lastTrick = null;
    this.lastHandResult = null;
    this.handNumber = 0;
    this.totalTricksPlayed = 0;
    this.trickPendingResolution = false;

    // Double Sir mode state
    this.pendingPile = [];          // tricks sitting in the middle uncaptured
    this.lastTrickWinnerSeat = null;       // seat that won the most recent trick (null after capture or hand start)
    this.lastTrickWinningCardIsAce = false; // was the winning card of the last trick an Ace?
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  startHand() {
    this.handNumber++;
    this.deck = shuffle(createDeck());
    this.hands = {};
    this.tricksTaken = { A: 0, B: 0 };
    this.totalTricksPlayed = 0;
    this.trickPendingResolution = false;
    this.currentTrick = { cards: [], ledSuit: null, leaderSeatIndex: null };
    this.lastTrick = null;
    this.lastHandResult = null;
    this.pendingPile = [];
    this.lastTrickWinnerSeat = null;
    this.lastTrickWinningCardIsAce = false;

    // Trump caller = dealer's right (counter-clockwise = +3 mod 4)
    this.trumpCallerSeatIndex = (this.dealerSeatIndex + 3) % 4;
    this.trumpSuit = null;

    // Deal 5 cards to each player
    for (let seat = 0; seat < 4; seat++) {
      const pid = this.playerSeats[seat].id;
      this.hands[pid] = [];
    }
    // Deal 5 cards counter-clockwise starting from trump caller
    for (let i = 0; i < 5 * 4; i++) {
      const seat = (this.trumpCallerSeatIndex + (i % 4) * 3) % 4;
      const pid = this.playerSeats[seat].id;
      this.hands[pid].push(this.deck.pop());
    }

    this.phase = PHASES.CALLING_TRUMP;
    this.currentPlayerSeatIndex = this.trumpCallerSeatIndex;
  }

  callTrump(playerId, suit) {
    if (this.phase !== PHASES.CALLING_TRUMP) {
      throw new Error('Not in trump calling phase');
    }
    const seatIndex = this.playerIdToSeat[playerId];
    if (seatIndex !== this.trumpCallerSeatIndex) {
      throw new Error('It is not your turn to call trump');
    }

    this.trumpSuit = suit;

    // Deal remaining 8 cards each (32 total) counter-clockwise starting from trump caller
    for (let i = 0; i < 8 * 4; i++) {
      const seat = (this.trumpCallerSeatIndex + (i % 4) * 3) % 4;
      const pid = this.playerSeats[seat].id;
      this.hands[pid].push(this.deck.pop());
    }

    this.phase = PHASES.TRICK_PLAYING;
    this.currentPlayerSeatIndex = this.trumpCallerSeatIndex;
  }

  playCard(playerId, cardId) {
    if (this.phase !== PHASES.TRICK_PLAYING) {
      throw new Error('Not in trick playing phase');
    }
    const seatIndex = this.playerIdToSeat[playerId];
    if (seatIndex !== this.currentPlayerSeatIndex) {
      throw new Error('It is not your turn');
    }

    const hand = this.hands[playerId];
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      throw new Error('Card not found in your hand');
    }

    const validation = this.isValidPlay(playerId, cardId);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const card = hand.splice(cardIndex, 1)[0];

    // First card of trick sets led suit
    if (this.currentTrick.cards.length === 0) {
      this.currentTrick.ledSuit = card.suit;
      this.currentTrick.leaderSeatIndex = seatIndex;
    }

    this.currentTrick.cards.push({ playerId, card, seatIndex });

    if (this.currentTrick.cards.length === 4) {
      // Don't resolve immediately — caller broadcasts the full 4-card trick first,
      // then calls resolvePendingTrick() after a short delay.
      this.trickPendingResolution = true;
      this.currentPlayerSeatIndex = null; // nobody's turn during the display pause
    } else {
      // Advance to next player counter-clockwise
      this.currentPlayerSeatIndex = (this.currentPlayerSeatIndex + 3) % 4;
    }
  }

  isValidPlay(playerId, cardId) {
    const hand = this.hands[playerId];
    if (!hand) return { valid: false, reason: 'Player not found' };

    const card = hand.find(c => c.id === cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };

    const ledSuit = this.currentTrick.ledSuit;

    // Leading a trick — any card is valid
    if (!ledSuit) return { valid: true };

    // Must follow suit if able
    const hasSuit = hand.some(c => c.suit === ledSuit);
    if (hasSuit && card.suit !== ledSuit) {
      return { valid: false, reason: `You must play a ${ledSuit} card` };
    }

    return { valid: true };
  }

  getValidCards(playerId) {
    const hand = this.hands[playerId];
    if (!hand) return [];
    return hand.filter(c => this.isValidPlay(playerId, c.id).valid);
  }

  getPublicState() {
    return {
      phase: this.phase,
      players: this.playerSeats.map((p, i) => ({
        seatIndex: i,
        name: p.name,
        cardCount: this.hands[p.id] ? this.hands[p.id].length : 0
      })),
      dealerSeatIndex: this.dealerSeatIndex,
      trumpCallerSeatIndex: this.trumpCallerSeatIndex,
      trumpSuit: this.trumpSuit,
      currentPlayerSeatIndex: this.currentPlayerSeatIndex,
      currentTrick: {
        cards: this.currentTrick.cards.map(({ card, seatIndex }) => ({ seatIndex, card })),
        ledSuit: this.currentTrick.ledSuit,
        leaderSeatIndex: this.currentTrick.leaderSeatIndex
      },
      lastTrick: this.lastTrick,
      tricksTaken: { ...this.tricksTaken },
      scores: { ...this.scores },
      handNumber: this.handNumber,
      lastHandResult: this.lastHandResult,
      gameMode: this.gameMode,
      pendingPileCount: this.pendingPile.length
    };
  }

  getPlayerHand(playerId) {
    return this.hands[playerId] || [];
  }

  reconnectPlayer(oldId, newId) {
    // Update hands map
    if (this.hands[oldId] !== undefined) {
      this.hands[newId] = this.hands[oldId];
      delete this.hands[oldId];
    }
    // Update playerIdToSeat
    const seat = this.playerIdToSeat[oldId];
    if (seat !== undefined) {
      this.playerIdToSeat[newId] = seat;
      delete this.playerIdToSeat[oldId];
      this.playerSeats[seat].id = newId;
    }
  }

  resolvePendingTrick() {
    if (!this.trickPendingResolution) return;
    this.trickPendingResolution = false;
    this._resolveTrick();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _resolveTrick() {
    const { cards, ledSuit } = this.currentTrick;
    this.totalTricksPlayed++;

    // Find winning card
    let winningEntry = cards[0];
    for (let i = 1; i < cards.length; i++) {
      if (compareCards(cards[i].card, winningEntry.card, ledSuit, this.trumpSuit) === 1) {
        winningEntry = cards[i];
      }
    }

    const winnerSeat = winningEntry.seatIndex;
    const winningTeam = TEAMS.A.includes(winnerSeat) ? 'A' : 'B';

    // Save last trick for display
    this.lastTrick = {
      cards: cards.map(({ card, seatIndex }) => ({ seatIndex, card })),
      winnerSeatIndex: winnerSeat
    };

    if (this.gameMode === GAME_MODES.DOUBLE_SIR) {
      this._resolveDoubleSirTrick(winnerSeat, winningTeam, cards, winningEntry.card);
    } else {
      this._resolveClassicTrick(winnerSeat, winningTeam);
    }
  }

  _resolveClassicTrick(winnerSeat, winningTeam) {
    this.tricksTaken[winningTeam]++;

    // Check for Court via first-7-tricks win (win all first 7 tricks in a row)
    const courtByFirstSeven =
      this.totalTricksPlayed === 7 &&
      this.tricksTaken[winningTeam] === 7;

    if (courtByFirstSeven) {
      this._resolveHand(winningTeam, true);
      return;
    }

    // Math elimination — once a team hits 7 tricks the hand is decided
    if (this.tricksTaken[winningTeam] === 7) {
      this._resolveHand(winningTeam, false);
      return;
    }

    // Continue — winner leads next trick
    this.currentTrick = { cards: [], ledSuit: null, leaderSeatIndex: null };
    this.currentPlayerSeatIndex = winnerSeat;
  }

  _resolveDoubleSirTrick(winnerSeat, winningTeam, cards, winningCard) {
    const prevWinnerSeat = this.lastTrickWinnerSeat;
    const prevWinningCardWasAce = this.lastTrickWinningCardIsAce;
    const winningCardIsAce = winningCard.rank === 'A';

    // Update tracking for next trick (may be overwritten below on capture)
    this.lastTrickWinnerSeat = winnerSeat;
    this.lastTrickWinningCardIsAce = winningCardIsAce;

    if (prevWinnerSeat === null) {
      // First trick after hand start or after a capture — goes to pending pile
      this.pendingPile.push(cards);
    } else if (prevWinnerSeat === winnerSeat) {
      // Same player wins consecutively — check Ace Rule
      if (prevWinningCardWasAce && winningCardIsAce) {
        // Cannot capture with two consecutive Aces; pile grows, player must
        // win again with a non-Ace to capture
        this.pendingPile.push(cards);
      } else {
        // Valid capture — sweep pending pile + this trick
        const captured = this.pendingPile.length + 1;
        this.tricksTaken[winningTeam] += captured;
        this.pendingPile = [];
        // Reset after capture so next trick starts fresh
        this.lastTrickWinnerSeat = null;
        this.lastTrickWinningCardIsAce = false;
      }
    } else {
      // Different player wins — pile grows
      this.pendingPile.push(cards);
    }

    // Court by first-seven: same as classic (all 7 captured tricks by one team)
    const courtByFirstSeven =
      this.totalTricksPlayed === 7 &&
      this.tricksTaken[winningTeam] === 7;

    if (courtByFirstSeven) {
      this._resolveHand(winningTeam, true);
      return;
    }

    // Math elimination — once a team accumulates 7 captured tricks
    if (this.tricksTaken[winningTeam] >= 7) {
      this._resolveHand(winningTeam, false);
      return;
    }

    // If all 13 tricks have been played but nobody reached 7 yet,
    // award the pending pile to the last winning team and end the hand.
    if (this.totalTricksPlayed === 13 && this.pendingPile.length > 0) {
      this.tricksTaken[winningTeam] += this.pendingPile.length;
      this.pendingPile = [];
      const finalWinner = this.tricksTaken.A >= 7 ? 'A' :
                          this.tricksTaken.B >= 7 ? 'B' : winningTeam;
      this._resolveHand(finalWinner, false);
      return;
    }

    // Continue — winner leads next trick
    this.currentTrick = { cards: [], ledSuit: null, leaderSeatIndex: null };
    this.currentPlayerSeatIndex = winnerSeat;
  }

  _resolveHand(winningTeam, isCourt) {
    const losingTeam = winningTeam === 'A' ? 'B' : 'A';
    const tricks = { ...this.tricksTaken };

    // Update consecutive wins
    this.consecutiveWins[winningTeam]++;
    this.consecutiveWins[losingTeam] = 0;

    // Check for Court via 7 consecutive hands
    const courtByConsecutive = !isCourt && this.consecutiveWins[winningTeam] >= 7;
    const isCourtScoring = isCourt || courtByConsecutive;

    if (isCourtScoring) {
      this.scores[winningTeam]++;
      this.consecutiveWins = { A: 0, B: 0 };
    }

    // Check for game over (e.g., first to 7 courts, or some agreed number — using 7)
    const gameOver = this.scores[winningTeam] >= 7;

    // Determine new dealer before updating state
    const trumpCallerTeam = TEAMS.A.includes(this.trumpCallerSeatIndex) ? 'A' : 'B';
    let newDealerSeatIndex;

    if (winningTeam !== trumpCallerTeam) {
      // Dealer's team won (trump-caller's team lost): dealer moves to dealer's right
      newDealerSeatIndex = (this.dealerSeatIndex + 3) % 4;
    } else if (isCourtScoring && winningTeam === trumpCallerTeam) {
      // Trump caller's team scored a court: deal passes to dealer's partner
      newDealerSeatIndex = (this.dealerSeatIndex + 2) % 4;
    } else {
      // Trump caller's team won but no court: same dealer
      newDealerSeatIndex = this.dealerSeatIndex;
    }

    this.lastHandResult = {
      winningTeam,
      tricks,
      isCourt: isCourtScoring,
      newDealerSeatIndex,
      scores: { ...this.scores }
    };

    this.dealerSeatIndex = newDealerSeatIndex;
    this.phase = gameOver ? PHASES.GAME_OVER : PHASES.HAND_OVER;
    this.currentPlayerSeatIndex = null;
  }
}

module.exports = RungGame;
