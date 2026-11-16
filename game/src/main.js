// Boot and the frame loop. The simulation advances in fixed 1/60 steps (rounds.js + the
// player controller), rendering and HUD reads happen per animation frame, so the game plays
// identically on a 60 Hz and a 144 Hz screen. Input routes through here: this file decides
// what a key or a click *means* in the current phase, rounds.js decides what it *does*.
import * as THREE from 'three';
import { createWorld } from './map.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createPlayer } from './player.js';
import { createViewmodels, WEAPONS, GRENADES } from './weapons.js';
import { SHOP } from './weapons.js';
import { createMatch } from './rounds.js';
import { createHud } from './hud.js';
import { makeRng } from './rng.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed') || (shotName ? 7 : Date.now() % 1000000));
const rng = makeRng(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 260);
scene.add(camera);

const { colliders } = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud();

const deps = {
  scene, colliders, effects, audio, hud, rng,
  playerCtrl: null, viewmodels: null,
  getMuzzle: null, isAiming: () => false,
};
const match = createMatch(deps);
const player = match.player;

const playerCtrl = createPlayer(player, colliders, (radius) => match.stepNoise(player, radius));
deps.playerCtrl = playerCtrl;
const viewmodels = createViewmodels(camera);
deps.viewmodels = viewmodels;
const muzzleVec = new THREE.Vector3();
deps.getMuzzle = () => viewmodels.muzzle(muzzleVec);

let buyOpen = false;
let gameState = shotName ? 'shot' : 'menu'; // menu | playing | paused | over
let semiLatched = false;
let threwThisClick = false;
let lastPhase = match.phase;

const input = createInput(renderer.domElement, (locked) => {
  if (!locked && gameState === 'playing') {
    gameState = 'paused';
    hud.el.menuCopy.textContent = 'Paused. Your match is waiting.';
    hud.el.play.textContent = 'Resume';
    hud.el.menu.hidden = false;
  }
});
deps.isAiming = () => input.aiming;

hud.el.play.addEventListener('click', () => {
  audio.unlock();
  if (gameState === 'menu' || gameState === 'over' || match.phase === 'over') {
    match.startMatch();
  }
  gameState = 'playing';
  hud.hideMenu();
  hud.showHud(true);
  hud.showBuy(false);
  buyOpen = false;
  input.requestLock();
});

function openBuy() {
  buyOpen = true;
  hud.renderBuy(player);
  hud.showBuy(true);
}
function closeBuy() {
  buyOpen = false;
  hud.showBuy(false);
}

const SHOP_BY_KEY = new Map(SHOP.map((entry) => [entry[0], entry]));
const SLOT_KEYS = { Digit1: 'primary', Digit2: 'p9', Digit3: 'frag', Digit4: 'flash', Digit5: 'smoke' };

function simStep(dt) {
  // Look, always allowed while playing.
  const look = input.takeLook();
  if (player.alive) playerCtrl.look(look.x, look.y, 0.0021);

  // Buy phase opens the shop on its own; B toggles it.
  if (match.phase !== lastPhase) {
    lastPhase = match.phase;
    if (match.phase === 'buy' && player.alive && gameState === 'playing') openBuy();
    if (match.phase === 'live') closeBuy();
    if (match.phase === 'over' && gameState === 'playing') {
      gameState = 'over';
      hud.showBuy(false);
      hud.showMatchEnd(match);
      document.exitPointerLock();
    }
  }

  // Plant channel: hold E on the site; moving or releasing cancels.
  if (input.wasPressed('KeyE') && player.alive && !player.channel) {
    match.startChannel(player, 'plant');
  }
  if (player.channel) {
    const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.keys.has(k));
    if (!input.keys.has('KeyE') || moving) match.cancelChannel(player);
  }
  // Walk over the dropped charge to recover it.
  if (match.bomb.state === 'dropped' && player.alive
      && Math.hypot(player.x - match.bomb.x, player.z - match.bomb.z) < 1.4) {
    match.pickupCharge(player);
  }

  // Keys: buying wins over weapon slots while the shop is up.
  if (buyOpen && match.phase === 'buy') {
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']) {
      if (input.wasPressed(code)) {
        const entry = SHOP_BY_KEY.get(code.replace('Digit', ''));
        if (entry && match.buy(player, entry)) { audio.buyOk(); hud.renderBuy(player); }
        else audio.denied();
      }
    }
    if (input.wasPressed('KeyB')) closeBuy();
  } else {
    if (input.wasPressed('KeyB') && match.phase === 'buy' && player.alive) openBuy();
    for (const [code, slot] of Object.entries(SLOT_KEYS)) {
      if (input.wasPressed(code)) {
        const target = slot === 'primary' ? player.weapons.primary : slot;
        if (target) match.switchTo(player, target);
      }
    }
  }
  if (input.wasPressed('KeyR')) match.startReload(player);
  hud.showBoard(input.keys.has('Tab'), match);

  // Movement: frozen in the buy phase, while shopping, while planting, or while dead.
  const frozen = match.phase === 'buy' || buyOpen || !!player.channel || !player.alive;
  playerCtrl.step(dt, input, frozen);

  // Trigger.
  if (input.firing && input.locked && !buyOpen && player.alive && !player.channel) {
    if (GRENADES[player.current]) {
      if (!threwThisClick) { match.throwGrenade(player); threwThisClick = true; }
    } else if (WEAPONS[player.current]) {
      const def = WEAPONS[player.current];
      if (def.auto || !semiLatched) {
        match.playerFire();
        if (!def.auto) semiLatched = true;
      }
    }
  } else {
    threwThisClick = false;
    semiLatched = false;
  }

  match.step(dt);
  effects.step(dt);
  viewmodels.step(dt, player.speedRatio, player.reloadT > 0);
  input.endStep();
}

