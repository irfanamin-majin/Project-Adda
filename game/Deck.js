const { SUITS, RANKS, SUIT_SYMBOLS } = require('./constants');

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let i = 0; i < RANKS.length; i++) {
      const rank = RANKS[i];
      deck.push({
        id: rank + suit[0],        // e.g. 'As', 'Kh', '10d', '2c'
        suit,
        rank,
        rankValue: i,              // 0 (2) to 12 (Ace)
        display: rank + SUIT_SYMBOLS[suit]
      });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Compare two cards to determine which wins a trick.
 * Returns 1 if cardA wins, -1 if cardB wins.
 * Rules:
 *  - Trump beats non-trump
 *  - Within same suit, higher rankValue wins
 *  - Led suit beats off-suit non-trump
 *  - Off-suit non-trump loses
 */
function compareCards(cardA, cardB, ledSuit, trumpSuit) {
  const aIsTrump = cardA.suit === trumpSuit;
  const bIsTrump = cardB.suit === trumpSuit;

  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  // Both trump or both non-trump
  if (aIsTrump && bIsTrump) {
    return cardA.rankValue > cardB.rankValue ? 1 : -1;
  }

  // Neither is trump — led suit beats off-suit
  const aIsLed = cardA.suit === ledSuit;
  const bIsLed = cardB.suit === ledSuit;

  if (aIsLed && !bIsLed) return 1;
  if (!aIsLed && bIsLed) return -1;

  // Both on same suit (both led or both off-suit)
  return cardA.rankValue > cardB.rankValue ? 1 : -1;
}

module.exports = { createDeck, shuffle, compareCards };
