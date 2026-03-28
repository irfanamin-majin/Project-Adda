import SocketClient from './socket-client.js';
import ClientState   from './state/ClientState.js';
import { renderTable }  from './ui/TableLayout.js';
import { renderTrick }  from './ui/TrickDisplay.js';
import { renderHand }   from './ui/CardRenderer.js';
import {
  showToast, showError,
  showTrumpPicker, showHandResult, showGameOver, closeModal
} from './ui/Notifications.js';

// ── Load session ──────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
ClientState.roomCode   = params.get('code') || sessionStorage.getItem('roomCode');
ClientState.myName     = sessionStorage.getItem('playerName');
ClientState.mySeatIndex = parseInt(sessionStorage.getItem('seatIndex') ?? '0', 10);

// Team A = seats 0,2 / Team B = seats 1,3
ClientState.myTeam = [0, 2].includes(ClientState.mySeatIndex) ? 'A' : 'B';

// ── Socket events ─────────────────────────────────────────────────────────────

SocketClient.on('connect', () => {
  if (ClientState.roomCode && ClientState.myName) {
    SocketClient.emit('game:request_state', {
      roomCode:  ClientState.roomCode,
      name:      ClientState.myName,
      seatIndex: ClientState.mySeatIndex
    });
  }
});

SocketClient.on('game:state', (state) => {
  const prevPhase = ClientState.publicState?.phase;
  ClientState.publicState = state;
  // Auto-close the hand result modal when the next hand begins
  if (prevPhase === 'HAND_OVER' && state.phase !== 'HAND_OVER') {
    closeModal();
  }
  render(state);
  startCountdown(state);
});

SocketClient.on('game:hand', ({ cards }) => {
  ClientState.myHand = cards;
  renderMyHand();
});

SocketClient.on('game:trump_needed', ({ callerSeatIndex, callerName }) => {
  const isMine = callerSeatIndex === ClientState.mySeatIndex;
  showTrumpPicker(callerName, isMine);
});

SocketClient.on('game:abandoned', () => {
  window.location.href = '/';
});

SocketClient.on('game:error', ({ message }) => {
  showError(message);
});

SocketClient.on('room:error', ({ message }) => {
  showError(message);
});

// ── Exit button (host only) ───────────────────────────────────────────────────
if (ClientState.mySeatIndex === 0) {
  const exitBtn = document.getElementById('exit-btn');
  exitBtn.style.display = 'inline-block';
  exitBtn.addEventListener('click', () => {
    if (confirm('End the game for everyone and return to the main screen?')) {
      SocketClient.emit('game:abandon');
    }
  });
}

// ── Turn countdown interval ───────────────────────────────────────────────────
let countdownInterval = null;

function startCountdown(state) {
  clearInterval(countdownInterval);
  countdownInterval = null;
  if (state.turnDeadline && (state.phase === 'CALLING_TRUMP' || state.phase === 'TRICK_PLAYING')) {
    countdownInterval = setInterval(() => {
      const s = ClientState.publicState;
      if (!s || !s.turnDeadline ||
          (s.phase !== 'CALLING_TRUMP' && s.phase !== 'TRICK_PLAYING')) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        return;
      }
      renderTable(s, ClientState.mySeatIndex);
    }, 1000);
  }
}

// ── Render functions ──────────────────────────────────────────────────────────

function render(state) {
  if (!state) return;

  renderTable(state, ClientState.mySeatIndex);
  renderTrick(state.currentTrick, ClientState.mySeatIndex);
  renderScoreboard(state);
  renderPhaseBanner(state);

  // Render hand with latest state (for suit-following indication)
  renderMyHand();

  // Handle phase transitions
  if (state.phase === 'HAND_OVER' && state.lastHandResult) {
    showHandResult(state.lastHandResult, ClientState.myTeam);
  }

  if (state.phase === 'GAME_OVER' && state.lastHandResult) {
    showGameOver(state.lastHandResult.scores, ClientState.myTeam);
  }
}

function renderMyHand() {
  const state = ClientState.publicState;
  const hand  = ClientState.myHand;
  if (!hand) return;

  const isMyTurn = state && state.currentPlayerSeatIndex === ClientState.mySeatIndex
                   && state.phase === 'TRICK_PLAYING';

  const ledSuit = state?.currentTrick?.ledSuit ?? null;

  renderHand(hand, isMyTurn, ledSuit, (card) => {
    SocketClient.emit('game:play_card', { cardId: card.id });
  });
}

function renderScoreboard(state) {
  document.getElementById('score-a').textContent = state.scores?.A ?? 0;
  document.getElementById('score-b').textContent = state.scores?.B ?? 0;

  // Tricks for "us vs them"
  const myTeam    = ClientState.myTeam;
  const otherTeam = myTeam === 'A' ? 'B' : 'A';
  document.getElementById('tricks-us').textContent   = state.tricksTaken?.[myTeam]   ?? 0;
  document.getElementById('tricks-them').textContent = state.tricksTaken?.[otherTeam] ?? 0;

  // Trump display
  const trumpEl = document.getElementById('trump-value');
  const indicator = document.getElementById('trump-indicator');
  if (state.trumpSuit) {
    const symbols = { spades: '♠ Spades', hearts: '♥ Hearts', diamonds: '♦ Diamonds', clubs: '♣ Clubs' };
    trumpEl.textContent = symbols[state.trumpSuit] || state.trumpSuit;
    indicator.className = `trump-indicator trump-suit-${state.trumpSuit}`;
  } else {
    trumpEl.textContent = '—';
    indicator.className = 'trump-indicator';
  }
}

function renderPhaseBanner(state) {
  const banner = document.getElementById('phase-banner');
  if (!banner) return;

  if (state.phase === 'CALLING_TRUMP') {
    banner.textContent = 'Calling Trump...';
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}
