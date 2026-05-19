// ── Remote Stunt Car — Game Client ────────────────────────────
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ═══ CONFIG ═══
const ROUND_TIME = 180;
const ENGINE_FORCE = 1500;
const BOOST_MULTIPLIER = 2.0;
const STEER_ANGLE = Math.PI / 6;
const JUMP_IMPULSE = 1000;
const JUMP_COOLDOWN = 800;

// ═══ GLOBALS ═══
let scene, camera, renderer, clock;
let world;
let players = {};
let activeCameraTarget = null;
let roundTimer = ROUND_TIME;
let roundActive = false;
let roundInterval = null;
let exhaustParticles = [];
const exhaustPool = [];
let movingObjects = [];

// DOM
const canvas = document.getElementById('game-canvas');
const gameWaiting = document.getElementById('game-waiting');
const leaderboardList = document.getElementById('leaderboard-list');
const gameTimerEl = document.getElementById('game-timer');
const hudTimerEl = document.getElementById('hud-timer');
const speedValueEl = document.getElementById('speed-value');
const roundEndOverlay = document.getElementById('round-end-overlay');
const finalScoresEl = document.getElementById('final-scores');
const restartBtn = document.getElementById('restart-btn');
const ipDisplay = document.getElementById('game-ip-display');
if (ipDisplay) ipDisplay.textContent = `${location.protocol}//${location.host}`;

// ═══ SOCKET.IO ═══
const socket = io({ reconnection: true });

socket.on('connect', () => socket.emit('register', { role: 'game' }));

socket.on('player-joined', (data) => {
  addPlayer(data.playerId, data.color, data.colorName);
  updateWaitingScreen();
  if (!roundActive) startRound();
});

socket.on('player-left', (data) => {
  removePlayer(data.playerId);
  updateWaitingScreen();
});

socket.on('move', (data) => {
  const p = players[data.playerId];
  if (p) { p.input.x = data.x; p.input.y = data.y; }
});

socket.on('boost', (data) => {
  const p = players[data.playerId];
  if (p) p.input.boost = data.active;
});

socket.on('jump', (data) => {
  const p = players[data.playerId];
  if (p) p.input.jumpRequest = true;
});

socket.on('flip', (data) => {
  const p = players[data.playerId];
  if (p) {
    const pos = p.chassisBody.position;
    p.chassisBody.position.set(pos.x, pos.y + 3, pos.z);
    p.chassisBody.quaternion.set(0, 0, 0, 1);
    p.chassisBody.velocity.set(0, 0, 0);
    p.chassisBody.angularVelocity.set(0, 0, 0);
  }
});

// ═══ SOUND SYSTEM ═══
let audioCtx;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBoostSound() {
  ensureAudio();
  const dur = 0.5;
  // Deep rumble
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(50, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(140, audioCtx.currentTime + 0.1);
  osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + dur);

  // Whoosh noise
  const noise = audioCtx.createBufferSource();
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
  noise.buffer = buf;

  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(600, audioCtx.currentTime);
  bp.frequency.exponentialRampToValueAtTime(2500, audioCtx.currentTime + 0.08);
  bp.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + dur);
  bp.Q.value = 2;

  const g1 = audioCtx.createGain();
  g1.gain.setValueAtTime(0.4, audioCtx.currentTime);
  g1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);

  const g2 = audioCtx.createGain();
  g2.gain.setValueAtTime(0.2, audioCtx.currentTime);
  g2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);

  osc.connect(g2); g2.connect(audioCtx.destination);
  noise.connect(bp); bp.connect(g1); g1.connect(audioCtx.destination);
  osc.start(); noise.start();
  osc.stop(audioCtx.currentTime + dur);
  noise.stop(audioCtx.currentTime + dur);
}

function playJumpSound() {
  ensureAudio();
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(350, audioCtx.currentTime + 0.15);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.5, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.3);
}

function playLandingSound() {
  ensureAudio();
  const dur = 0.2;
  const n = audioCtx.createBufferSource();
  const b = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
  n.buffer = b;
  const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.6, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
  n.connect(f); f.connect(g); g.connect(audioCtx.destination);
  n.start(); n.stop(audioCtx.currentTime + dur);
}

function playScoreChime() {
  ensureAudio();
  const osc = audioCtx.createOscillator();
  osc.type = 'sine'; osc.frequency.value = 880;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.2, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.4);
}

function playRoundEndSound() {
  ensureAudio();
  [0, 0.15, 0.3].forEach((delay, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = [523, 659, 784][i];
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.3, audioCtx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + delay + 0.5);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + delay);
    osc.stop(audioCtx.currentTime + delay + 0.5);
  });
}

// Engine hum
const engineHums = {};
function updateEngineHum(pid, speed) {
  ensureAudio();
  if (!engineHums[pid]) {
    const osc = audioCtx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
    const g = audioCtx.createGain(); g.gain.value = 0;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
    osc.connect(f); f.connect(g); g.connect(audioCtx.destination); osc.start();
    engineHums[pid] = { osc, gain: g, filter: f };
  }
  const h = engineHums[pid];
  const s = Math.abs(speed);
  h.osc.frequency.setTargetAtTime(60 + s * 2, audioCtx.currentTime, 0.1);
  h.filter.frequency.setTargetAtTime(200 + s * 5, audioCtx.currentTime, 0.1);
  h.gain.gain.setTargetAtTime(Math.min(0.08, s * 0.003), audioCtx.currentTime, 0.1);
}

