// Shared Socket.IO event name constants
const EVENTS = {
  // Connection
  REGISTER: 'register',
  PLAYER_JOINED: 'player-joined',
  PLAYER_LEFT: 'player-left',
  PLAYER_ASSIGNED: 'player-assigned',

  // Controller → Server → Game
  MOVE: 'move',
  BOOST: 'boost',
  JUMP: 'jump',

  // Game → Server → All
  SCORE_UPDATE: 'score-update',
  TIMER_UPDATE: 'timer-update',
  ROUND_END: 'round-end',
  ROUND_START: 'round-start',

  // State
  GAME_STATE: 'game-state',
  CONTROLLER_CONNECTED: 'controller-connected',
  CONTROLLER_DISCONNECTED: 'controller-disconnected'
};

// Make available in both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EVENTS;
}
