/* ═══════════════════════════════════════════════════
   NOT NOT  –  Isometric Three.js puzzle game
   ═══════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────
const DIRS      = ['LEFT','RIGHT','UP','DOWN'];
const OPPOSITE  = { LEFT:'RIGHT', RIGHT:'LEFT', UP:'DOWN', DOWN:'UP' };
const MAX_LIVES = 3;
const BASE_MS   = 2800;
const MIN_MS    = 750;
const DECAY     = 0.965;

// ── State ──────────────────────────────────────────────
let score=0, best=0, lives=MAX_LIVES, roundMs=BASE_MS;
let answer=null, accepting=false, timerStart=0, timerHandle=null;
let currentScreen='start';

// ── DOM ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const elHUD     = $('hud');
const elInstr   = $('instruction');
const elNots    = $('nots-row');
const elDir     = $('dir-word');
const elFlash   = $('flash');
const elScore   = $('score-display');
const elOverScr = $('over-score');
const elOverBst = $('over-best');
const heartEls  = [$('h1'),$('h2'),$('h3')];
const scrStart  = $('screen-start');
const scrOver   = $('screen-over');

$('btn-play').addEventListener('click',  startGame);
$('btn-retry').addEventListener('click', startGame);

// ═══════════════════════════════════════════════════════
//  THREE.JS SCENE
// ═══════════════════════════════════════════════════════
const canvas   = $('bg');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
camera.position.set(0, 14, 12);
camera.lookAt(0, 0.5, 0);

// Resize
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  positionInstructionOverlay();
}
window.addEventListener('resize', onResize);

// ── Lighting ───────────────────────────────────────────
// Dim ambient
scene.add(new THREE.AmbientLight(0x8bbccc, 0.5));

// Strong spotlight from above-front — creates the beam effect
const spot = new THREE.SpotLight(0xffffff, 4.5);
spot.position.set(0, 16, 4);
spot.target.position.set(0, 0, 0);
spot.angle = 0.35;
spot.penumbra = 0.6;
spot.castShadow = true;
spot.shadow.mapSize.setScalar(1024);
scene.add(spot, spot.target);

// Soft fill from the front-right
const fill = new THREE.DirectionalLight(0xfff0e0, 0.3);
fill.position.set(6, 4, 8);
scene.add(fill);

// ── Cube texture (canvas-generated dark panel look) ────
function buildFaceTex(size = 512) {
  const cv  = document.createElement('canvas');
  cv.width  = size;
  cv.height = size;
  const c   = cv.getContext('2d');

  // Deep dark base
  c.fillStyle = '#0d0d18';
  c.fillRect(0, 0, size, size);

  // Subtle center radial glow
  const rad = c.createRadialGradient(size/2,size/2,0, size/2,size/2,size*0.52);
  rad.addColorStop(0,   'rgba(255,255,255,0.055)');
  rad.addColorStop(0.5, 'rgba(255,255,255,0.018)');
  rad.addColorStop(1,   'rgba(0,0,0,0)');
  c.fillStyle = rad;
  c.fillRect(0, 0, size, size);

  // Outer border
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.lineWidth   = 4;
  c.strokeRect(5, 5, size-10, size-10);

  // Inner panel inset
  const pad = Math.round(size * 0.07);
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.lineWidth   = 1.5;
  c.strokeRect(pad, pad, size-pad*2, size-pad*2);

  // Corner L-brackets
  const cs = Math.round(size * 0.1);
  c.strokeStyle = 'rgba(255,255,255,0.32)';
  c.lineWidth   = 2.5;
  c.lineCap     = 'round';
  [
    [pad, pad,       1,  1],
    [size-pad, pad,  -1,  1],
    [pad, size-pad,   1, -1],
    [size-pad, size-pad, -1, -1],
  ].forEach(([x, y, sx, sy]) => {
    c.beginPath();
    c.moveTo(x + sx*cs, y);
    c.lineTo(x, y);
    c.lineTo(x, y + sy*cs);
    c.stroke();
  });

  // Faint diagonal texture lines
  c.strokeStyle = 'rgba(255,255,255,0.012)';
  c.lineWidth   = 1;
  for (let i = -size; i < size*2; i += 28) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i + size, size);
    c.stroke();
  }

  return new THREE.CanvasTexture(cv);
}

// ── Cube ───────────────────────────────────────────────
const HALF = 2.5;
const faceTex = buildFaceTex(512);
const cubeMat = new THREE.MeshStandardMaterial({
  color:    0x1a1a24,
  map:      faceTex,
  roughness: 0.14,
  metalness: 0.6,
});
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(HALF*2, HALF*2, HALF*2),
  cubeMat
);
cube.receiveShadow = true;
cube.castShadow    = true;
scene.add(cube);

// ── Beam / God-ray effect ─────────────────────────────
const beamGeo = new THREE.CylinderGeometry(0.06, 1.2, 14, 12, 1, true);
const beamMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.045,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const beam = new THREE.Mesh(beamGeo, beamMat);
beam.position.set(0, HALF + 7, 0);
scene.add(beam);

// ── Humanoid character ─────────────────────────────────
const charMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.4,
  metalness: 0.05,
  emissive: 0xffffff,
  emissiveIntensity: 0.08,
});

function makeLimb(rx, ry, rz) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(rx, rz, 4, 6), charMat);
  m.castShadow = true;
  return m;
}

const character = new THREE.Group();
// head
const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 10), charMat);
head.position.y = 0.76;
head.castShadow = true;
character.add(head);
// body
const body = makeLimb(0.1, 0.1, 0.28);
body.position.y = 0.36;
character.add(body);
// arms
const armL = makeLimb(0.055, 0.055, 0.22);
armL.position.set(-0.2, 0.41, 0);
armL.rotation.z = 0.45;
character.add(armL);
const armR = armL.clone();
armR.position.set(0.2, 0.41, 0);
armR.rotation.z = -0.45;
character.add(armR);
// legs
const legL = makeLimb(0.07, 0.07, 0.24);
legL.position.set(-0.1, 0.04, 0);
character.add(legL);
const legR = legL.clone();
legR.position.set(0.1, 0.04, 0);
character.add(legR);

character.position.set(0, HALF, 0);
scene.add(character);

// ── Timer border line ──────────────────────────────────
// Traces the top face perimeter; depletes as time runs out
const Y_BORDER = HALF + 0.06;
const CORNERS = [
  new THREE.Vector3( HALF, Y_BORDER, -HALF),
  new THREE.Vector3(-HALF, Y_BORDER, -HALF),
  new THREE.Vector3(-HALF, Y_BORDER,  HALF),
  new THREE.Vector3( HALF, Y_BORDER,  HALF),
  new THREE.Vector3( HALF, Y_BORDER, -HALF),
];
const SEG_LEN = [];
for (let i = 0; i < 4; i++) SEG_LEN.push(CORNERS[i].distanceTo(CORNERS[i+1]));
const PERIM = SEG_LEN.reduce((a,b)=>a+b,0);

function perimeterPoints(t) {
  const target = t * PERIM;
  const pts = [CORNERS[0].clone()];
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    const rem = target - acc;
    if (rem <= 0) break;
    if (rem >= SEG_LEN[i]) {
      pts.push(CORNERS[i+1].clone());
      acc += SEG_LEN[i];
    } else {
      pts.push(CORNERS[i].clone().lerp(CORNERS[i+1], rem / SEG_LEN[i]));
      break;
    }
  }
  return pts;
}

// Two lines: a bright outer and a dimmer glow
function makeTimerLine(col, opacity, linewidth) {
  const geo = new THREE.BufferGeometry().setFromPoints([CORNERS[0]]);
  const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity });
  return new THREE.Line(geo, mat);
}

const timerLineGlow  = makeTimerLine(0xffffff, 0.3, 1);
const timerLineOuter = makeTimerLine(0xffffff, 1.0, 1);
scene.add(timerLineGlow, timerLineOuter);

function setTimerProgress(t) {
  const pts = perimeterPoints(t);
  timerLineOuter.geometry.setFromPoints(pts);
  timerLineOuter.geometry.attributes.position.needsUpdate = true;
  // glow is slightly larger (scaled)
  const gpts = pts.map(p => p.clone().multiplyScalar(1.06).setY(Y_BORDER + 0.01));
  timerLineGlow.geometry.setFromPoints(gpts);
  timerLineGlow.geometry.attributes.position.needsUpdate = true;
}

// ── Background floating diamonds ──────────────────────
const DIAMOND_COUNT = 90;
const diamonds = [];
const diamondMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.07,
  side: THREE.DoubleSide,
  depthWrite: false,
});

for (let i = 0; i < DIAMOND_COUNT; i++) {
  const size = 0.1 + Math.random() * 0.55;
  const geo  = new THREE.PlaneGeometry(size, size);
  const m    = new THREE.Mesh(geo, diamondMat);
  m.position.set(
    (Math.random() - 0.5) * 40,
    (Math.random() - 0.5) * 28,
    (Math.random() - 0.5) * 20 - 5
  );
  m.rotation.z = Math.PI / 4;
  m.rotation.x = (Math.random() - 0.5) * 0.3;
  m.userData.vy    = (Math.random() - 0.5) * 0.012;
  m.userData.rotv  = (Math.random() - 0.5) * 0.006;
  m.userData.op    = 0.04 + Math.random() * 0.1;
  scene.add(m);
  diamonds.push(m);
}

// ── Shadow plane below cube ────────────────────────────
const shadowGeo = new THREE.PlaneGeometry(9, 9);
const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
});
const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = -HALF - 0.01;
scene.add(shadowPlane);

// ── Camera shake ──────────────────────────────────────
let shakePower = 0;

function doShake(power) { shakePower = power; }

// ── World-to-screen projection ─────────────────────────
const _v3 = new THREE.Vector3();

function project(x, y, z) {
  _v3.set(x, y, z).project(camera);
  return {
    x: (_v3.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_v3.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function positionInstructionOverlay() {
  if (currentScreen !== 'game') return;
  const p = project(0, HALF + 0.4, 0);
  elInstr.style.left = p.x + 'px';
  elInstr.style.top  = p.y + 'px';
}

// ── Cube rotation physics (spring + angular velocity) ──
const cubeAngVel = { x: 0, y: 0 };
const cubeRotOff = { x: 0, y: 0 };
const SPIN_IMPULSE = 4.2;
const SPIN_DAMP    = 0.87;
const SPRING_X     = 0.09;  // restoring force (tilt back to level)
const SPRING_Y     = 0.035; // weaker around vertical axis

function spinCube(dir) {
  switch (dir) {
    case 'LEFT':  cubeAngVel.y -= SPIN_IMPULSE; break;
    case 'RIGHT': cubeAngVel.y += SPIN_IMPULSE; break;
    case 'UP':    cubeAngVel.x -= SPIN_IMPULSE; break;
    case 'DOWN':  cubeAngVel.x += SPIN_IMPULSE; break;
  }
}

// ── Character bob & jump ──────────────────────────────
let charVx = 0, charVz = 0;
const BASE_CHAR_Y = HALF;

function jumpCharacter(dir) {
  const f = 1.8;
  if (dir === 'LEFT')  charVx -= f;
  if (dir === 'RIGHT') charVx += f;
  if (dir === 'UP')    charVz -= f;
  if (dir === 'DOWN')  charVz += f;
}

// ── Animation loop ─────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t  = clock.getElapsedTime();
  const dt = clock.getDelta();

  // Cube spring rotation physics
  cubeAngVel.x += (-cubeRotOff.x * SPRING_X);  // restore toward level
  cubeAngVel.y += (-cubeRotOff.y * SPRING_Y);
  cubeAngVel.x *= SPIN_DAMP;
  cubeAngVel.y *= SPIN_DAMP;
  cubeRotOff.x += cubeAngVel.x * Math.min(dt, 0.05);
  cubeRotOff.y += cubeAngVel.y * Math.min(dt, 0.05);
  cube.rotation.x = cubeRotOff.x;
  cube.rotation.y = cubeRotOff.y;

  // Character bob
  character.position.y = BASE_CHAR_Y + Math.sin(t * 2.4) * 0.06;

  // Character jump drift
  charVx *= 0.82; charVz *= 0.82;
  character.position.x += charVx * 0.06;
  character.position.z += charVz * 0.06;
  character.position.x *= 0.88;
  character.position.z *= 0.88;

  // Timer update
  if (accepting) {
    const elapsed  = performance.now() - timerStart;
    const progress = Math.max(0, 1 - elapsed / roundMs);
    setTimerProgress(progress);

    // Timer urgency: tint border
    if (progress < 0.3) {
      timerLineOuter.material.color.setHex(0xff3060);
      timerLineGlow.material.color.setHex(0xff3060);
    } else {
      timerLineOuter.material.color.setHex(0xffffff);
      timerLineGlow.material.color.setHex(0xffffff);
    }
  }

  // Diamonds float
  for (const d of diamonds) {
    d.position.y += d.userData.vy;
    d.rotation.z += d.userData.rotv;
    if (d.position.y >  16) d.position.y = -16;
    if (d.position.y < -16) d.position.y =  16;
    // pulse opacity
    d.material.opacity = d.userData.op * (0.7 + 0.3 * Math.sin(t * 0.8 + d.position.x));
  }

  // Camera shake
  if (shakePower > 0.005) {
    camera.position.x = Math.sin(t * 60) * shakePower;
    camera.position.y = 14 + Math.cos(t * 55) * shakePower;
    shakePower *= 0.84;
  } else {
    camera.position.x = 0;
    camera.position.y = 14;
  }

  renderer.render(scene, camera);
  positionInstructionOverlay();
}
animate();
onResize();

// ═══════════════════════════════════════════════════════
//  SCREENS
// ═══════════════════════════════════════════════════════
function showScreen(name) {
  currentScreen = name;
  scrStart.classList.remove('active');
  scrOver.classList.remove('active');
  elHUD.classList.add('hidden');
  elInstr.classList.add('hidden');
  setTimerProgress(0);

  if (name === 'start') scrStart.classList.add('active');
  if (name === 'over')  scrOver.classList.add('active');
  if (name === 'game')  {
    elHUD.classList.remove('hidden');
    elInstr.classList.remove('hidden');
  }
}

// ═══════════════════════════════════════════════════════
//  GAME LOGIC
// ═══════════════════════════════════════════════════════
function startGame() {
  score    = 0;
  lives    = MAX_LIVES;
  roundMs  = BASE_MS;
  accepting = false;
  updateHUD();
  showScreen('game');
  setTimeout(nextRound, 600);
}

function updateHUD() {
  elScore.textContent = score;
  heartEls.forEach((h, i) => h.classList.toggle('lost', i >= lives));
}

// ── Round generation ───────────────────────────────────
function nextRound() {
  if (currentScreen !== 'game') return;

  const maxNots  = Math.min(3, 1 + Math.floor(score / 5));
  const notCount = Math.floor(Math.random() * (maxNots + 1));
  const base     = DIRS[Math.floor(Math.random() * DIRS.length)];
  answer         = notCount % 2 === 0 ? base : OPPOSITE[base];
  accepting      = true;
  timerStart     = performance.now();

  // Render instruction
  elNots.innerHTML = '';
  for (let i = 0; i < notCount; i++) {
    const s = document.createElement('span');
    s.className = 'not-chip';
    s.textContent = 'NOT';
    elNots.appendChild(s);
  }

  // Force re-animate direction
  elDir.style.animation = 'none';
  void elDir.offsetWidth;
  elDir.style.animation = '';
  elDir.textContent = base;

  positionInstructionOverlay();
  setTimerProgress(1);

  clearTimeout(timerHandle);
  timerHandle = setTimeout(onTimeout, roundMs);
}

function onTimeout() {
  if (!accepting) return;
  wrongAnswer();
}

// ── Answer ─────────────────────────────────────────────
function submit(dir) {
  if (!accepting || currentScreen !== 'game') return;
  accepting = false;
  clearTimeout(timerHandle);
  if (dir === answer) correct(dir);
  else                wrong();
}

function correct(dir) {
  score++;
  roundMs = Math.max(MIN_MS, roundMs * DECAY);
  jumpCharacter(dir);
  spinCube(dir);
  flash('ok');
  updateHUD();
  setTimeout(nextRound, 400);
}

function wrong() {
  lives--;
  doShake(0.55);
  // Spin cube chaotically on wrong answer
  cubeAngVel.x += (Math.random() - 0.5) * 5;
  cubeAngVel.y += (Math.random() - 0.5) * 5;
  flash('bad');
  shakeInstruction();
  updateHUD();
  if (lives <= 0) { setTimeout(gameOver, 550); }
  else            { setTimeout(nextRound, 600); }
}

function wrongAnswer() { wrong(); }

function gameOver() {
  accepting = false;
  if (score > best) best = score;
  elOverScr.textContent = score;
  elOverBst.textContent = best;
  showScreen('over');
}

function flash(cls) {
  elFlash.className = '';
  void elFlash.offsetWidth;
  elFlash.className = cls;
}

function shakeInstruction() {
  elInstr.classList.remove('shake');
  void elInstr.offsetWidth;
  elInstr.classList.add('shake');
  setTimeout(() => elInstr.classList.remove('shake'), 450);
}

// ═══════════════════════════════════════════════════════
//  SWIPE / INPUT
// ═══════════════════════════════════════════════════════
const KEY_MAP = {
  ArrowLeft:'LEFT', KeyA:'LEFT',
  ArrowRight:'RIGHT', KeyD:'RIGHT',
  ArrowUp:'UP', KeyW:'UP',
  ArrowDown:'DOWN', KeyS:'DOWN',
};

document.addEventListener('keydown', e => {
  const d = KEY_MAP[e.code];
  if (d) { e.preventDefault(); submit(d); }
});

// Touch swipe
let touchOrigin = null;
const SWIPE_MIN = 28;

document.addEventListener('touchstart', e => {
  if (e.target.closest('button')) return;
  touchOrigin = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!touchOrigin) return;
  const dx = e.changedTouches[0].clientX - touchOrigin.x;
  const dy = e.changedTouches[0].clientY - touchOrigin.y;
  touchOrigin = null;

  if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;

  let dir;
  if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'RIGHT' : 'LEFT';
  else                              dir = dy > 0 ? 'DOWN'  : 'UP';
  submit(dir);
}, { passive: true });

// Pointer drag (desktop + non-touch mobile)
let pointerOrigin = null;
const DRAG_MIN = 30;

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') return; // handled above
  pointerOrigin = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointerup', e => {
  if (!pointerOrigin || e.pointerType === 'touch') return;
  const dx = e.clientX - pointerOrigin.x;
  const dy = e.clientY - pointerOrigin.y;
  pointerOrigin = null;
  if (Math.abs(dx) < DRAG_MIN && Math.abs(dy) < DRAG_MIN) return;

  let dir;
  if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'RIGHT' : 'LEFT';
  else                              dir = dy > 0 ? 'DOWN'  : 'UP';
  submit(dir);
});

// Initial screen
showScreen('start');
