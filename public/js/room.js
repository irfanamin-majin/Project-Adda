import SocketClient from './socket-client.js';

const params    = new URLSearchParams(window.location.search);
const roomCode  = params.get('code') || sessionStorage.getItem('roomCode');
const myName    = sessionStorage.getItem('playerName');
const mySeat    = parseInt(sessionStorage.getItem('seatIndex') ?? '-1', 10);

document.getElementById('room-code').textContent = roomCode || '??????';

// Copy button
document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode).then(() => {
    document.getElementById('copy-btn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-btn').textContent = 'Copy Code'; }, 1500);
  });
});

// ── Update seat display ────────────────────────────────────────────────────────
function renderSeats(players) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`seat-${i}`);
    const nameEl = el.querySelector('.seat-name');
    const numEl  = el.querySelector('.seat-number');
    const p = players[i];

    el.className = 'seat';
    if (p && p.name) {
      el.classList.add('filled');
      nameEl.textContent = p.name;
      if (i === mySeat) {
        el.classList.add('you');
        nameEl.textContent += ' (You)';
      }
    } else {
      nameEl.textContent = 'Waiting...';
    }
  }

  const filled = players.filter(p => p && p.name).length;
  const note = document.getElementById('waiting-note');
  const startBtn = document.getElementById('start-btn');

  note.textContent = filled < 4
    ? `${filled}/4 players joined — waiting for ${4 - filled} more...`
    : 'All players ready!';

  // Show start button only to seat 0 when room is full
  if (mySeat === 0) {
    startBtn.style.display = 'block';
    startBtn.disabled = filled < 4;
  }
}

// ── Socket events ──────────────────────────────────────────────────────────────
SocketClient.on('connect', () => {
  if (roomCode && myName) {
    SocketClient.emit('game:request_state', { roomCode, name: myName, seatIndex: mySeat });
  }
});

SocketClient.on('room:player_joined', ({ players }) => {
  renderSeats(players);
});

SocketClient.on('room:joined', ({ players }) => {
  renderSeats(players);
});

SocketClient.on('room:created', ({ players }) => {
  if (players) renderSeats(players);
});

SocketClient.on('game:started', () => {
  window.location.href = `/game?code=${roomCode}`;
});

SocketClient.on('room:error', ({ message }) => {
  document.getElementById('room-error').textContent = message;
});

SocketClient.on('game:state', () => {
  // If we receive a game state on the room page, the game already started
  window.location.href = `/game?code=${roomCode}`;
});

// Start button
document.getElementById('start-btn').addEventListener('click', () => {
  SocketClient.emit('game:start', {});
});

// ── Initial render ─────────────────────────────────────────────────────────────
renderSeats([null, null, null, null]);
