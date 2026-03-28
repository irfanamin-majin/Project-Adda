const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

// Index = rank value (0 = lowest, 12 = Ace = highest)
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const SUIT_SYMBOLS = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣'
};

const PHASES = {
  WAITING: 'WAITING',
  DEALING_INITIAL: 'DEALING_INITIAL',
  CALLING_TRUMP: 'CALLING_TRUMP',
  TRICK_PLAYING: 'TRICK_PLAYING',
  HAND_OVER: 'HAND_OVER',
  GAME_OVER: 'GAME_OVER'
};

// Seat indices 0 and 2 are Team A; 1 and 3 are Team B
const TEAMS = {
  A: [0, 2],
  B: [1, 3]
};

const SOCKET_EVENTS = {
  // Client -> Server
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  GAME_START: 'game:start',
  GAME_TRUMP_CALL: 'game:trump_call',
  GAME_PLAY_CARD: 'game:play_card',
  GAME_REQUEST_STATE: 'game:request_state',

  // Server -> Client (private)
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_ERROR: 'room:error',
  GAME_HAND: 'game:hand',
  GAME_ERROR: 'game:error',

  // Server -> Client (broadcast)
  ROOM_PLAYER_JOINED: 'room:player_joined',
  ROOM_PLAYER_LEFT: 'room:player_left',
  GAME_STARTED: 'game:started',
  GAME_STATE: 'game:state',
  GAME_TRUMP_NEEDED: 'game:trump_needed',

  // Client -> Server (host only)
  GAME_ABANDON: 'game:abandon',
  // Server -> Client (broadcast)
  GAME_ABANDONED: 'game:abandoned'
};

const GAME_MODES = {
  CLASSIC: 'CLASSIC',
  DOUBLE_SIR: 'DOUBLE_SIR'
};

module.exports = { SUITS, RANKS, SUIT_SYMBOLS, PHASES, TEAMS, SOCKET_EVENTS, GAME_MODES };