function stopEngineHum(pid) {
  if (engineHums[pid]) {
    engineHums[pid].gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    setTimeout(() => { try { engineHums[pid].osc.stop(); } catch(e){} delete engineHums[pid]; }, 500);
  }
}

// ═══ EXHAUST FIRE PARTICLES ═══
function initExhaustParticles() {
  for (let i = 0; i < 80; i++) {
    const geo = new THREE.SphereGeometry(0.12, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    exhaustPool.push(mesh);
  }
}

function emitFire(position, backward) {
  const mesh = exhaustPool.find(m => !m.visible);
  if (!mesh) return;
  mesh.visible = true;
  mesh.position.copy(position);
  mesh.scale.set(1, 1, 1);
  mesh.material.opacity = 1;
  mesh.material.color.setHex([0xff4400, 0xff8800, 0xffcc00, 0xff6600][Math.floor(Math.random() * 4)]);
  exhaustParticles.push({
    mesh,
    vx: backward.x * 4 + (Math.random() - 0.5) * 2,
    vy: backward.y * 4 + Math.random() * 2 + 1,
    vz: backward.z * 4 + (Math.random() - 0.5) * 2,
    life: 0.3 + Math.random() * 0.3,
    age: 0
  });
}

function updateExhaustParticles(dt) {
  for (let i = exhaustParticles.length - 1; i >= 0; i--) {
    const p = exhaustParticles[i];
    p.age += dt;
    if (p.age >= p.life) {
      p.mesh.visible = false;
      exhaustParticles.splice(i, 1);
      continue;
    }
    const t = p.age / p.life;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.material.opacity = 1 - t;
    p.mesh.scale.setScalar(1 + t * 0.5);
    p.mesh.material.color.setHSL(0.07 + t * 0.1, 1, 0.5 + t * 0.3);
  }
}

// ═══ THREE.JS SETUP ═══
function initThree() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x88bbee, 0.004);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 500);
  camera.position.set(0, 10, 15);

  // Bright sky hemisphere
  const ambientLight = new THREE.AmbientLight(0xaaccee, 0.8);
  scene.add(ambientLight);
  const hemiLight = new THREE.HemisphereLight(0x88bbff, 0x557744, 0.7);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.5);
  dirLight.position.set(30, 50, 30);
  dirLight.castShadow = true;
  dirLight.shadow.camera.left = -80; dirLight.shadow.camera.right = 80;
  dirLight.shadow.camera.top = 80; dirLight.shadow.camera.bottom = -80;
  dirLight.shadow.mapSize.width = 2048; dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  // Sky - bright gradient
  const skyGeo = new THREE.SphereGeometry(200, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x3399ff) },
      bottomColor: { value: new THREE.Color(0xbbddff) },
      offset: { value: 20 }, exponent: { value: 0.5 }
    },
    vertexShader: `varying vec3 vWP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWP=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 topColor;uniform vec3 bottomColor;uniform float offset;uniform float exponent;varying vec3 vWP; void main(){ float h=normalize(vWP+offset).y; gl_FragColor=vec4(mix(bottomColor,topColor,max(pow(max(h,0.0),exponent),0.0)),1.0); }`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Clouds (simple white spheres)
  for (let i = 0; i < 15; i++) {
    const cloudGroup = new THREE.Group();
    const count = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < count; j++) {
      const s = 3 + Math.random() * 5;
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(s, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 })
      );
      c.position.set(j * 4 - count * 2, Math.random() * 2, Math.random() * 3);
      cloudGroup.add(c);
    }
    cloudGroup.position.set(
      (Math.random() - 0.5) * 300,
      50 + Math.random() * 30,
      (Math.random() - 0.5) * 300
    );
    scene.add(cloudGroup);
  }

  clock = new THREE.Clock();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ═══ CANNON-ES ═══
let groundMat, carMat;
function initPhysics() {
  world = new CANNON.World();
  world.gravity.set(0, -20, 0);
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  groundMat = new CANNON.Material('ground');
  carMat = new CANNON.Material('car');
  const carGroundContact = new CANNON.ContactMaterial(carMat, groundMat, {
    friction: 0.6, restitution: 0.1
  });
  world.addContactMaterial(carGroundContact);
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.1;
}

