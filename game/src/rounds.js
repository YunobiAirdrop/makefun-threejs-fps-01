// The match: one state machine owns every actor, the charge, the money and the clock, so the
// player, the bots and the HUD all read the same truth. Rounds run buy → live → (planted) →
// end; first to 7 takes the match, with a decider if twelve rounds end level. Shooting lives
// here too — one hitscan resolver serves the player and the bots, so a bullet means the same
// thing no matter who fired it.
import * as THREE from 'three';
import { SITES, SPAWNS, HOLDS } from './map.js';
import { rayWorld, raySphere, segmentClear } from './physics.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, SHOP, damageAt, spreadRadians } from './weapons.js';
import { createBot } from './bots.js';
import { createGrenades } from './weapons.js';

const WIN_SCORE = 7;
const MAX_ROUNDS = 12;
const BUY_TIME = 10;
const ROUND_TIME = 100;
const FUSE_TIME = 40;
const END_TIME = 5;
const PLANT_TIME = 4;
const DEFUSE_TIME = 5;

const JACKAL_NAMES = ['Vex', 'Mara', 'Odo', 'Pike'];
const SENTRY_NAMES = ['Hale', 'Iris', 'Corv', 'Senn', 'Wren'];
const GUARD_FACE = { A: [-2, -16], B: [24, -8] };