// ---- camera ----
const eyeVec = new THREE.Vector3();
let bobPhase = 0;
let currentFov = 74;
function syncCamera(frameDt) {
  if (player.alive) {
    playerCtrl.eyePos(eyeVec);
    bobPhase += frameDt * (3 + player.speedRatio * 7) * (player.grounded ? 1 : 0);
    const bobY = Math.sin(bobPhase * 2) * 0.016 * player.speedRatio;
    camera.position.set(eyeVec.x, eyeVec.y + bobY, eyeVec.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = playerCtrl.camYaw();
    camera.rotation.x = playerCtrl.camPitch();
    camera.rotation.z = 0;
    const scoped = input.aiming && WEAPONS[player.current] && WEAPONS[player.current].zoom;
    const targetFov = scoped ? 74 / WEAPONS[player.current].zoom : 74;
    currentFov += (targetFov - currentFov) * Math.min(1, frameDt * 11);
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
    viewmodels.show(player.current);
    if (deps.viewmodels) muzzleVec.set(0, 0, 0);
  } else {
    // Spectate the first living teammate from just behind their shoulder.
    const mate = match.actors.find((a) => a.team === 'jackal' && a.alive && !a.isPlayer);
    if (mate) {
      const bx = mate.x + Math.sin(mate.yaw) * 3.4;
      const bz = mate.z + Math.cos(mate.yaw) * 3.4;
      camera.position.set(bx, mate.feetY + 2.3, bz);
      camera.lookAt(mate.x - Math.sin(mate.yaw) * 4, mate.feetY + 1.4, mate.z - Math.cos(mate.yaw) * 4);
    }
    viewmodels.show(null);
  }
}

// ---- screenshot poses: static arrangements the harness photographs ----
function poseCameraForShot() {
  hud.showHud(true);
  hud.el.menu.hidden = true;
  match.poseShot(shotName);
  hud.clearBanner();
  hud.update(match, player);
  if (shotName === 'buy') {
    hud.renderBuy(player);
    hud.showBuy(true);
    camera.position.set(player.x, 1.62, player.z);
    camera.rotation.set(0, 0.35, 0);
  } else if (shotName === 'play') {
    camera.position.set(player.x, player.feetY + 1.62, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(player.pitch, player.yaw, 0);
  } else if (shotName === 'end') {
    hud.showMatchEnd(match);
    camera.position.set(player.x, 1.62, player.z);
    camera.rotation.set(0, player.yaw, 0);
  } else {
    camera.position.set(player.x, 1.62, player.z);
    camera.rotation.set(0, player.yaw, 0);
  }
  effects.step(0.016);
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
    window.__shotReady = true;
  });
}

window.addEventListener('resize', () => {
  if (shotName) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  if (gameState === 'shot') return; // poseCameraForShot renders directly
  if (gameState === 'playing') {
    acc += frameDt;
    while (acc >= STEP) {
      simStep(STEP);
      acc -= STEP;
    }
    syncCamera(frameDt);
    hud.update(match, player);
  } else {
    // Menu / pause / over: keep the world turning slowly behind the panel.
    effects.step(frameDt);
    if (gameState === 'menu') {
      const t = nowMs / 1000;
      camera.position.set(Math.sin(t * 0.05) * 30, 9, Math.cos(t * 0.05) * 30);
      camera.lookAt(0, 1, 0);
    }
  }
  renderer.render(scene, camera);
}

if (shotName) {
  poseCameraForShot();
} else {
  hud.showHud(false);
  camera.position.set(30, 9, 30);
  camera.lookAt(0, 1, 0);
}
// A small handle for automated playtests (and curious players in devtools).
window.__emberline = { match, player };
requestAnimationFrame(frame);