// ═══ STUNT TRACK ═══
function buildTrack() {
  const gm = groundMat;

  // Ground
  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: gm });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.95, metalness: 0 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Grid overlay
  const grid = new THREE.GridHelper(200, 40, 0x55aa55, 0x55aa55);
  grid.material.transparent = true; grid.material.opacity = 0.15;
  grid.position.y = 0.01;
  scene.add(grid);

  function addBox(x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)), material: gm });
    body.position.set(x, y, z);
    if (rx || ry || rz) body.quaternion.setFromEuler(rx, ry, rz);
    world.addBody(body);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    return { body, mesh };
  }

  // ── Ramp 1: Blue ramp (front-right) ──
  const r1 = new CANNON.Body({ mass: 0, material: gm });
  r1.addShape(new CANNON.Box(new CANNON.Vec3(3, 0.3, 5)));
  r1.position.set(20, 1.2, -15);
  r1.quaternion.setFromEuler(-0.25, 0, 0);
  world.addBody(r1);
  const r1m = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 10),
    new THREE.MeshStandardMaterial({ color: 0x42a5f5, roughness: 0.3, metalness: 0.4 }));
  r1m.position.copy(r1.position); r1m.quaternion.copy(r1.quaternion);
  r1m.castShadow = true; r1m.receiveShadow = true; scene.add(r1m);

  // ── Ramp 2: Pink ramp (left) ──
  const r2 = new CANNON.Body({ mass: 0, material: gm });
  r2.addShape(new CANNON.Box(new CANNON.Vec3(4, 0.3, 6)));
  r2.position.set(-20, 1.5, 10);
  r2.quaternion.setFromEuler(0.3, 0.5, 0);
  world.addBody(r2);
  const r2m = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 12),
    new THREE.MeshStandardMaterial({ color: 0xec407a, roughness: 0.3, metalness: 0.4 }));
  r2m.position.copy(r2.position); r2m.quaternion.copy(r2.quaternion);
  r2m.castShadow = true; scene.add(r2m);

  // ── Ramp 3: Yellow kicker ──
  const r3 = new CANNON.Body({ mass: 0, material: gm });
  r3.addShape(new CANNON.Box(new CANNON.Vec3(3, 0.3, 3)));
  r3.position.set(0, 1.0, -30);
  r3.quaternion.setFromEuler(-0.4, 0, 0);
  world.addBody(r3);
  const r3m = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 6),
    new THREE.MeshStandardMaterial({ color: 0xffca28, roughness: 0.3, metalness: 0.4 }));
  r3m.position.copy(r3.position); r3m.quaternion.copy(r3.quaternion);
  r3m.castShadow = true; scene.add(r3m);

  // ── Loop (correct inward-facing geometry) ──
  const loopR = 10, loopSeg = 40;
  const loopCY = loopR + 0.1, loopCZ = -50;
  const segLen = (2 * Math.PI * loopR / loopSeg) * 1.35;
  for (let i = 0; i < loopSeg; i++) {
    const a = (i / loopSeg) * Math.PI * 2;
    const py = loopCY - loopR * Math.cos(a);
    const pz = loopCZ + loopR * Math.sin(a);
    const sb = new CANNON.Body({ mass: 0, material: gm });
    sb.addShape(new CANNON.Box(new CANNON.Vec3(3.5, 0.25, segLen / 2)));
    sb.position.set(0, py, pz);
    sb.quaternion.setFromEuler(-a, 0, 0);
    world.addBody(sb);
    const sm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, segLen),
      new THREE.MeshStandardMaterial({ color: 0xff7043, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
    sm.position.copy(sb.position); sm.quaternion.copy(sb.quaternion);
    sm.castShadow = true; scene.add(sm);
    [-3.3, 3.3].forEach(xOff => {
      const rail = new CANNON.Body({ mass: 0, material: gm });
      rail.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.6, segLen / 2)));
      rail.position.set(xOff, py, pz);
      rail.quaternion.setFromEuler(-a, 0, 0);
      world.addBody(rail);
      const rm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, segLen),
        new THREE.MeshStandardMaterial({ color: 0xffab91, transparent: true, opacity: 0.4 }));
      rm.position.copy(rail.position); rm.quaternion.copy(rail.quaternion);
      scene.add(rm);
    });
  }
  // Approach ramp to loop
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const rz = -35 - i * 2;
    const ry = t * 1.5;
    const ra = -t * 0.15;
    const rb = new CANNON.Body({ mass: 0, material: gm });
    rb.addShape(new CANNON.Box(new CANNON.Vec3(3.5, 0.2, 1.2)));
    rb.position.set(0, ry, rz); rb.quaternion.setFromEuler(ra, 0, 0);
    world.addBody(rb);
    const rm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 2.4),
      new THREE.MeshStandardMaterial({ color: 0xff8a65, roughness: 0.4, metalness: 0.3 }));
    rm.position.copy(rb.position); rm.quaternion.copy(rb.quaternion); scene.add(rm);
  }

  // ── Mega Ramp (far side) ──
  const megaBody = new CANNON.Body({ mass: 0, material: gm });
  megaBody.addShape(new CANNON.Box(new CANNON.Vec3(5, 0.3, 10)));
  megaBody.position.set(-40, 3, -30);
  megaBody.quaternion.setFromEuler(-0.35, 0.2, 0);
  world.addBody(megaBody);
  const megaMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 20),
    new THREE.MeshStandardMaterial({ color: 0x7c4dff, roughness: 0.3, metalness: 0.5 }));
  megaMesh.position.copy(megaBody.position); megaMesh.quaternion.copy(megaBody.quaternion);
  megaMesh.castShadow = true; scene.add(megaMesh);

  // ── Half-pipe ──
  const hpSegs = 12;
  for (let i = 0; i < hpSegs; i++) {
    const a = (i / (hpSegs - 1)) * Math.PI - Math.PI / 2;
    const hpR = 6;
    const hpx = 40 + hpR * Math.cos(a);
    const hpy = hpR + hpR * Math.sin(a);
    const hb = new CANNON.Body({ mass: 0, material: gm });
    hb.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.2, 10)));
    hb.position.set(hpx, hpy, -10);
    hb.quaternion.setFromEuler(0, 0, a);
    world.addBody(hb);
    const hm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x00bcd4, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide }));
    hm.position.copy(hb.position); hm.quaternion.copy(hb.quaternion);
    hm.castShadow = true; scene.add(hm);
  }

  // ── Double ramp jump ──
  [[-15, -40], [-15, -28]].forEach(([rx, rz], idx) => {
    const dr = new CANNON.Body({ mass: 0, material: gm });
    dr.addShape(new CANNON.Box(new CANNON.Vec3(3, 0.3, 3)));
    dr.position.set(rx, 1, rz);
    dr.quaternion.setFromEuler(idx === 0 ? -0.35 : 0.35, 0, 0);
    world.addBody(dr);
    const dm = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 6),
      new THREE.MeshStandardMaterial({ color: idx === 0 ? 0x26a69a : 0x42a5f5, roughness: 0.3, metalness: 0.4 }));
    dm.position.copy(dr.position); dm.quaternion.copy(dr.quaternion);
    dm.castShadow = true; scene.add(dm);
  });

  // ── Fun obstacles (static) ──
  const obs = [
    [10, 0.5, 5, 1, 1, 1, 0xab47bc],
    [-12, 0.75, -5, 1.5, 1.5, 1.5, 0x26c6da],
    [30, 0.5, 10, 1, 1, 2, 0xef5350],
    [-25, 0.5, -20, 2, 1, 1, 0xffa726],
    [15, 0.5, 25, 1, 1, 1, 0x66bb6a],
    [-8, 1, 30, 2, 2, 2, 0x7e57c2],
    [35, 0.5, -25, 1, 1, 3, 0x29b6f6],
    [-30, 0.5, 15, 3, 1, 1, 0xf06292],
    [25, 1, -40, 2, 2, 2, 0xec407a],
    [-35, 0.5, -40, 1, 1, 4, 0x5c6bc0],
    [50, 0.5, -15, 2, 1, 2, 0x66bb6a],
    [-50, 1, 25, 3, 2, 1, 0xffa726],
  ];
  obs.forEach(([x, y, z, sx, sy, sz, c]) => addBox(x, y, z, sx, sy, sz, c));

  // ── MOVING OBSTACLES ──
  // 1) Spinning platforms
  [{ x: 20, z: 20, color: 0xe040fb }, { x: -35, z: -10, color: 0x40c4ff }].forEach(cfg => {
    const sb = new CANNON.Body({ mass: 0, material: gm });
    sb.addShape(new CANNON.Box(new CANNON.Vec3(4, 0.3, 1)));
    sb.position.set(cfg.x, 0.3, cfg.z);
    world.addBody(sb);
    const sm = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 2),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.3, metalness: 0.5 }));
    sm.position.copy(sb.position); sm.castShadow = true; scene.add(sm);
    movingObjects.push({ type: 'spin', body: sb, mesh: sm, speed: 0.8, cx: cfg.x, cz: cfg.z });
  });

  // 2) Sliding walls
  [{ x: 0, z: 50, axis: 'x', range: 15, color: 0xff5252 },
   { x: -20, z: -55, axis: 'x', range: 12, color: 0x69f0ae }].forEach(cfg => {
    const wb = new CANNON.Body({ mass: 0, material: gm });
    wb.addShape(new CANNON.Box(new CANNON.Vec3(1, 1.5, 0.5)));
    wb.position.set(cfg.x, 1.5, cfg.z);
    world.addBody(wb);
    const wm = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.4, metalness: 0.3 }));
    wm.position.copy(wb.position); wm.castShadow = true; scene.add(wm);
    movingObjects.push({ type: 'slide', body: wb, mesh: wm, axis: cfg.axis, center: cfg.x, range: cfg.range, speed: 0.5 + Math.random() * 0.3 });
  });

  // 3) Swinging pendulum
  const pendPivotY = 8, pendLen = 6;
  const pendBall = new CANNON.Body({ mass: 0, material: gm });
  pendBall.addShape(new CANNON.Sphere(1.2));
  pendBall.position.set(45, pendPivotY - pendLen, 0);
  world.addBody(pendBall);
  const pendMesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xff6e40, roughness: 0.3, metalness: 0.6 }));
  pendMesh.castShadow = true; scene.add(pendMesh);
  // Chain visual
  const chainMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, pendLen, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9 }));
  scene.add(chainMesh);
  // Pivot post
  const postMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2, 8),
    new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.9 }));
  postMesh.position.set(45, pendPivotY + 1, 0); scene.add(postMesh);
  movingObjects.push({ type: 'pendulum', body: pendBall, mesh: pendMesh, chain: chainMesh,
    px: 45, pivotY: pendPivotY, pz: 0, len: pendLen, speed: 1.2 });

  // 4) Rotating barrier arms
  [{ x: -10, z: 45, color: 0xffab40 }, { x: 30, z: -50, color: 0x448aff }].forEach(cfg => {
    const ab = new CANNON.Body({ mass: 0, material: gm });
    ab.addShape(new CANNON.Box(new CANNON.Vec3(6, 0.4, 0.4)));
    ab.position.set(cfg.x, 1, cfg.z);
    world.addBody(ab);
    const am = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.3, metalness: 0.5 }));
    am.position.copy(ab.position); am.castShadow = true; scene.add(am);
    // Center post
    const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2, 8),
      new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8 }));
    cp.position.set(cfg.x, 1, cfg.z); scene.add(cp);
    movingObjects.push({ type: 'spin', body: ab, mesh: am, speed: 0.6, cx: cfg.x, cz: cfg.z });
  });

  // ── Walls (semi-transparent) ──
  const arenaS = 80, wh = 3;
  [[0, wh/2, -arenaS, arenaS*2, wh, 1], [0, wh/2, arenaS, arenaS*2, wh, 1],
   [-arenaS, wh/2, 0, 1, wh, arenaS*2], [arenaS, wh/2, 0, 1, wh, arenaS*2]].forEach(([x,y,z,sx,sy,sz]) => {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)), material: gm });
    b.position.set(x, y, z); world.addBody(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color: 0x90caf9, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.3 }));
    m.position.copy(b.position); scene.add(m);
  });

  // ── Decorative trees ──
  for (let i = 0; i < 32; i++) {
    const ang = (i / 32) * Math.PI * 2;
    const dist = 75;
    const px = Math.cos(ang) * dist, pz = Math.sin(ang) * dist;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0x8d6e63 }));
    trunk.position.set(px, 2, pz); trunk.castShadow = true; scene.add(trunk);
    const foliage = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 8),
      new THREE.MeshStandardMaterial({ color: [0x43a047, 0x66bb6a, 0x2e7d32][i%3], roughness: 0.9 }));
    foliage.position.set(px, 5.5, pz); foliage.castShadow = true; scene.add(foliage);
  }
}

