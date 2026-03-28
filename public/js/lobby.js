import SocketClient from './socket-client.js';

const createNameEl  = document.getElementById('create-name');
const createModeEl  = document.getElementById('create-mode');
const createBtn     = document.getElementById('create-btn');
const createError   = document.getElementById('create-error');
const joinNameEl    = document.getElementById('join-name');
const joinCodeEl    = document.getElementById('join-code');
const joinBtn       = document.getElementById('join-btn');
const joinError     = document.getElementById('join-error');

// Normalise code input
joinCodeEl.addEventListener('input', () => {
  joinCodeEl.value = joinCodeEl.value.toUpperCase();
});

// ── Create ────────────────────────────────────────────────────────────────────
createBtn.addEventListener('click', () => {
  const name = createNameEl.value.trim();
  if (!name) { createError.textContent = 'Please enter your name'; return; }
  createError.textContent = '';
  createBtn.disabled = true;
  SocketClient.emit('room:create', { name, gameMode: createModeEl.value });
});

SocketClient.on('room:created', ({ roomCode, seatIndex, gameMode }) => {
  sessionStorage.setItem('playerName', createNameEl.value.trim());
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('seatIndex', seatIndex);
  sessionStorage.setItem('gameMode', gameMode || 'CLASSIC');
  window.location.href = `/room?code=${roomCode}`;
});

// ── Join ──────────────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', () => {
  const name = joinNameEl.value.trim();
  const roomCode = joinCodeEl.value.trim().toUpperCase();
  if (!name) { joinError.textContent = 'Please enter your name'; return; }
  if (roomCode.length !== 6) { joinError.textContent = 'Room code must be 6 characters'; return; }
  joinError.textContent = '';
  joinBtn.disabled = true;
  SocketClient.emit('room:join', { name, roomCode });
});

SocketClient.on('room:joined', ({ roomCode, seatIndex }) => {
  sessionStorage.setItem('playerName', joinNameEl.value.trim());
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('seatIndex', seatIndex);
  window.location.href = `/room?code=${roomCode}`;
});

SocketClient.on('room:error', ({ message }) => {
  createError.textContent = message;
  joinError.textContent = message;
  createBtn.disabled = false;
  joinBtn.disabled = false;
});
