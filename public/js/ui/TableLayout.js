import { createFaceDownEl } from './CardRenderer.js';

/**
 * Maps relative position (0=bottom=self, 1=right, 2=top, 3=left) to DOM IDs.
 */
const POSITIONS = ['bottom', 'right', 'top', 'left'];

/**
 * Renders the 4 player seats relative to mySeatIndex.
 * @param {Object} publicState
 * @param {number} mySeatIndex
 */
export function renderTable(publicState, mySeatIndex) {
  const { players, currentPlayerSeatIndex } = publicState;

  for (let relPos = 0; relPos < 4; relPos++) {
    const absPos = (mySeatIndex + relPos) % 4;
    const posName = POSITIONS[relPos];
    const player = players[absPos];
    if (!player) continue;

    const nameEl  = document.getElementById(`name-${posName}`);
    const cardsEl = document.getElementById(`cards-${posName}`);
    const seatEl  = document.getElementById(`seat-${posName}`);

    if (!nameEl) continue;

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

    // Face-down cards for opponents
    if (relPos !== 0 && cardsEl) {
      cardsEl.innerHTML = '';
      for (let i = 0; i < (player.cardCount || 0); i++) {
        cardsEl.appendChild(createFaceDownEl());
      }
    }
  }
}
