import SocketClient from '../socket-client.js';

const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const SUIT_NAMES   = { spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs' };

// ── Toast ─────────────────────────────────────────────────────────────────────
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export function showError(message) {
  showToast(message, 'error', 4000);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function showModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`;
  return root;
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

// ── Trump picker ──────────────────────────────────────────────────────────────
export function showTrumpPicker(callerName, isMine) {
  if (!isMine) {
    showToast(`${callerName} is choosing trump...`, 'info', 8000);
    return;
  }

  const html = `
    <h2>Choose Trump</h2>
    <p>You called Rung — pick the trump suit</p>
    <div class="suit-buttons">
      <button class="suit-btn spades"   data-suit="spades">♠<br><small>Spades</small></button>
      <button class="suit-btn hearts"   data-suit="hearts">♥<br><small>Hearts</small></button>
      <button class="suit-btn clubs"    data-suit="clubs">♣<br><small>Clubs</small></button>
      <button class="suit-btn diamonds" data-suit="diamonds">♦<br><small>Diamonds</small></button>
    </div>
  `;

  const root = showModal(html);
  root.querySelectorAll('.suit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const suit = btn.dataset.suit;
      SocketClient.emit('game:trump_call', { suit });
      closeModal();
    });
  });
}

// ── Hand result ───────────────────────────────────────────────────────────────
export function showHandResult(lastHandResult, myTeam) {
  if (!lastHandResult) return;

  const { winningTeam, tricks, isCourt, scores } = lastHandResult;
  const youWon = winningTeam === myTeam;
  const winnerText = youWon ? 'Your Team Wins!' : 'Opponents Win!';
  const color = youWon ? '#4caf50' : '#ef5350';
  const courtBadge = isCourt ? '<div class="court-badge">COURT! 🏆</div>' : '';

  const html = `
    <div class="result-modal">
      ${courtBadge}
      <div class="winner-banner" style="color:${color}">${winnerText}</div>
      <div class="trick-count">${tricks.A} — ${tricks.B}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">tricks (Team A — Team B)</div>
      <div style="font-size:14px;margin-bottom:4px;">Courts: A <strong>${scores?.A ?? 0}</strong> — B <strong>${scores?.B ?? 0}</strong></div>
      <p style="color:var(--text-muted);margin-top:12px;font-size:14px;">
        Next hand in <strong id="countdown-secs">7</strong>s...
      </p>
    </div>
  `;

  showModal(html);

  let secs = 7;
  const interval = setInterval(() => {
    secs--;
    const el = document.getElementById('countdown-secs');
    if (!el) { clearInterval(interval); return; }
    el.textContent = secs;
    if (secs <= 0) clearInterval(interval);
  }, 1000);
}

// ── Game over ─────────────────────────────────────────────────────────────────
export function showGameOver(scores, myTeam) {
  const winningTeam = scores.A > scores.B ? 'A' : 'B';
  const youWon = winningTeam === myTeam;
  const html = `
    <div class="result-modal">
      <div class="court-badge" style="background:${youWon ? 'var(--gold)' : '#ef5350'}">GAME OVER</div>
      <div class="winner-banner" style="color:${youWon ? '#4caf50' : '#ef5350'};margin-top:12px;">
        ${youWon ? 'Your Team Wins the Game!' : 'Opponents Win the Game!'}
      </div>
      <div class="trick-count">${scores.A} — ${scores.B}</div>
      <div style="font-size:13px;color:var(--text-muted);">courts (Team A — Team B)</div>
      <button class="btn-primary" style="width:100%;margin-top:24px;" onclick="window.location.href='/'">
        Back to Lobby
      </button>
    </div>
  `;
  showModal(html);
}

export { closeModal };
