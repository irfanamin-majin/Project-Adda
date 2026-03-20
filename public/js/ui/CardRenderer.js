import SocketClient from '../socket-client.js';

const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

/**
 * Creates a card DOM element.
 * @param {Object} card - { id, suit, rank, display }
 * @param {Object} options - { faceDown, dimmed, onClick }
 */
export function createCardEl(card, { faceDown = false, dimmed = false, onClick = null } = {}) {
  const el = document.createElement('div');
  el.className = `card suit-${card.suit}`;
  el.dataset.cardId = card.id;

  if (faceDown) {
    el.classList.add('face-down');
    return el;
  }

  if (dimmed) el.classList.add('dimmed');

  el.innerHTML = `
    <span class="rank">${card.rank}</span>
    <span class="center-suit">${SUIT_SYMBOLS[card.suit]}</span>
    <span class="rank rank-bottom">${card.rank}</span>
  `;

  if (onClick && !dimmed) {
    el.addEventListener('click', () => onClick(card));
  }

  return el;
}

/**
 * Renders a small face-down card to represent 1 card in opponent's hand.
 */
export function createFaceDownEl() {
  const el = document.createElement('div');
  el.className = 'card face-down';
  return el;
}

/**
 * Renders the player's hand into #hand-cards.
 * @param {Card[]} cards
 * @param {boolean} isMyTurn
 * @param {string|null} ledSuit  - null if player is leading
 * @param {Function} onPlay  - called with card object when played
 */
export function renderHand(cards, isMyTurn, ledSuit, onPlay) {
  const container = document.getElementById('hand-cards');
  container.innerHTML = '';

  for (const card of cards) {
    let dimmed = false;

    if (isMyTurn && ledSuit) {
      // Dim cards that cannot be played (suit-following)
      const hasSuit = cards.some(c => c.suit === ledSuit);
      if (hasSuit && card.suit !== ledSuit) {
        dimmed = true;
      }
    } else if (!isMyTurn) {
      dimmed = false; // Don't dim during other turns, just disable click
    }

    const onClick = isMyTurn && !dimmed ? (c) => onPlay(c) : null;
    const el = createCardEl(card, { dimmed: isMyTurn && dimmed, onClick });
    container.appendChild(el);
  }
}
