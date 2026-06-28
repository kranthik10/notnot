/* ═══════════════════════════════════════════════════
   NOT NOT  –  Three.js puzzle game
   ═══════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────
const DIRECTIONS = ['LEFT', 'RIGHT', 'UP', 'DOWN'];
const OPPOSITES  = { LEFT: 'RIGHT', RIGHT: 'LEFT', UP: 'DOWN', DOWN: 'UP' };
const DIR_ARROW  = { LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓' };
const COLORS     = {
  LEFT:  0x40c4ff,
  RIGHT: 0xe040fb,
  UP:    0x69ff47,
  DOWN:  0xff6d00,
};

const MAX_LIVES       = 3;
const BASE_TIME       = 3000;   // ms for round 1
const MIN_TIME        = 900;    // ms floor
const TIME_DECAY      = 0.97;   // multiply per correct answer
const COMBO_THRESHOLD = 3;      // every N correct = combo bonus

// ── State ──────────────────────────────────────────────
let state = {
  screen: 'start',   // start | game | over
  score: 0,
  best: 0,
  lives: MAX_LIVES,
  combo: 1,
  streak: 0,
  roundTime: BASE_TIME,
  timerStart: 0,
  timerHandle: null,
  answer: null,       // correct direction string
  accepting: false,
};

// ── DOM refs ───────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {
  start: $('screen-start'),
  game:  $('screen-game'),
  over:  $('screen-over'),
};

const elScore      = $('score');
const elCombo      = $('combo');
const elFinalScore = $('final-score');
const elBestScore  = $('best-score');
const elTimerBar   = $('timer-bar');
const elNots       = $('not-prefixes');
const elDir        = $('direction-word');
const elFeedback   = $('feedback-overlay');
const lifeEls      = [$('life1'), $('life2'), $('life3')];

$('btn-start').addEventListener('click',   startGame);
$('btn-restart').addEventListener('click', startGame);
$('btn-menu').addEventListener('click',    showStart);

// ═══════════════════════════════════════════════════════
//  THREE.JS BACKGROUND
// ═══════════════════════════════════════════════════════
const canvas   = $('bg');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a12);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
camera.position.set(0, 0, 18);

// Ambient + directional light
scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const dirLight = new THREE.DirectionalLight(0xe040fb, 1.2);
dirLight.position.set(5, 8, 6);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0x40c4ff, 0.8);
dirLight2.position.set(-5, -4, 3);
scene.add(dirLight2);

// ── Central 3D object ──────────────────────────────────
const boxGeo  = new THREE.BoxGeometry(2.8, 2.8, 2.8, 4, 4, 4);
const boxMat  = new THREE.MeshStandardMaterial({
  color: 0xe040fb,
  emissive: 0x500070,
  roughness: 0.3,
  metalness: 0.7,
  wireframe: false,
});
const mainCube = new THREE.Mesh(boxGeo, boxMat);
scene.add(mainCube);

// Wireframe overlay
const wireMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.08 });
const wireMesh = new THREE.Mesh(boxGeo, wireMat);
mainCube.add(wireMesh);

// ── Floating particles ─────────────────────────────────
const particleCount = 280;
const pPositions    = new Float32Array(particleCount * 3);
const pColors       = new Float32Array(particleCount * 3);
const pSpeeds       = [];

for (let i = 0; i < particleCount; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const r     = 6 + Math.random() * 10;
  pPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
  pPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  pPositions[i * 3 + 2] = r * Math.cos(phi);
  const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.65);
  pColors[i * 3]     = c.r;
  pColors[i * 3 + 1] = c.g;
  pColors[i * 3 + 2] = c.b;
  pSpeeds.push((Math.random() - 0.5) * 0.008);
}

const pGeo  = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
pGeo.setAttribute('color',    new THREE.BufferAttribute(pColors, 3));
const pMat  = new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.85 });
const points = new THREE.Points(pGeo, pMat);
scene.add(points);

// ── Ring decorations ───────────────────────────────────
function makeRing(radius, tube, color) {
  const geo = new THREE.TorusGeometry(radius, tube, 8, 60);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 });
  return new THREE.Mesh(geo, mat);
}
const ring1 = makeRing(5.5, 0.035, 0xe040fb); ring1.rotation.x = Math.PI / 3; scene.add(ring1);
const ring2 = makeRing(7.0, 0.025, 0x40c4ff); ring2.rotation.y = Math.PI / 4; scene.add(ring2);
const ring3 = makeRing(8.5, 0.02,  0x69ff47); ring3.rotation.z = Math.PI / 6; scene.add(ring3);

// ── Resize handler ─────────────────────────────────────
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── Camera shake state ─────────────────────────────────
let shakeMag = 0;
let shakeDecay = 0.88;

function triggerShake(mag) { shakeMag = mag; }

// ── Cube target color ──────────────────────────────────
let targetColor = new THREE.Color(0xe040fb);
let currentColor = new THREE.Color(0xe040fb);

// ── Cube jump animation ────────────────────────────────
let cubeVelocity = { x: 0, y: 0 };
let cubePos      = { x: 0, y: 0 };

function jumpCube(dir) {
  const force = 2.5;
  if (dir === 'LEFT')  cubeVelocity.x -= force;
  if (dir === 'RIGHT') cubeVelocity.x += force;
  if (dir === 'UP')    cubeVelocity.y += force;
  if (dir === 'DOWN')  cubeVelocity.y -= force;
  targetColor.set(COLORS[dir]);
}

// ── Animation loop ─────────────────────────────────────
let clock = new THREE.Clock();
let frameId;

function animate() {
  frameId = requestAnimationFrame(animate);
  const t  = clock.getElapsedTime();
  const dt = clock.getDelta();

  // Rotate rings
  ring1.rotation.z += 0.003;
  ring2.rotation.x += 0.002;
  ring3.rotation.y += 0.0015;

  // Rotate cube gently
  mainCube.rotation.x = Math.sin(t * 0.4) * 0.25;
  mainCube.rotation.y += 0.008;

  // Cube jump physics
  cubeVelocity.x *= 0.85;
  cubeVelocity.y *= 0.85;
  cubePos.x += cubeVelocity.x * 0.06;
  cubePos.y += cubeVelocity.y * 0.06;
  cubePos.x *= 0.88;
  cubePos.y *= 0.88;
  mainCube.position.x = cubePos.x;
  mainCube.position.y = cubePos.y;

  // Pulse emissive
  const pulse = 0.3 + 0.15 * Math.sin(t * 2.5);
  boxMat.emissiveIntensity = pulse;

  // Lerp cube color
  currentColor.lerp(targetColor, 0.06);
  boxMat.color.copy(currentColor);
  boxMat.emissive.copy(currentColor).multiplyScalar(0.35);

  // Drift particles
  const pos = pGeo.attributes.position.array;
  for (let i = 0; i < particleCount; i++) {
    pos[i * 3 + 1] += pSpeeds[i];
    if (pos[i * 3 + 1] > 16)  pos[i * 3 + 1] = -16;
    if (pos[i * 3 + 1] < -16) pos[i * 3 + 1] = 16;
  }
  pGeo.attributes.position.needsUpdate = true;

  // Camera shake
  if (shakeMag > 0.005) {
    camera.position.x = (Math.random() - 0.5) * shakeMag;
    camera.position.y = (Math.random() - 0.5) * shakeMag;
    shakeMag *= shakeDecay;
  } else {
    camera.position.x = 0;
    camera.position.y = 0;
  }

  renderer.render(scene, camera);
}
animate();

// ═══════════════════════════════════════════════════════
//  GAME LOGIC
// ═══════════════════════════════════════════════════════
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  state.screen = name;
}

function showStart() {
  clearRound();
  showScreen('start');
}

function startGame() {
  state.score     = 0;
  state.lives     = MAX_LIVES;
  state.combo     = 1;
  state.streak    = 0;
  state.roundTime = BASE_TIME;
  updateHUD();
  showScreen('game');
  setTimeout(nextRound, 400);
}

function updateHUD() {
  elScore.textContent = state.score;
  elCombo.textContent = `x${state.combo}`;
  lifeEls.forEach((el, i) => el.classList.toggle('lost', i >= state.lives));
}

// ── Generate a round ────────────────────────────────────
function nextRound() {
  if (state.screen !== 'game') return;

  // Number of "Not" prefixes: weight toward simpler early on
  const maxNots = Math.min(3, Math.floor(state.score / 4));
  const notCount = Math.floor(Math.random() * (maxNots + 1));

  // Base direction
  const base = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];

  // Resolve: odd nots → opposite, even nots → same
  const answer = notCount % 2 === 0 ? base : OPPOSITES[base];

  state.answer   = answer;
  state.accepting = true;

  // Render instruction
  elNots.innerHTML = '';
  for (let i = 0; i < notCount; i++) {
    const span = document.createElement('span');
    span.className = 'not-word';
    span.textContent = 'NOT';
    // staggered entrance
    span.style.animationDelay = `${i * 0.06}s`;
    elNots.appendChild(span);
  }
  elDir.textContent = base;

  // Animate in
  elDir.style.animation = 'none';
  void elDir.offsetWidth;
  elDir.style.animation = '';

  // Start timer
  state.timerStart  = performance.now();
  scheduleTimeout();
}

function scheduleTimeout() {
  clearTimeout(state.timerHandle);
  state.timerHandle = setTimeout(onTimeout, state.roundTime);
  animateTimerBar();
}

function animateTimerBar() {
  const start = performance.now();
  const dur   = state.roundTime;
  function tick() {
    if (!state.accepting) return;
    const elapsed = performance.now() - start;
    const pct     = Math.max(0, 1 - elapsed / dur);
    elTimerBar.style.width = `${pct * 100}%`;

    // Color urgency
    if (pct > 0.5)      elTimerBar.style.background = 'linear-gradient(90deg,#40c4ff,#e040fb)';
    else if (pct > 0.25) elTimerBar.style.background = 'linear-gradient(90deg,#ffd740,#ff6d00)';
    else                  elTimerBar.style.background = 'linear-gradient(90deg,#ff1744,#ff6d00)';

    if (elapsed < dur && state.accepting) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function clearRound() {
  clearTimeout(state.timerHandle);
  state.accepting = false;
  elTimerBar.style.width = '100%';
}

function onTimeout() {
  if (!state.accepting) return;
  wrongAnswer();
}

// ── Answer handling ─────────────────────────────────────
function submitAnswer(dir) {
  if (!state.accepting || state.screen !== 'game') return;
  clearRound();

  if (dir === state.answer) {
    correctAnswer(dir);
  } else {
    wrongAnswer();
  }
}

function correctAnswer(dir) {
  state.score  += state.combo;
  state.streak += 1;

  if (state.streak > 0 && state.streak % COMBO_THRESHOLD === 0) {
    state.combo = Math.min(8, state.combo + 1);
    showComboBurst(`COMBO x${state.combo}!`);
  }

  state.roundTime = Math.max(MIN_TIME, state.roundTime * TIME_DECAY);

  jumpCube(dir);
  flashFeedback('correct');
  updateHUD();
  setTimeout(nextRound, 420);
}

function wrongAnswer() {
  state.lives  -= 1;
  state.streak  = 0;
  state.combo   = 1;

  triggerShake(0.8);
  flashFeedback('wrong');
  addShakeClass();
  updateHUD();

  if (state.lives <= 0) {
    setTimeout(gameOver, 600);
  } else {
    setTimeout(nextRound, 700);
  }
}

function gameOver() {
  clearRound();
  if (state.score > state.best) state.best = state.score;
  elFinalScore.textContent = state.score;
  elBestScore.textContent  = state.best;
  showScreen('over');
  targetColor.set(0xe040fb);
}

function flashFeedback(type) {
  elFeedback.className = type;
  setTimeout(() => { elFeedback.className = ''; }, 350);
}

function addShakeClass() {
  const el = $('instruction-area');
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

function showComboBurst(text) {
  const el = document.createElement('div');
  el.className   = 'combo-burst';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

// ═══════════════════════════════════════════════════════
//  INPUT HANDLING
// ═══════════════════════════════════════════════════════

// Keyboard
const KEY_MAP = {
  ArrowLeft:  'LEFT',  KeyA: 'LEFT',
  ArrowRight: 'RIGHT', KeyD: 'RIGHT',
  ArrowUp:    'UP',    KeyW: 'UP',
  ArrowDown:  'DOWN',  KeyS: 'DOWN',
};

document.addEventListener('keydown', e => {
  const dir = KEY_MAP[e.code];
  if (dir) submitAnswer(dir);
});

// Touch / swipe
let touchStart = null;
const SWIPE_THRESHOLD = 30;

document.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

  let dir;
  if (Math.abs(dx) > Math.abs(dy)) {
    dir = dx > 0 ? 'RIGHT' : 'LEFT';
  } else {
    dir = dy > 0 ? 'DOWN' : 'UP';
  }
  submitAnswer(dir);
}, { passive: true });

// ── On-screen arrow buttons for fallback (mobile) ──────
const arrowWrap = document.createElement('div');
arrowWrap.id = 'arrow-buttons';
arrowWrap.innerHTML = `
  <div style="grid-column:2;grid-row:1"><button data-dir="UP">↑</button></div>
  <div style="grid-column:1;grid-row:2"><button data-dir="LEFT">←</button></div>
  <div style="grid-column:2;grid-row:2"><button data-dir="DOWN">↓</button></div>
  <div style="grid-column:3;grid-row:2"><button data-dir="RIGHT">→</button></div>
`;
Object.assign(arrowWrap.style, {
  position: 'fixed',
  bottom:   '2rem',
  left:     '50%',
  transform:'translateX(-50%)',
  display:  'grid',
  gridTemplateColumns: 'repeat(3,3.5rem)',
  gridTemplateRows:    'repeat(2,3.5rem)',
  gap:      '0.4rem',
  zIndex:   '15',
  opacity:  '0',
  transition:'opacity 0.3s',
});

arrowWrap.querySelectorAll('button').forEach(btn => {
  Object.assign(btn.style, {
    width:        '100%',
    height:       '100%',
    border:       '2px solid rgba(255,255,255,0.25)',
    borderRadius: '12px',
    background:   'rgba(255,255,255,0.07)',
    color:        '#fff',
    fontSize:     '1.5rem',
    cursor:       'pointer',
    backdropFilter:'blur(4px)',
    transition:   'background 0.1s, transform 0.1s',
  });
  btn.addEventListener('pointerdown', () => {
    btn.style.background = 'rgba(255,255,255,0.18)';
    btn.style.transform  = 'scale(0.93)';
    submitAnswer(btn.dataset.dir);
  });
  btn.addEventListener('pointerup', () => {
    btn.style.background = 'rgba(255,255,255,0.07)';
    btn.style.transform  = 'scale(1)';
  });
});

document.body.appendChild(arrowWrap);

// Show arrow buttons only on the game screen
const gameScreenEl = $('screen-game');
const observer = new MutationObserver(() => {
  const active = gameScreenEl.classList.contains('active');
  arrowWrap.style.opacity = active ? '1' : '0';
  arrowWrap.style.pointerEvents = active ? 'all' : 'none';
});
observer.observe(gameScreenEl, { attributes: true, attributeFilter: ['class'] });