// Slab test against an arbitrary box (the physics rayBox is grounded at y=0; body parts are not).
function raySlab(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (d === 0) { if (o < lo || o > hi) return Infinity; continue; }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// One actor's body as three tests: head sphere, chest box, legs box. Stance-aware.
function rayActor(ox, oy, oz, dx, dy, dz, a) {
  const f = a.feetY;
  const headY = f + (a.crouched ? 1.2 : 1.66);
  const chestLo = f + (a.crouched ? 0.5 : 0.92);
  const chestHi = f + (a.crouched ? 1.08 : 1.54);
  const tHead = raySphere(ox, oy, oz, dx, dy, dz, a.x, headY, a.z, 0.22);
  const tChest = raySlab(ox, oy, oz, dx, dy, dz, a.x - 0.25, chestLo, a.z - 0.25, a.x + 0.25, chestHi, a.z + 0.25);
  const tLegs = raySlab(ox, oy, oz, dx, dy, dz, a.x - 0.2, f, a.z - 0.2, a.x + 0.2, chestLo, a.z + 0.2);
  let best = tHead;
  let part = 'head';
  if (tChest < best) { best = tChest; part = 'chest'; }
  if (tLegs < best) { best = tLegs; part = 'legs'; }
  return best === Infinity ? null : { t: best, part };
}

function makeActor(team, name, isPlayer) {
  return {
    team, name, isPlayer: !!isPlayer,
    x: 0, z: 0, feetY: 0, yaw: 0, pitch: 0,
    health: 100, armor: 0, alive: true, crouched: false, walking: false, grounded: true,
    speedRatio: 0, eyeHeight: 1.62,
    money: 800, kills: 0, deaths: 0,
    weapons: { primary: null, sidearm: 'p9' },
    current: 'p9',
    ammo: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
    grenades: { frag: 0, flash: 0, smoke: 0 },
    hasCharge: false, channel: null, channelHurt: false,
    reloadT: 0, drawT: 0, bloom: 0, nextShotAt: 0, blindT: 0,
    lastHit: null, lossStreak: 0,
  };
}

export function createMatch(deps) {
  const { scene, colliders, effects, audio, hud, rng } = deps;
  const player = makeActor('jackal', 'You', true);
  const actors = [player];
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const a = makeActor('jackal', JACKAL_NAMES[i]);
    actors.push(a);
    bots.push(createBot(scene, a, rng));
  }
  for (let i = 0; i < 5; i++) {
    const a = makeActor('sentry', SENTRY_NAMES[i]);
    actors.push(a);
    bots.push(createBot(scene, a, rng));
  }
  const botOf = new Map(bots.map((b) => [b.actor, b]));

  const match = {
    player, actors, bots,
    phase: 'menu', // menu | buy | live | planted | end | over
    phaseT: 0, round: 0, now: 0,
    score: { jackal: 0, sentry: 0 },
    winner: null, draw: false,
    attackSite: 'A', attackRally: 'a_entry', attackSiteNode: 'a_site', guardFace: GUARD_FACE.A,
    bomb: { state: 'carried', carrier: player, x: 0, y: 0, z: 0, site: null, fuseT: 0 },
    fetchAssignee: null,
    noises: [],
  };
  let beepAt = 0;
  let lossStreak = { jackal: 0, sentry: 0 };

  // The charge itself: a dark case with an amber tell-tale, visible when carried, dropped or planted.
  const chargeMesh = new THREE.Group();
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.14), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
  const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), new THREE.MeshLambertMaterial({ color: 0x553311, emissive: 0xcc7722 }));
  lampMesh.position.set(0.1, 0.14, 0);
  chargeMesh.add(caseMesh, lampMesh);
  scene.add(chargeMesh);

  const grenades = createGrenades(scene, effects, audio, colliders, {
    explode(x, y, z, owner) {
      audio.explosion(deps.playerPos ? Math.hypot(x - player.x, z - player.z) : 0);
      for (const a of actors) {
        if (!a.alive) continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (d > 6.5) continue;
        if (!segmentClear(colliders, null, x, y + 0.5, z, a.x, a.feetY + 1, a.z)) continue;
        const dmg = Math.max(8, 115 * (1 - d / 6.5));
        applyDamage(a, dmg, owner, 'Frag', false);
      }
    },
    flash(x, y, z, owner) {
      audio.flashbang();
      for (const a of actors) {
        if (!a.alive || a === owner) continue;
        const dx = a.x - x;
        const dz = a.z - z;
        const d = Math.hypot(dx, dz);
        if (d > 20) continue;
        const eyeY = a.feetY + 1.5;
        if (!segmentClear(colliders, null, x, y, z, a.x, eyeY, a.z)) continue;
        const fx = -Math.sin(a.yaw);
        const fz = -Math.cos(a.yaw);
        const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
        if (dot < 0.15 && d > 3.5) continue;
        const strength = d < 4 ? 2.8 : Math.max(0.5, 2.8 - (d - 4) * 0.16);
        a.blindT = Math.max(a.blindT, strength * (dot < 0.5 ? 0.45 : 1));
      }
    },
    smoke() {},
  }, rng);

  function siteAt(x, z) {
    for (const id of ['A', 'B']) {
      const s = SITES[id];
      if (Math.hypot(x - s.x, z - s.z) < s.r) return s;
    }
    return null;
  }
  match.siteAt = siteAt;

  function aliveCount(team) {
    let n = 0;
    for (const a of actors) if (a.team === team && a.alive) n += 1;
    return n;
  }
  match.aliveCount = aliveCount;

  // ---- damage & death ----
  function applyDamage(target, dmg, attacker, weaponName, head) {
    if (!target.alive || (match.phase !== 'live' && match.phase !== 'planted')) return;
    target.health -= dmg;
    target.lastHit = { t: match.now, x: attacker ? attacker.x : target.x, z: attacker ? attacker.z : target.z };
    if (target.channel) target.channelHurt = true;
    if (target.isPlayer) audio.hurt();
    const bot = botOf.get(target);
    if (bot) bot.hitFlash();
    if (target.health > 0) return;
    target.health = 0;
    target.alive = false;
    target.deaths += 1;
    target.channel = null;
    if (attacker && attacker !== target) {
      attacker.kills += 1;
      if (attacker.team !== target.team) attacker.money += 300;
    }
    hud.killfeed(attacker, target, weaponName, head);
    if (attacker && attacker.isPlayer) audio.kill();
    if (target.hasCharge) dropCharge(target);
    if (target.team === 'sentry' && aliveCount('sentry') === 0) {
      endRound('jackal', 'elimination');
    } else if (target.team === 'jackal' && aliveCount('jackal') === 0 && match.bomb.state !== 'planted') {
      endRound('sentry', 'elimination');
    }
  }

  function dropCharge(from) {
    from.hasCharge = false;
    match.bomb.state = 'dropped';
    match.bomb.carrier = null;
    match.bomb.x = from.x;
    match.bomb.z = from.z;
    match.bomb.y = from.feetY;
    // The nearest living jackal bot is sent for it; the player may beat them to it.
    let best = null;
    let bestD = Infinity;
    for (const b of bots) {
      if (b.actor.team !== 'jackal' || !b.actor.alive) continue;
      const d = Math.hypot(b.actor.x - from.x, b.actor.z - from.z);
      if (d < bestD) { bestD = d; best = b.actor; }
    }
    match.fetchAssignee = best;
  }

  match.pickupCharge = (actor) => {
    if (match.bomb.state !== 'dropped' || !actor.alive || actor.team !== 'jackal') return;
    match.bomb.state = 'carried';
    match.bomb.carrier = actor;
    actor.hasCharge = true;
    match.fetchAssignee = null;
    if (actor.isPlayer) hud.centerMsg('You have the charge — plant at A or B');
  };

  // ---- shooting ----
  function eyeOf(a) {
    return { x: a.x, y: a.feetY + (a.isPlayer ? a.eyeHeight : a.crouched ? 1.12 : 1.58), z: a.z };
  }

  function fireHitscan(shooter, wid, aim, spread) {
    const def = WEAPONS[wid];
    const ammo = shooter.ammo[wid];
    if (!ammo || ammo.mag <= 0) return false;
    ammo.mag -= 1;
    shooter.nextShotAt = match.now + 60 / def.rpm;
    const eye = eyeOf(shooter);
    let dx = aim.x - eye.x;
    let dy = aim.y - eye.y;
    let dz = aim.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // Muzzle: the player's own viewmodel tip, or just ahead of a bot's raised gun.
    let mx = eye.x - Math.sin(shooter.yaw) * 0.45;
    let my = eye.y - 0.14;
    let mz = eye.z - Math.cos(shooter.yaw) * 0.45;
    if (shooter.isPlayer && deps.getMuzzle) {
      const m = deps.getMuzzle();
      mx = m.x; my = m.y; mz = m.z;
    }
    effects.muzzle(mx, my, mz, shooter.yaw, shooter.pitch || 0);
    const distToPlayer = shooter.isPlayer ? 0 : Math.hypot(shooter.x - player.x, shooter.z - player.z);
    audio.shot(def.kind, distToPlayer);
    match.noises.push({ x: shooter.x, z: shooter.z, radius: 30, team: shooter.team, t: match.now });

    for (let p = 0; p < def.pellets; p++) {
      // Jitter the ray inside the spread cone.
      const rx = (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5;
      const ry = (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5;
      let px = dx + (-dz) * rx * spread + 0 * ry;
      let py = dy + ry * spread;
      let pz = dz + (dx) * rx * spread;
      const pl = Math.hypot(px, py, pz) || 1;
      px /= pl; py /= pl; pz /= pl;
      const worldT = rayWorld(colliders, eye.x, eye.y, eye.z, px, py, pz, 140);
      let bestT = worldT > 0 ? worldT : Infinity;
      let bestActor = null;
      let bestPart = null;
      for (const foe of actors) {
        if (!foe.alive || foe.team === shooter.team || foe === shooter) continue;
        const hit = rayActor(eye.x, eye.y, eye.z, px, py, pz, foe);
        if (hit && hit.t < bestT) { bestT = hit.t; bestActor = foe; bestPart = hit.part; }
      }
      const hx = eye.x + px * Math.min(bestT, 140);
      const hy = eye.y + py * Math.min(bestT, 140);
      const hz = eye.z + pz * Math.min(bestT, 140);
      effects.tracer(mx, my, mz, hx, hy, hz);
      if (bestActor) {
        const dmg = damageAt(def, bestT, bestPart, bestActor);
        const wasAlive = bestActor.alive;
        applyDamage(bestActor, dmg, shooter, def.short, bestPart === 'head');
        if (shooter.isPlayer) {
          hud.hitmark(bestPart === 'head', wasAlive && !bestActor.alive);
          audio.hit(bestPart === 'head');
        }
      } else if (bestT !== Infinity) {
        effects.impact(hx, hy, hz, 3, rng);
      }
    }
    return true;
  }
  match.fireHitscan = fireHitscan;

  // The player's own trigger: aim from the camera, spread from the player's state.
  match.playerFire = () => {
    const a = player;
    if (!a.alive || a.channel || a.reloadT > 0 || a.drawT > 0) return;
    if (match.phase !== 'live' && match.phase !== 'planted') return;
    if (match.now < a.nextShotAt) return;
    const wid = a.current;
    const def = WEAPONS[wid];
    if (!def) return; // a grenade is in hand; the click throws instead (main routes it)
    const ammo = a.ammo[wid];
    if (ammo.mag <= 0) {
      audio.dry();
      match.startReload(a);
      a.nextShotAt = match.now + 0.3;
      return;
    }
    const eye = eyeOf(a);
    const pitch = deps.playerCtrl ? deps.playerCtrl.camPitch() : a.pitch;
    const yaw = deps.playerCtrl ? deps.playerCtrl.camYaw() : a.yaw;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    let spread = spreadRadians(def, a.bloom, a.speedRatio, a.crouched, a.grounded);
    if (deps.isAiming && deps.isAiming() && def.zoom) spread *= 0.12;
    const aim = { x: eye.x + fx * 90, y: eye.y + fy * 90, z: eye.z + fz * 90 };
    if (fireHitscan(a, wid, aim, spread)) {
      a.bloom = Math.min(def.bloomMax, a.bloom + def.bloom);
      if (deps.playerCtrl) deps.playerCtrl.addRecoil(def.recoil * rng.range(0.85, 1.15), rng.range(-0.0018, 0.0018));
      if (deps.viewmodels) deps.viewmodels.kick(def.kick);
    }
  };

  match.startReload = (a) => {
    const def = WEAPONS[a.current];
    if (!def || a.reloadT > 0) return;
    const ammo = a.ammo[a.current];
    if (!ammo || ammo.mag >= def.mag || ammo.reserve <= 0) return;
    a.reloadT = def.reload;
    if (a.isPlayer) audio.reload();
  };

  function finishReload(a) {
    const def = WEAPONS[a.current];
    const ammo = a.ammo[a.current];
    if (!def || !ammo) return;
    const take = Math.min(def.mag - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }

  match.switchTo = (a, target) => {
    if (a.current === target || a.channel) return false;
    if (WEAPONS[target] && !(a.weapons.primary === target || target === 'p9')) return false;
    if (GRENADES[target] && a.grenades[target] <= 0) return false;
    a.current = target;
    a.reloadT = 0;
    a.bloom = 0;
    a.drawT = 0.28;
    if (a.isPlayer) {
      audio.draw();
      if (deps.viewmodels) deps.viewmodels.show(target);
    }
    return true;
  };

  match.throwGrenade = (a) => {
    const kind = a.current;
    if (!GRENADES[kind] || a.grenades[kind] <= 0 || !a.alive || a.channel) return;
    if (match.phase !== 'live' && match.phase !== 'planted') return;
    a.grenades[kind] -= 1;
    const eye = eyeOf(a);
    const pitch = a.isPlayer && deps.playerCtrl ? deps.playerCtrl.camPitch() : (a.pitch || 0.25);
    const yaw = a.isPlayer && deps.playerCtrl ? deps.playerCtrl.camYaw() : a.yaw;
    const dir = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch) + 0.18,
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    dir.x /= dl; dir.y /= dl; dir.z /= dl;
    grenades.throwIt(kind, eye, dir, a);
    match.noises.push({ x: a.x, z: a.z, radius: 8, team: a.team, t: match.now });
    // Fall back to the best gun in hand once the grenade is gone.
    if (a.grenades[kind] <= 0) match.switchTo(a, a.weapons.primary || 'p9');
  };

  // ---- buying ----
  match.buy = (a, entry) => {
    const [, kind, id] = entry;
    if (kind === 'weapon') {
      const def = WEAPONS[id];
      if (a.weapons.primary === id) return false;
      if (a.money < def.price) return false;
      a.money -= def.price;
      a.weapons.primary = id;
      a.ammo[id] = { mag: def.mag, reserve: def.reserve };
      if (a.isPlayer) match.switchTo(a, id);
      return true;
    }
    if (kind === 'armor') {
      if (a.armor >= 100 || a.money < ARMOR_PRICE) return false;
      a.money -= ARMOR_PRICE;
      a.armor = 100;
      return true;
    }
    const def = GRENADES[id];
    if (a.grenades[id] >= 1 || a.money < def.price) return false;
    a.money -= def.price;
    a.grenades[id] += 1;
    return true;
  };

  function botBuy(a) {
    const buy = (entry) => match.buy(a, entry);
    const byId = (id) => SHOP.find((e) => e[2] === id);
    if (a.money >= WEAPONS.kestrel.price + ARMOR_PRICE && rng.chance(0.75)) { buy(byId('kestrel')); buy(byId('armor')); }
    else if (a.money >= WEAPONS.longbow.price && rng.chance(0.3)) buy(byId('longbow'));
    else if (a.money >= WEAPONS.raptor.price && rng.chance(0.7)) buy(byId('raptor'));
    else if (a.money >= WEAPONS.mule.price && rng.chance(0.4)) buy(byId('mule'));
    if (a.money >= ARMOR_PRICE && rng.chance(0.6)) buy(byId('armor'));
    if (a.money >= GRENADES.frag.price && rng.chance(0.4)) buy(byId('frag'));
    if (a.money >= GRENADES.flash.price && rng.chance(0.35)) buy(byId('flash'));
    if (a.money >= GRENADES.smoke.price && rng.chance(0.3)) buy(byId('smoke'));
    if (a.weapons.primary) { a.current = a.weapons.primary; }
  }

  // ---- channels: plant & defuse ----
  match.startChannel = (a, type) => {
    if (a.channel || !a.alive) return false;
    if (type === 'plant') {
      if (match.phase !== 'live' || !a.hasCharge || !siteAt(a.x, a.z)) return false;
      a.channel = { type, t: 0, dur: PLANT_TIME };
    } else {
      if (match.bomb.state !== 'planted') return false;
      if (Math.hypot(a.x - match.bomb.x, a.z - match.bomb.z) > 1.9) return false;
      a.channel = { type, t: 0, dur: DEFUSE_TIME };
    }
    a.channelHurt = false;
    return true;
  };
  match.cancelChannel = (a) => { a.channel = null; };

  function completeChannel(a) {
    const type = a.channel.type;
    a.channel = null;
    if (type === 'plant') {
      const site = siteAt(a.x, a.z);
      a.hasCharge = false;
      match.bomb.state = 'planted';
      match.bomb.carrier = null;
      match.bomb.x = a.x;
      match.bomb.z = a.z;
      match.bomb.y = a.feetY;
      match.bomb.site = site ? site.id : 'A';
      match.bomb.fuseT = FUSE_TIME;
      match.phase = 'planted';
      beepAt = 0;
      a.money += 300;
      hud.banner('CHARGE PLANTED', `Site ${match.bomb.site} — ${FUSE_TIME} seconds to detonation`, a.team === 'jackal' ? 'us' : 'them');
      audio.beep(false);
    } else {
      endRound('sentry', 'defuse');
    }
  }

  // ---- round flow ----
  function endRound(winner, reason) {
    if (match.phase === 'end' || match.phase === 'over') return;
    match.phase = 'end';
    match.phaseT = END_TIME;
    match.score[winner] += 1;
    const loser = winner === 'jackal' ? 'sentry' : 'jackal';
    lossStreak[loser] += 1;
    lossStreak[winner] = 0;
    const winPay = reason === 'elimination' ? 2400 : 2700;
    const lossPay = 1400 + Math.min(1500, 500 * (lossStreak[loser] - 1));
    for (const a of actors) a.money += a.team === winner ? winPay : lossPay;
    for (const a of actors) a.channel = null;
    const label = winner === 'jackal' ? 'JACKALS' : 'SENTRIES';
    const reasonText = {
      elimination: 'Elimination',
      objective: winner === 'jackal' ? 'The charge detonated' : 'Objective held',
      defuse: 'The charge was defused',
      time: 'The clock ran out',
    }[reason];
    hud.banner(`${label} TAKE THE ROUND`, reasonText, winner === 'jackal' ? 'us' : 'them');
    audio.stinger(winner === 'jackal');
    if (match.bomb.state === 'planted' && winner === 'jackal') {
      effects.explosion(match.bomb.x, 1.2, match.bomb.z);
      audio.explosion(Math.hypot(match.bomb.x - player.x, match.bomb.z - player.z));
    }
  }

  function startRound() {
    match.round += 1;
    match.attackSite = rng.chance(0.5) ? 'A' : 'B';
    match.attackRally = match.attackSite === 'A' ? 'a_entry' : 'b_chan';
    match.attackSiteNode = match.attackSite === 'A' ? 'a_site' : 'b_site';
    match.guardFace = GUARD_FACE[match.attackSite];
    match.bomb.state = 'carried';
    match.bomb.carrier = player;
    match.bomb.site = null;
    match.fetchAssignee = null;
    match.noises.length = 0;

    actors.forEach((a, i) => {
      const spawn = SPAWNS[a.team][a.isPlayer ? 0 : (i % 5)];
      a.x = spawn[0];
      a.z = spawn[1];
      a.feetY = 0;
      a.yaw = a.team === 'jackal' ? 0 : Math.PI;
      a.pitch = 0;
      const survived = a.alive;
      a.health = 100;
      if (!survived) a.armor = 0;
      a.alive = true;
      a.crouched = false;
      a.speedRatio = 0;
      a.channel = null;
      a.reloadT = 0;
      a.drawT = 0;
      a.bloom = 0;
      a.blindT = 0;
      a.hasCharge = false;
      // Top up reserve ammunition for owned weapons each round.
      for (const wid of Object.keys(a.ammo)) {
        if (a.weapons.primary === wid || wid === 'p9') a.ammo[wid].reserve = WEAPONS[wid].reserve;
        if (a.ammo[wid].mag <= 0) a.ammo[wid].mag = WEAPONS[wid].mag;
      }
      if (!a.weapons.primary) a.current = 'p9';
      else if (!WEAPONS[a.current] && !GRENADES[a.current]) a.current = a.weapons.primary;
    });
    player.hasCharge = true;
    if (deps.playerCtrl) deps.playerCtrl.reset();
    if (deps.viewmodels) deps.viewmodels.show(player.current);

    const sentryHolds = [
      rng.pick(HOLDS.A), rng.pick(HOLDS.A), rng.pick(HOLDS.B), rng.pick(HOLDS.B), rng.pick(HOLDS.MID),
    ];
    let sentryIdx = 0;
    for (const b of bots) {
      const a = b.actor;
      b.reset(a.x, a.z, a.yaw);
      botBuy(a);
      if (a.team === 'sentry') {
        b.setHold(sentryHolds[sentryIdx % sentryHolds.length]);
        sentryIdx += 1;
      } else {
        b.setObjective(match.attackRally);
      }
    }
    match.phase = 'buy';
    match.phaseT = BUY_TIME;
    hud.banner(`ROUND ${match.round}`, `Jackals move on site ${match.attackSite} — B to buy`, 'us');
  }

  match.startMatch = () => {
    match.score.jackal = 0;
    match.score.sentry = 0;
    match.round = 0;
    lossStreak = { jackal: 0, sentry: 0 };
    for (const a of actors) {
      a.money = 800;
      a.kills = 0;
      a.deaths = 0;
      a.weapons.primary = null;
      a.current = 'p9';
      a.ammo = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
      a.grenades = { frag: 0, flash: 0, smoke: 0 };
      a.armor = 0;
      a.alive = true;
    }
    match.winner = null;
    match.draw = false;
    startRound();
  };

  function matchOver() {
    match.phase = 'over';
    if (match.score.jackal > match.score.sentry) match.winner = 'jackal';
    else if (match.score.sentry > match.score.jackal) match.winner = 'sentry';
    else match.draw = true;
  }

  // ---- per-step simulation ----
  const botCtx = {
    colliders, actors, noises: match.noises, rng,
    get smokes() { return effects.smokes; },
    get now() { return match.now; },
    match: null, // wired below
    fireHitscan: (a, wid, aim, spread) => fireHitscan(a, wid, aim, spread),
  };
  botCtx.match = match;

  match.step = (dt) => {
    match.now += dt;
    // Blindness fades for everyone.
    for (const a of actors) if (a.blindT > 0) a.blindT = Math.max(0, a.blindT - dt);
    // Reloads finish.
    for (const a of actors) {
      if (a.reloadT > 0) {
        a.reloadT -= dt;
        if (a.reloadT <= 0) finishReload(a);
      }
      if (a.drawT > 0) a.drawT -= dt;
      if (a.bloom > 0) a.bloom = Math.max(0, a.bloom - dt * 5.5);
    }
    // Noises age out.
    for (let i = match.noises.length - 1; i >= 0; i--) {
      if (match.now - match.noises[i].t > 1.6) match.noises.splice(i, 1);
    }
    // Channels progress; damage or death interrupts them.
    for (const a of actors) {
      if (!a.channel) continue;
      if (!a.alive || a.channelHurt) { a.channel = null; continue; }
      a.channel.t += dt;
      if (a.channel.t >= a.channel.dur) completeChannel(a);
    }
    // Bots think and move once the round is live (never during the buy freeze).
    if (match.phase === 'live' || match.phase === 'planted' || match.phase === 'end') {
      for (const b of bots) b.step(dt, botCtx, match.now);
    }
    // The charge rides on its carrier's back; planted, it blinks faster as the fuse burns.
    if (match.bomb.state === 'carried' && match.bomb.carrier) {
      const c = match.bomb.carrier;
      chargeMesh.visible = true;
      chargeMesh.position.set(c.x + Math.sin(c.yaw) * 0.24, c.feetY + 1.28, c.z + Math.cos(c.yaw) * 0.24);
      chargeMesh.rotation.y = c.yaw;
      lampMesh.material.emissive.setHex(0xcc7722);
    } else if (match.bomb.state === 'dropped' || match.bomb.state === 'planted') {
      chargeMesh.visible = true;
      chargeMesh.position.set(match.bomb.x, match.bomb.y + 0.14, match.bomb.z);
      const planted = match.bomb.state === 'planted';
      const blink = planted ? Math.sin(match.now * (match.bomb.fuseT < 10 ? 14 : 7)) > 0 : Math.sin(match.now * 3) > 0;
      lampMesh.material.emissive.setHex(blink ? 0xff2222 : 0x441111);
    } else {
      chargeMesh.visible = false;
    }
    grenades.step(dt);

    // Phase clocks.
    if (match.phase === 'buy') {
      match.phaseT -= dt;
      if (match.phaseT <= 0) {
        match.phase = 'live';
        match.phaseT = ROUND_TIME;
        hud.centerMsg(`Round ${match.round} live — site ${match.attackSite}`);
      }
    } else if (match.phase === 'live') {
      match.phaseT -= dt;
      if (match.phaseT <= 0) endRound('sentry', 'time');
    } else if (match.phase === 'planted') {
      match.bomb.fuseT -= dt;
      if (match.now >= beepAt) {
        const f = match.bomb.fuseT;
        beepAt = match.now + (f > 10 ? 1 : f > 5 ? 0.5 : 0.25);
        audio.beep(f < 1.2);
      }
      if (match.bomb.fuseT <= 0) {
        match.bomb.state = 'gone';
        endRound('jackal', 'objective');
      }
    } else if (match.phase === 'end') {
      match.phaseT -= dt;
      if (match.phaseT <= 0) {
        const played = match.score.jackal + match.score.sentry;
        if (match.score.jackal >= WIN_SCORE || match.score.sentry >= WIN_SCORE) matchOver();
        else if (played >= MAX_ROUNDS && match.score.jackal !== match.score.sentry) matchOver();
        else if (played > MAX_ROUNDS) matchOver(); // the decider has been played
        else startRound();
      }
    }
  };

  match.stepNoise = (a, radius) => {
    match.noises.push({ x: a.x, z: a.z, radius, team: a.team, t: match.now });
  };

  // ---- screenshot poses (deterministic, driven by main.js ?shot= modes) ----
  match.poseShot = (name) => {
    if (name === 'start') {
      actors.forEach((a, i) => {
        const spawn = SPAWNS[a.team][a.isPlayer ? 0 : (i % 5)];
        a.x = spawn[0]; a.z = spawn[1]; a.feetY = 0;
        a.yaw = a.team === 'jackal' ? 0 : Math.PI;
        a.alive = true; a.health = 100;
      });
      for (const b of bots) b.reset(b.actor.x, b.actor.z, b.actor.yaw);
      player.x = -29; player.z = 24; player.yaw = 0.5;
      match.bomb.state = 'carried';
      match.bomb.carrier = player;
      player.hasCharge = true;
      return;
    }
    match.startMatch();
    if (name === 'buy') {
      player.money = 4350;
      match.phaseT = 8;
      return;
    }
    if (name === 'play') {
      // Mid-round: the player pushes mid with a Kestrel, a Sentry holds the bar ahead.
      match.phase = 'live';
      match.phaseT = 63;
      match.round = 6;
      match.score.jackal = 3;
      match.score.sentry = 2;
      player.money = 1450;
      player.weapons.primary = 'kestrel';
      player.ammo.kestrel = { mag: 17, reserve: 90 };
      player.current = 'kestrel';
      player.armor = 100;
      player.health = 72;
      player.grenades.frag = 1;
      player.x = 1.5; player.z = 9; player.yaw = 0.12; player.pitch = 0.02;
      if (deps.viewmodels) deps.viewmodels.show('kestrel');
      const sentry = actors.find((a) => a.team === 'sentry');
      sentry.x = 0; sentry.z = -3; sentry.yaw = Math.PI;
      const mate = actors.find((a) => a.team === 'jackal' && !a.isPlayer);
      mate.x = -3.4; mate.z = 12; mate.yaw = 0.3;
      for (const b of bots) b.reset(b.actor.x, b.actor.z, b.actor.yaw);
      hud.killfeed(actors.find((a) => a.name === 'Vex'), sentry, 'Kestrel', false);
      hud.killfeed(player, actors.filter((a) => a.team === 'sentry')[1], 'Kestrel', true);
      return;
    }
    if (name === 'end') {
      match.score.jackal = 7;
      match.score.sentry = 4;
      match.round = 11;
      match.phase = 'over';
      match.winner = 'jackal';
      player.x = -22; player.z = -8; player.yaw = 2.6;
      match.bomb.state = 'planted';
      match.bomb.x = -22; match.bomb.z = -14; match.bomb.y = 0;
      match.bomb.site = 'A';
    }
  };

  return match;
}