// ═══ CAR CREATION ═══
const WHEEL_POSITIONS = [
  [-0.85, -0.35, 1.4],  // front-left
  [0.85, -0.35, 1.4],   // front-right
  [-0.85, -0.35, -1.4],  // rear-left
  [0.85, -0.35, -1.4],   // rear-right
];

function createCar(playerId, color) {
  const hexColor = new THREE.Color(color);

  // Simple rigid body — no suspension to break
  const chassisBody = new CANNON.Body({ mass: 80, material: carMat });
  // Main chassis collision box
  chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.3, 2)));
  // Add 4 perfectly smooth spheres for wheels to slide on
  WHEEL_POSITIONS.forEach(([wx, wy, wz]) => {
    chassisBody.addShape(new CANNON.Sphere(0.33), new CANNON.Vec3(wx, wy, wz));
  });
  
  const sa = Math.random() * Math.PI * 2, sd = 8 + Math.random() * 8;
  chassisBody.position.set(Math.cos(sa)*sd, 2, Math.sin(sa)*sd);
  chassisBody.angularDamping = 0.98;
  chassisBody.linearDamping = 0.5; // Natural drag limits top speed and airborne flying
  world.addBody(chassisBody);

  // Chassis mesh
  const bodyGroup = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({ color: hexColor, roughness: 0.2, metalness: 0.8 });

  const mainBody = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 4), mainMat);
  mainBody.castShadow = true; bodyGroup.add(mainBody);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.7 }));
  cabin.position.set(0, 0.45, 0.3); bodyGroup.add(cabin);

  // Spoiler (back of car = -Z)
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), mainMat);
  spoiler.position.set(0, 0.6, -1.8); bodyGroup.add(spoiler);
  [-0.7, 0.7].forEach(x => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9 }));
    post.position.set(x, 0.4, -1.8); bodyGroup.add(post);
  });

  // Headlights (front = +Z)
  [-0.6, 0.6].forEach(x => {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 1 }));
    hl.position.set(x, 0, 2); bodyGroup.add(hl);
  });

  // Taillights (back = -Z)
  [-0.7, 0.7].forEach(x => {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.8 }));
    tl.position.set(x, 0.05, -2); bodyGroup.add(tl);
  });

  // Underglow
  const ug = new THREE.PointLight(hexColor, 0.6, 4);
  ug.position.set(0, -0.3, 0); bodyGroup.add(ug);

  // Fixed wheels — children of bodyGroup, no physics, no sinking!
  const wheelMeshes = [];
  WHEEL_POSITIONS.forEach(([wx, wy, wz]) => {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 16),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 }));
    tire.rotation.z = Math.PI / 2; wg.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8),
      new THREE.MeshStandardMaterial({ color: hexColor, metalness: 0.9, roughness: 0.2 }));
    rim.rotation.z = Math.PI / 2; wg.add(rim);
    wg.position.set(wx, wy, wz);
    bodyGroup.add(wg); // FIXED to chassis — never sinks!
    wheelMeshes.push(wg);
  });

  scene.add(bodyGroup);

  // Name tag
  const nc = document.createElement('canvas'); nc.width = 256; nc.height = 64;
  const ctx = nc.getContext('2d');
  ctx.fillStyle = color; ctx.font = 'bold 32px Outfit, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(playerId.replace('player-', 'P'), 128, 40);
  const nt = new THREE.CanvasTexture(nc);
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5),
    new THREE.MeshBasicMaterial({ map: nt, transparent: true, depthTest: false }));
  nm.renderOrder = 999; scene.add(nm);

  return {
    chassisBody, chassisMesh: bodyGroup, wheelMeshes, nameMesh: nm,
    color, input: { x: 0, y: 0, boost: false, jumpRequest: false },
    score: 0, lastJumpTime: 0, wasAirborne: false, airStartTime: 0,
    totalRotation: 0, lastQuaternion: new CANNON.Quaternion(), colorName: '',
    boostSoundCooldown: 0, wheelSpin: 0
  };
}

