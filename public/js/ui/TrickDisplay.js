import { createCardEl } from './CardRenderer.js';

/**
 * Renders the current trick in the center cross layout.
 * relPos: (absPos - mySeatIndex + 4) % 4 → 0=bottom, 1=right, 2=top, 3=left
 */
const REL_TO_POS = ['bottom', 'right', 'top', 'left'];

export function renderTrick(currentTrick, mySeatIndex) {
  // Clear all slots
  ['top', 'bottom', 'left', 'right'].forEach(pos => {
    const el = document.getElementById(`trick-${pos}`);
    if (el) el.innerHTML = '';
  });

  if (!currentTrick || !currentTrick.cards) return;

  for (const { seatIndex, card } of currentTrick.cards) {
    const relPos = (seatIndex - mySeatIndex + 4) % 4;
    const posName = REL_TO_POS[relPos];
    const slotEl = document.getElementById(`trick-${posName}`);
    if (slotEl) {
      slotEl.appendChild(createCardEl(card));
    }
  }
}
