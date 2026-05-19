// ── Controller Client ─────────────────────────────────────────
(function () {
  'use strict';

  // ── DOM Elements ──
  const joystickZone = document.getElementById('joystick-zone');
  const joystickThumb = document.getElementById('joystick-thumb');
  const btnBoost = document.getElementById('btn-boost');
  const btnJump = document.getElementById('btn-jump');
  const btnFlip = document.getElementById('btn-flip');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const playerDot = document.getElementById('player-dot');
  const playerName = document.getElementById('player-name');
  const waitingOverlay = document.getElementById('waiting-overlay');
  const scoreValue = document.getElementById('score-value');
  const timerValue = document.getElementById('timer-value');

  // ── Socket.IO ──
  const socket = io({ reconnection: true, reconnectionDelay: 1000 });
  let myPlayerId = null;
  let connected = false;

  socket.on('connect', () => {
    connected = true;
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected';
    socket.emit('register', { role: 'controller' });
  });

  socket.on('disconnect', () => {
    connected = false;
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Disconnected';
    waitingOverlay.classList.remove('hidden');
    waitingOverlay.querySelector('.waiting-text').textContent = 'Reconnecting...';
  });

  socket.on('player-assigned', (data) => {
    myPlayerId = data.playerId;
    playerDot.style.background = data.color;
    playerDot.style.boxShadow = `0 0 8px ${data.color}`;
    playerName.textContent = data.colorName;
    waitingOverlay.classList.add('hidden');
  });

  socket.on('error-msg', (data) => {
    waitingOverlay.querySelector('.waiting-text').textContent = data.message;
  });

  socket.on('score-update', (data) => {
    if (data.playerId === myPlayerId) scoreValue.textContent = data.score;
  });

  socket.on('timer-update', (data) => {
    const mins = Math.floor(data.timeLeft / 60);
    const secs = data.timeLeft % 60;
    timerValue.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  });

  socket.on('round-end', () => { timerValue.textContent = '0:00'; });

  // ── Joystick Logic ──
  let joystickTouchId = null;
  const joystickMaxRadius = 52;
  let lastSentX = 0, lastSentY = 0;

  function getJoystickCenter() {
    const rect = joystickZone.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function updateJoystick(clientX, clientY) {
    const center = getJoystickCenter();
    let dx = clientX - center.x;
    let dy = clientY - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > joystickMaxRadius) {
      dx = (dx / dist) * joystickMaxRadius;
      dy = (dy / dist) * joystickMaxRadius;
    }
    joystickThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = parseFloat((dx / joystickMaxRadius).toFixed(3));
    const ny = parseFloat((-(dy / joystickMaxRadius)).toFixed(3));
    return { x: nx, y: ny };
  }

  function resetJoystick() {
    joystickThumb.style.transform = 'translate(-50%, -50%)';
    joystickThumb.classList.remove('active');
    joystickTouchId = null;
    lastSentX = 0; lastSentY = 0;
    if (connected) socket.volatile.emit('move', { x: 0, y: 0 });
  }

  // Emit interval for smooth input
  let currentJoy = { x: 0, y: 0 };
  setInterval(() => {
    if (!connected) return;
    if (joystickTouchId !== null) {
      if (currentJoy.x !== lastSentX || currentJoy.y !== lastSentY) {
        socket.volatile.emit('move', currentJoy);
        lastSentX = currentJoy.x;
        lastSentY = currentJoy.y;
      }
    }
  }, 33);

  // Touch events
  joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    joystickThumb.classList.add('active');
    currentJoy = updateJoystick(touch.clientX, touch.clientY);
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchId) {
        currentJoy = updateJoystick(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
        break;
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchId) {
        resetJoystick();
        currentJoy = { x: 0, y: 0 };
        break;
      }
    }
  });

  document.addEventListener('touchcancel', () => {
    if (joystickTouchId !== null) { resetJoystick(); currentJoy = { x: 0, y: 0 }; }
  });

  // ── Boost Button ──
  let boostActive = false;
  function startBoost() {
    if (boostActive) return;
    boostActive = true;
    btnBoost.classList.add('active');
    if (connected) socket.emit('boost', { active: true });
    if (navigator.vibrate) navigator.vibrate(50);
  }
  function endBoost() {
    if (!boostActive) return;
    boostActive = false;
    btnBoost.classList.remove('active');
    if (connected) socket.emit('boost', { active: false });
  }
  btnBoost.addEventListener('touchstart', (e) => { e.preventDefault(); startBoost(); }, { passive: false });
  btnBoost.addEventListener('touchend', (e) => { e.preventDefault(); endBoost(); }, { passive: false });
  btnBoost.addEventListener('touchcancel', () => endBoost());
  btnBoost.addEventListener('mousedown', (e) => { e.preventDefault(); startBoost(); });
  btnBoost.addEventListener('mouseup', () => endBoost());
  btnBoost.addEventListener('mouseleave', () => endBoost());

  // ── Jump Button ──
  btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    btnJump.classList.add('active');
    if (connected) socket.emit('jump');
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    setTimeout(() => btnJump.classList.remove('active'), 200);
  }, { passive: false });
  btnJump.addEventListener('mousedown', (e) => {
    e.preventDefault();
    btnJump.classList.add('active');
    if (connected) socket.emit('jump');
    setTimeout(() => btnJump.classList.remove('active'), 200);
  });

  // ── Flip Button ──
  btnFlip.addEventListener('touchstart', (e) => {
    e.preventDefault();
    btnFlip.classList.add('active');
    if (connected) socket.emit('flip');
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    setTimeout(() => btnFlip.classList.remove('active'), 300);
  }, { passive: false });
  btnFlip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    btnFlip.classList.add('active');
    if (connected) socket.emit('flip');
    setTimeout(() => btnFlip.classList.remove('active'), 300);
  });

  // ── Mouse joystick fallback ──
  let mouseDown = false;
  joystickZone.addEventListener('mousedown', (e) => {
    mouseDown = true;
    joystickThumb.classList.add('active');
    joystickTouchId = -1;
    currentJoy = updateJoystick(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    currentJoy = updateJoystick(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', () => {
    if (mouseDown) { mouseDown = false; resetJoystick(); currentJoy = { x: 0, y: 0 }; }
  });

  // Prevent zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());
})();