// ═══ PLAYER MANAGEMENT ═══
function addPlayer(pid, color, colorName) {
  if (players[pid]) return;
  const car = createCar(pid, color);
  car.colorName = colorName;
  players[pid] = car;
  if (!activeCameraTarget) activeCameraTarget = pid;
  updateLeaderboard();
  showToast(`${colorName} player joined! 🏎️`, color);
}

function removePlayer(pid) {
  const p = players[pid];
  if (!p) return;
  world.removeBody(p.chassisBody);
  scene.remove(p.chassisMesh);
  scene.remove(p.nameMesh);
  stopEngineHum(pid);
  if (activeCameraTarget === pid) {
    const rem = Object.keys(players).filter(id => id !== pid);
    activeCameraTarget = rem.length > 0 ? rem[0] : null;
  }
  delete players[pid];
  updateLeaderboard();
}

// ═══ ROUND / TIMER ═══
function startRound() {
  roundTimer = ROUND_TIME; roundActive = true;
  roundEndOverlay.classList.remove('visible');
  Object.values(players).forEach(p => p.score = 0);
  updateLeaderboard();
  if (roundInterval) clearInterval(roundInterval);
  roundInterval = setInterval(() => {
    if (!roundActive) return;
    roundTimer--;
    const m = Math.floor(roundTimer / 60), s = roundTimer % 60;
    gameTimerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    hudTimerEl.classList.remove('warning', 'critical');
    if (roundTimer <= 10) hudTimerEl.classList.add('critical');
    else if (roundTimer <= 30) hudTimerEl.classList.add('warning');
    socket.emit('timer-update', { timeLeft: roundTimer });
    if (roundTimer <= 0) endRound();
  }, 1000);
}

