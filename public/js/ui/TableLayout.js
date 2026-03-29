import { createFaceDownEl } from './CardRenderer.js';

/**
 * Maps relative position (0=bottom=self, 1=right, 2=top, 3=left) to DOM IDs.
 */
const POSITIONS = ['bottom', 'right', 'top', 'left'];

const CIRCUMFERENCE = 2 * Math.PI * 14; // r=14 SVG circle

/**
 * Renders the 4 player seats relative to mySeatIndex.
 * @param {Object} publicState
 * @param {number} mySeatIndex
 */
export function renderTable(publicState, mySeatIndex) {
  const { players, currentPlayerSeatIndex, turnDeadline } = publicState;

  for (let relPos = 0; relPos < 4; relPos++) {
    const absPos = (mySeatIndex + relPos) % 4;
    const posName = POSITIONS[relPos];
    const player = players[absPos];
    if (!player) continue;

    const nameEl  = document.getElementById(`name-${posName}`);
    const cardsEl = document.getElementById(`cards-${posName}`);
    const seatEl  = document.getElementById(`seat-${posName}`);

    if (!nameEl) continue;

    // Remove stale timer before re-rendering
    seatEl?.querySelector('.turn-timer')?.remove();

    // Active-turn seat highlight
    seatEl?.classList.toggle('active-turn', absPos === currentPlayerSeatIndex);

    // Name label
    nameEl.textContent = player.name || `Seat ${absPos + 1}`;
    nameEl.className = 'player-name';
    if (relPos === 0) nameEl.classList.add('you');
    if (absPos === currentPlayerSeatIndex) nameEl.classList.add('is-turn');
    if (!player.connected) nameEl.classList.add('disconnected');

    // Dealer indicator
    if (absPos === publicState.dealerSeatIndex) {
      nameEl.textContent += ' ⬤';
      nameEl.title = 'Dealer';
    }

    // "Your Turn" badge for the local player
    seatEl?.querySelector('.your-turn-badge')?.remove();
    if (relPos === 0 && absPos === currentPlayerSeatIndex) {
      const badge = document.createElement('div');
      badge.className = 'your-turn-badge';
      badge.textContent = 'Your Turn';
      seatEl.appendChild(badge);
    }

    // Countdown ring for the current player
    if (absPos === currentPlayerSeatIndex && turnDeadline) {
      const timeLeft = Math.max(0, turnDeadline - Date.now());
      const secsLeft = Math.ceil(timeLeft / 1000);
      const offset   = CIRCUMFERENCE * (1 - timeLeft / 20000);
      const urgent   = secsLeft <= 5;

      const timerEl = document.createElement('div');
      timerEl.className = 'turn-timer';
      timerEl.innerHTML = `
        <svg viewBox="0 0 36 36" width="36" height="36">
          <circle class="timer-ring${urgent ? ' urgent' : ''}" cx="18" cy="18" r="14"
            stroke-dasharray="${CIRCUMFERENCE.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}">
          </circle>
        </svg>
        <span class="timer-text${urgent ? ' urgent' : ''}">${secsLeft}</span>
      `;
      nameEl.insertAdjacentElement('afterend', timerEl);
    }

    // Face-down cards for opponents
    if (relPos !== 0 && cardsEl) {
      cardsEl.innerHTML = '';
      for (let i = 0; i < (player.cardCount || 0); i++) {
        cardsEl.appendChild(createFaceDownEl());
      }
    }
  }
}