function endRound() {
  roundActive = false;
  if (roundInterval) clearInterval(roundInterval);
  playRoundEndSound();
  const sorted = Object.entries(players)
    .map(([id, p]) => ({ id, score: p.score, color: p.color, colorName: p.colorName }))
    .sort((a, b) => b.score - a.score);
  finalScoresEl.innerHTML = '';
  sorted.forEach((e, i) => {
    const d = document.createElement('div'); d.className = 'final-score-entry';
    d.innerHTML = `<span class="final-rank" style="color:${e.color}">#${i+1}</span>
      <span class="final-name"><span class="lb-color" style="background:${e.color}"></span>${e.colorName}</span>
      <span class="final-points">${e.score}</span>`;
    finalScoresEl.appendChild(d);
  });
  roundEndOverlay.classList.add('visible');
  socket.emit('round-end', { scores: sorted });
}

restartBtn.addEventListener('click', () => {
  Object.values(players).forEach(p => {
    const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 10;
    p.chassisBody.position.set(Math.cos(a)*d, 3, Math.sin(a)*d);
    p.chassisBody.velocity.setZero(); p.chassisBody.angularVelocity.setZero();
    p.chassisBody.quaternion.set(0,0,0,1); p.score = 0;
  });
  startRound(); ensureAudio();
});

// ═══ SCORING ═══
function checkScoring(pid, p) {
  const pos = p.chassisBody.position;
  const isAirborne = pos.y > 1.2;
  if (isAirborne && !p.wasAirborne) {
    p.airStartTime = performance.now();
    p.totalRotation = 0;
    p.lastQuaternion.copy(p.chassisBody.quaternion);
  }
  if (isAirborne) {
    const cQ = p.chassisBody.quaternion;
    const dot = Math.abs(p.lastQuaternion.x*cQ.x + p.lastQuaternion.y*cQ.y + p.lastQuaternion.z*cQ.z + p.lastQuaternion.w*cQ.w);
    p.totalRotation += 2 * Math.acos(Math.min(1, dot));
    p.lastQuaternion.copy(cQ);
  }
  if (!isAirborne && p.wasAirborne) {
    const airTime = (performance.now() - p.airStartTime) / 1000;
    let pts = 0;
    if (airTime > 0.5) { pts += Math.floor(airTime * 10); playLandingSound(); }
    const flips = Math.floor(p.totalRotation / (Math.PI * 1.5));
    if (flips > 0) pts += flips * 50;
    if (pts > 0) {
      p.score += pts;
      showScorePopup(`+${pts}`, p.color);
      playScoreChime();
      updateLeaderboard();
      socket.emit('score-update', { playerId: pid, score: p.score });
    }
  }
  if (Math.abs(p.chassisBody.velocity.length()) > 20) {
    p.score += 1;
    if (Math.random() < 0.02) {
      updateLeaderboard();
      socket.emit('score-update', { playerId: pid, score: p.score });
    }
  }
  p.wasAirborne = isAirborne;
  if (pos.y < -20) {
    p.chassisBody.position.set(0, 5, 0);
    p.chassisBody.velocity.setZero(); p.chassisBody.angularVelocity.setZero();
    p.chassisBody.quaternion.set(0,0,0,1);
  }
}

// ═══ UI ═══
function updateLeaderboard() {
  const sorted = Object.entries(players)
    .map(([id, p]) => ({ id, score: p.score, color: p.color, colorName: p.colorName }))
    .sort((a, b) => b.score - a.score);
  if (!sorted.length) { leaderboardList.innerHTML = '<div class="leaderboard-entry" style="color:var(--text-dim)">Waiting for players...</div>'; return; }
  leaderboardList.innerHTML = sorted.map(e => `<div class="leaderboard-entry"><div class="lb-player"><span class="lb-color" style="background:${e.color};box-shadow:0 0 6px ${e.color}"></span><span class="lb-name">${e.colorName}</span></div><span class="lb-score">${e.score}</span></div>`).join('');
}

function updateWaitingScreen() {
  const c = Object.keys(players).length;
  gameWaiting.classList.toggle('hidden', c > 0);
  const slots = document.querySelectorAll('.player-slot');
  const pl = Object.values(players);
  slots.forEach((s, i) => {
    if (i < pl.length) { s.classList.add('filled'); s.style.borderColor = pl[i].color; s.textContent = '🏎️'; }
    else { s.classList.remove('filled'); s.style.borderColor = ''; s.textContent = '?'; }
  });
}

function showToast(msg, color = '#42a5f5') {
  const t = document.createElement('div'); t.className = 'toast';
  t.style.borderLeft = `3px solid ${color}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

function showScorePopup(text, color) {
  const p = document.createElement('div'); p.className = 'score-popup';
  p.style.color = color; p.textContent = text;
  document.body.appendChild(p); setTimeout(() => p.remove(), 1000);
}

// ═══ CAMERA ═══
let camSmooth = new THREE.Vector3(0, 10, 15);

function updateCamera() {
  if (!activeCameraTarget || !players[activeCameraTarget]) return;
  const p = players[activeCameraTarget];
  const pos = new THREE.Vector3().copy(p.chassisBody.position);
  const quat = new THREE.Quaternion().copy(p.chassisBody.quaternion);
  // Car drives in +Z direction. Camera behind = -Z offset
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  const desired = pos.clone()
    .add(fwd.clone().multiplyScalar(-10))
    .add(new THREE.Vector3(0, 5, 0));
  camSmooth.lerp(desired, 0.06);
  camera.position.copy(camSmooth);
  const lookAt = pos.clone()
    .add(fwd.clone().multiplyScalar(6))
    .add(new THREE.Vector3(0, 0.5, 0));
  camera.lookAt(lookAt);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ids = Object.keys(players);
    if (ids.length <= 1) return;
    const idx = ids.indexOf(activeCameraTarget);
    activeCameraTarget = ids[(idx + 1) % ids.length];
    showToast(`📷 Following: ${players[activeCameraTarget].colorName}`, players[activeCameraTarget].color);
  }
});

// ═══ VEHICLE UPDATE ═══
function updateVehicles(dt) {
  Object.entries(players).forEach(([pid, p]) => {
    const { chassisBody, input } = p;
    const force = input.boost ? ENGINE_FORCE * BOOST_MULTIPLIER : ENGINE_FORCE;
    const speed = chassisBody.velocity.length();

    // Get car directions from quaternion
    const fwdC = new CANNON.Vec3(0, 0, 1);
    chassisBody.quaternion.vmult(fwdC, fwdC);
    const rightC = new CANNON.Vec3(1, 0, 0);
    chassisBody.quaternion.vmult(rightC, rightC);

    // Drive: apply force in car's local forward (+Z) direction
    if (Math.abs(input.y) > 0.05) {
      chassisBody.applyLocalForce(
        new CANNON.Vec3(0, 0, input.y * force),
        new CANNON.Vec3(0, 0, 0)
      );
    }

    // Steer: yaw torque scales with speed for natural feel
    if (Math.abs(input.x) > 0.05 && speed > 0.5) {
      const steerPower = Math.min(speed * 1.5, 60);
      chassisBody.applyTorque(new CANNON.Vec3(0, -input.x * steerPower, 0));
    }

    // Lateral friction — kill sideways sliding
    const latVel = rightC.scale(chassisBody.velocity.dot(rightC));
    chassisBody.velocity.x -= latVel.x * 0.12;
    chassisBody.velocity.z -= latVel.z * 0.12;

    // Braking when no input
    if (Math.abs(input.y) < 0.05 && Math.abs(input.x) < 0.05) {
      chassisBody.velocity.x *= 0.96;
      chassisBody.velocity.z *= 0.96;
    }

    // Keep car upright — gentle restoring torque (only when on ground)
    const upC = new CANNON.Vec3(0, 1, 0);
    chassisBody.quaternion.vmult(upC, upC);
    if (chassisBody.position.y < 2 && upC.y < 0.98) {
      chassisBody.applyTorque(new CANNON.Vec3(
        -upC.z * 15,
        0,
        upC.x * 15
      ));
    }

    // Jump
    const now = Date.now();
    if (input.jumpRequest && (now - p.lastJumpTime > JUMP_COOLDOWN)) {
      chassisBody.applyImpulse(new CANNON.Vec3(0, JUMP_IMPULSE, 0), new CANNON.Vec3(0, 0, 0));
      p.lastJumpTime = now;
      playJumpSound();
    }
    input.jumpRequest = false;

    // Boost fire — exhaust from BACK of car (-Z)
    if (input.boost) {
      const q = new THREE.Quaternion().copy(chassisBody.quaternion);
      const backward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const carPos = new THREE.Vector3().copy(chassisBody.position);
      const exhaust1 = new THREE.Vector3(-0.5, -0.1, -2).applyQuaternion(q).add(carPos);
      const exhaust2 = new THREE.Vector3(0.5, -0.1, -2).applyQuaternion(q).add(carPos);
      emitFire(exhaust1, backward);
      emitFire(exhaust2, backward);

      p.boostSoundCooldown -= dt;
      if (p.boostSoundCooldown <= 0) {
        playBoostSound();
        p.boostSoundCooldown = 0.4;
      }
    } else {
      p.boostSoundCooldown = 0;
    }

    // Engine hum
    updateEngineHum(pid, speed);

    // Sync chassis mesh (wheels are children — auto-sync!)
    p.chassisMesh.position.copy(chassisBody.position);
    p.chassisMesh.quaternion.copy(chassisBody.quaternion);

    // Spin wheel meshes based on speed
    p.wheelSpin += speed * dt * 3;
    p.wheelMeshes.forEach(w => {
      w.children[0].rotation.x = p.wheelSpin;
      w.children[1].rotation.x = p.wheelSpin;
    });

    // Name tag
    p.nameMesh.position.set(chassisBody.position.x, chassisBody.position.y + 2, chassisBody.position.z);
    p.nameMesh.lookAt(camera.position);

    if (roundActive) checkScoring(pid, p);
    if (pid === activeCameraTarget) speedValueEl.textContent = Math.round(speed * 3.6);
  });
}

// ═══ MOVING OBJECTS UPDATE ═══
let gameTime = 0;
function updateMovingObjects(dt) {
  gameTime += dt;
  movingObjects.forEach(obj => {
    if (obj.type === 'spin') {
      const angle = gameTime * obj.speed;
      obj.body.quaternion.setFromEuler(0, angle, 0);
      obj.mesh.quaternion.copy(obj.body.quaternion);
      obj.body.position.set(obj.cx, obj.body.position.y, obj.cz);
    } else if (obj.type === 'slide') {
      const offset = Math.sin(gameTime * obj.speed) * obj.range;
      if (obj.axis === 'x') {
        obj.body.position.x = obj.center + offset;
      } else {
        obj.body.position.z = obj.center + offset;
      }
      obj.mesh.position.copy(obj.body.position);
    } else if (obj.type === 'pendulum') {
      const swing = Math.sin(gameTime * obj.speed) * 1.2;
      const bx = obj.px + Math.sin(swing) * obj.len;
      const by = obj.pivotY - Math.cos(swing) * obj.len;
      obj.body.position.set(bx, by, obj.pz);
      obj.mesh.position.copy(obj.body.position);
      // Update chain visual
      obj.chain.position.set((obj.px + bx) / 2, (obj.pivotY + by) / 2, obj.pz);
      obj.chain.lookAt(new THREE.Vector3(bx, by, obj.pz));
      obj.chain.rotateX(Math.PI / 2);
      obj.chain.scale.y = obj.len / obj.len;
    }
  });
}

// ═══ ANIMATION LOOP ═══
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  world.step(1 / 60, dt, 3);
  updateVehicles(dt);
  updateExhaustParticles(dt);
  updateMovingObjects(dt);
  updateCamera();
  renderer.render(scene, camera);
}

// ═══ INIT ═══
initThree();
initPhysics();
buildTrack();
initExhaustParticles();
animate();
document.addEventListener('click', () => ensureAudio(), { once: true });
