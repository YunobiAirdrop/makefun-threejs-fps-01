// The bots: low-poly soldiers built from boxes, and the AI that walks them. A bot perceives
// the world the way the player does — a view cone, a sight line that walls and smoke break,
// and ears for gunfire and footsteps — then acts on a simple state machine: advance along the
// waypoint graph to its objective, hold a post, engage what it sees, plant or defuse when its
// moment comes. It shoots with the same weapon table and spread model as the player, and it
// stops to fire, because moving fire is wild fire for bots too.
import * as THREE from 'three';
import { groundHeightAt, moveCircle, segmentClear } from './physics.js';
import { findPath, nearestNode, nodePos, HOLDS } from './map.js';
import { WEAPONS, spreadRadians } from './weapons.js';

const TEAM_COLORS = {
  jackal: { torso: 0xc77f33, helm: 0x8a5a22 },
  sentry: { torso: 0x2e8f83, helm: 0x1f6159 },
};
const PANTS = 0x3a3f45;
const SKIN = 0xc9a186;

function limb(w, h, d, mat, px, py, pz) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0); // pivot at the top, so rotation swings it like a limb
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(px, py, pz);
  mesh.castShadow = true;
  return mesh;
}

export function createBotMesh(scene, team) {
  const colors = TEAM_COLORS[team];
  const mats = {
    torso: new THREE.MeshLambertMaterial({ color: colors.torso }),
    helm: new THREE.MeshLambertMaterial({ color: colors.helm }),
    pants: new THREE.MeshLambertMaterial({ color: PANTS }),
    skin: new THREE.MeshLambertMaterial({ color: SKIN }),
    gun: new THREE.MeshLambertMaterial({ color: 0x24272c }),
  };
  const group = new THREE.Group();
  const legL = limb(0.15, 0.92, 0.17, mats.pants, -0.11, 0.92, 0);
  const legR = limb(0.15, 0.92, 0.17, mats.pants, 0.11, 0.92, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), mats.torso);
  torso.position.y = 1.22;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), mats.skin);
  head.position.y = 1.66;
  head.castShadow = true;
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), mats.helm);
  helm.position.y = 1.82;
  const armL = limb(0.11, 0.58, 0.13, mats.torso, -0.3, 1.48, 0);
  armL.rotation.x = -0.5;
  const armR = new THREE.Group();
  armR.position.set(0.3, 1.48, 0);
  const armRMesh = limb(0.11, 0.58, 0.13, mats.torso, 0, 0, 0);
  armR.add(armRMesh);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.62), mats.gun);
  gun.position.set(0, -0.52, -0.24);
  armR.add(gun);
  armR.rotation.x = -1.35; // arm raised, gun level, in the local -z facing
  group.add(legL, legR, torso, head, helm, armL, armR);
  scene.add(group);
  return { group, legL, legR, armL, armR, mats };
}

export function createBot(scene, actor, rng) {
  const mesh = createBotMesh(scene, actor.team);
  const bot = {
    actor,
    mesh,
    mode: 'advance',
    path: [],
    pathIdx: 0,
    destNode: null,
    hold: null, // { x, z, faceX, faceZ }
    visible: null,
    lastSeen: null, // { x, y, z, t }
    alert: null, // { x, z, t }
    thinkAt: rng.range(0, 0.12),
    aimSettle: 0,
    burstLeft: 0,
    burstWait: 0,
    nextShot: 0,
    reloading: 0,
    strafeDir: 1,
    strafeAt: 0,
    walkPhase: 0,
    deathT: 0,
    flashT: 0,
    scanPhase: rng.range(0, 6),
  };

  bot.setObjective = (nodeId) => {
    bot.destNode = nodeId;
    const from = nearestNode(actor.x, actor.z);
    bot.path = findPath(from, nodeId);
    bot.pathIdx = bot.path.length > 1 ? 1 : 0;
    bot.mode = 'advance';
  };

  bot.setHold = (holdEntry) => {
    const [nodeId, fx, fz] = holdEntry;
    bot.hold = { nodeId, faceX: fx, faceZ: fz };
    bot.setObjective(nodeId);
  };

  function faceToward(dt, tx, tz, rate = 10) {
    const want = Math.atan2(-(tx - actor.x), -(tz - actor.z));
    let diff = want - actor.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    actor.yaw += diff * Math.min(1, dt * rate);
    return Math.abs(diff);
  }

  function moveToward(dt, tx, tz, speed) {
    const dx = tx - actor.x;
    const dz = tz - actor.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return 0;
    const stepLen = Math.min(dist, speed * dt);
    const pos = { x: actor.x, z: actor.z };
    moveCircle(bot.colliders, pos, (dx / dist) * stepLen, (dz / dist) * stepLen, actor.feetY);
    actor.x = pos.x;
    actor.z = pos.z;
    actor.feetY = groundHeightAt(bot.colliders, actor.x, actor.z);
    actor.speedRatio = Math.min(1, speed / 5.3);
    bot.walkPhase += stepLen * 2.4;
    return dist;
  }

  // Perception: the dearest enemy this bot can currently see, or null.
  function perceive(ctx) {
    const eyeY = actor.feetY + (actor.crouched ? 1.12 : 1.6);
    let best = null;
    let bestDist = Infinity;
    for (const foe of ctx.actors) {
      if (!foe.alive || foe.team === actor.team) continue;
      const dx = foe.x - actor.x;
      const dz = foe.z - actor.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 58) continue;
      if (dist > 4.5) {
        const fx = -Math.sin(actor.yaw);
        const fz = -Math.cos(actor.yaw);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        if (dot < 0.26) continue; // outside the view cone
      }
      const chestY = foe.feetY + (foe.crouched ? 0.95 : 1.25);
      if (!segmentClear(bot.colliders, ctx.smokes, actor.x, eyeY, actor.z, foe.x, chestY, foe.z)) continue;
      if (dist < bestDist) { bestDist = dist; best = foe; }
    }
    return best;
  }

  bot.step = (dt, ctx, now) => {
    bot.colliders = ctx.colliders;
    const a = actor;
    if (!a.alive) {
      bot.deathT += dt;
      const k = Math.min(1, bot.deathT / 0.45);
      mesh.group.rotation.x = -k * Math.PI * 0.5;
      mesh.group.position.y = a.feetY + k * 0.12;
      return;
    }
    mesh.group.rotation.x = 0;

    // --- Think (staggered): perception and decisions a few times a second. ---
    if (now >= bot.thinkAt) {
      bot.thinkAt = now + 0.12;
      const seen = actor.blindT > 0.35 ? null : perceive(ctx);
      if (seen) {
        if (bot.visible !== seen) bot.aimSettle = 0;
        bot.visible = seen;
        bot.lastSeen = { x: seen.x, y: seen.feetY + 1.2, z: seen.z, t: now };
        bot.alert = null;
      } else if (bot.visible && now - (bot.lastSeen?.t ?? 0) > 1.6) {
        bot.visible = null;
      }
      for (const noise of ctx.noises) {
        if (now - noise.t > 1.2) continue;
        const d = Math.hypot(noise.x - a.x, noise.z - a.z);
        if (d < noise.radius && noise.team !== a.team) bot.alert = { x: noise.x, z: noise.z, t: now };
      }
      decide(ctx, now);
    }
    bot.aimSettle = Math.min(1, bot.aimSettle + dt / 0.55);

    // --- Act on the mode. ---
    a.crouched = false;
    if (a.channel) {
      // Planting or defusing: stand (or kneel) still and let rounds.js run the channel.
      a.crouched = a.channel.type === 'defuse';
    } else if (bot.visible) {
      engage(dt, ctx, now);
    } else if (bot.mode === 'hold' && bot.hold && atNode(bot.hold.nodeId)) {
      const h = bot.hold;
      faceToward(dt, h.faceX, h.faceZ, 4);
      a.crouched = bot.holdCrouch;
      // A held post still answers a noise: turn toward it briefly.
      if (bot.alert && now - bot.alert.t < 2.5) faceToward(dt, bot.alert.x, bot.alert.z, 6);
      a.speedRatio = 0;
    } else if (bot.path.length) {
      followPath(dt, ctx);
    } else {
      a.speedRatio = 0;
    }

    // --- Reload discipline. ---
    const wid = a.current === 'primary' && a.weapons.primary ? a.weapons.primary : 'p9';
    const ammo = a.ammo[wid];
    if (bot.reloading > 0) {
      bot.reloading -= dt;
      if (bot.reloading <= 0 && ammo) { const need = WEAPONS[wid].mag - ammo.mag; const take = Math.min(need, ammo.reserve); ammo.mag += take; ammo.reserve -= take; }
    } else if (ammo && ammo.mag === 0 && ammo.reserve > 0 && !bot.visible) {
      bot.reloading = WEAPONS[wid].reload;
    }

    pose(dt);
  };

  function atNode(nodeId) {
    const [nx, nz] = nodePos(nodeId);
    return Math.hypot(nx - actor.x, nz - actor.z) < 1.1;
  }

  function decide(ctx, now) {
    const a = actor;
    const match = ctx.match;
    if (a.channel) return;
    // Bomb planted: sentries converge and defuse; jackals fall back to guard it.
    if (match.bomb.state === 'planted') {
      if (a.team === 'sentry') {
        const d = Math.hypot(match.bomb.x - a.x, match.bomb.z - a.z);
        if (d < 1.6) { match.startChannel(a, 'defuse'); return; }
        bot.setObjective(nearestNode(match.bomb.x, match.bomb.z));
        bot.mode = 'retake';
        return;
      }
      if (bot.mode !== 'hold') {
        bot.hold = { nodeId: nearestNode(a.x, a.z), faceX: match.bomb.x, faceZ: match.bomb.z };
        bot.mode = 'hold';
        bot.path = [];
      }
      return;
    }
    // I have the charge and I am on the site: plant it.
    if (a.hasCharge && match.siteAt(a.x, a.z)) { match.startChannel(a, 'plant'); return; }
    // The charge is down and I am the nearest free jackal: go and fetch it.
    if (match.bomb.state === 'dropped' && a.team === 'jackal' && match.fetchAssignee === a) {
      const d = Math.hypot(match.bomb.x - a.x, match.bomb.z - a.z);
      if (d < 1.5) { match.pickupCharge(a); return; }
      if (bot.destNode !== nearestNode(match.bomb.x, match.bomb.z) || bot.mode !== 'fetch') {
        bot.setObjective(nearestNode(match.bomb.x, match.bomb.z));
        bot.mode = 'fetch';
      }
      return;
    }
    if (bot.mode === 'retake' || bot.mode === 'fetch') bot.mode = 'advance';
    // Jackal push: rally at the site door, then onto the site itself and guard it.
    if (a.team === 'jackal' && bot.mode !== 'hold') {
      if (bot.destNode === match.attackRally && atNode(match.attackRally)) {
        bot.setObjective(match.attackSiteNode);
      } else if (bot.destNode === match.attackSiteNode && atNode(match.attackSiteNode)) {
        bot.hold = { nodeId: match.attackSiteNode, faceX: match.guardFace[0], faceZ: match.guardFace[1] };
        bot.mode = 'hold';
        bot.path = [];
      }
    }
    // Default duties.
    if (a.team === 'sentry' && bot.hold && bot.mode !== 'hold') {
      if (!atNode(bot.hold.nodeId) && bot.destNode !== bot.hold.nodeId) bot.setObjective(bot.hold.nodeId);
      else if (atNode(bot.hold.nodeId)) bot.mode = 'hold';
    }
    if (a.team === 'jackal' && !bot.destNode) bot.setObjective(match.attackRally);
  }

  function followPath(dt, ctx) {
    const a = actor;
    if (bot.pathIdx >= bot.path.length) {
      if (bot.hold && bot.destNode === bot.hold.nodeId) bot.mode = 'hold';
      a.speedRatio = 0;
      return;
    }
    const [tx, tz] = nodePos(bot.path[bot.pathIdx]);
    faceToward(dt, tx, tz, 8);
    const dist = moveToward(dt, tx, tz, bot.mode === 'retake' ? 5.1 : 4.8);
    if (dist < 0.8) bot.pathIdx += 1;
    // On the way, glance toward a recent noise.
    if (bot.alert && ctx.now - bot.alert.t < 1.5) faceToward(dt, bot.alert.x, bot.alert.z, 3);
  }

  function engage(dt, ctx, now) {
    const a = actor;
    const foe = bot.visible;
    const dist = Math.hypot(foe.x - a.x, foe.z - a.z);
    faceToward(dt, foe.x, foe.z, 14);
    a.pitch = Math.atan2((foe.feetY + 1.25) - (a.feetY + 1.55), dist);

    // Movement in a fight: close in when far, back off when point-blank, else strafe in bursts.
    let mx = 0;
    let mz = 0;
    if (now >= bot.strafeAt) { bot.strafeAt = now + ctx.rng.range(0.5, 1.1); bot.strafeDir = ctx.rng.chance(0.5) ? 1 : -1; }
    const firing = bot.burstLeft > 0;
    if (!firing) {
      const px = -Math.cos(a.yaw) * bot.strafeDir;
      const pz = Math.sin(a.yaw) * bot.strafeDir;
      // Defenders are leashed to their post: they trade fire but never chase across the map.
      let leashed = false;
      if (a.team === 'sentry' && bot.hold) {
        const [hx, hz] = nodePos(bot.hold.nodeId);
        leashed = Math.hypot(a.x - hx, a.z - hz) > 13;
      }
      if (dist > 16 && !leashed) { mx = -Math.sin(a.yaw); mz = -Math.cos(a.yaw); }
      else if (dist < 5) { mx = Math.sin(a.yaw); mz = Math.cos(a.yaw); }
      else { mx = px; mz = pz; }
      if (mx !== 0 || mz !== 0) {
        const pos = { x: a.x, z: a.z };
        moveCircle(bot.colliders, pos, mx * 2.1 * dt, mz * 2.1 * dt, a.feetY);
        a.x = pos.x; a.z = pos.z;
        a.feetY = groundHeightAt(bot.colliders, a.x, a.z);
        bot.walkPhase += 2.1 * dt * 2.4;
      }
    }
    a.speedRatio = firing ? 0 : 0.4;
    a.crouched = dist > 20 && bot.holdCrouch;

    // Fire control: settled aim, bursts, pauses — the same discipline the spread model rewards.
    if (bot.reloading > 0) return;
    const wid = a.current === 'primary' && a.weapons.primary ? a.weapons.primary : 'p9';
    const def = WEAPONS[wid];
    const ammo = a.ammo[wid];
    if (!ammo || ammo.mag <= 0) return;
    if (bot.burstWait > 0) { bot.burstWait -= dt; return; }
    if (bot.burstLeft <= 0) {
      // Start a burst only once the aim has had its reaction moment.
      if (bot.aimSettle < 0.45) return;
      bot.burstLeft = def.auto ? ctx.rng.int(3, 6) : 1;
    }
    if (now < bot.nextShot) return;
    bot.nextShot = now + 60 / def.rpm;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.burstWait = ctx.rng.range(0.35, 0.75);
    // Aim: chest, sometimes the head once settled; error shrinks as the settle grows.
    const headShot = bot.aimSettle > 0.75 && ctx.rng.chance(0.3);
    const ty = foe.feetY + (foe.crouched ? (headShot ? 1.18 : 0.95) : (headShot ? 1.6 : 1.22));
    const err = (1 - bot.aimSettle) * 0.055 + 0.006;
    const aim = {
      x: foe.x + ctx.rng.range(-err, err) * dist,
      y: ty + ctx.rng.range(-err, err) * dist * 0.6,
      z: foe.z + ctx.rng.range(-err, err) * dist,
    };
    const spread = spreadRadians(def, 0, firing ? 0 : 0.4, a.crouched, true);
    ctx.fireHitscan(a, wid, aim, spread);
  }

  function pose(dt) {
    const a = actor;
    mesh.group.position.set(a.x, a.feetY, a.z);
    mesh.group.rotation.y = a.yaw;
    const swing = Math.sin(bot.walkPhase) * 0.55 * (a.speedRatio > 0.05 ? 1 : 0);
    mesh.legL.rotation.x = swing;
    mesh.legR.rotation.x = -swing;
    mesh.armL.rotation.x = -0.5 + swing * 0.6;
    mesh.armR.rotation.x = -1.35 + (a.pitch || 0);
    const crouchDrop = a.crouched ? 0.34 : 0;
    mesh.group.position.y = a.feetY - crouchDrop;
    mesh.legL.rotation.x += a.crouched ? 0.9 : 0;
    mesh.legR.rotation.x += a.crouched ? -0.4 : 0;
    if (bot.flashT > 0) {
      bot.flashT -= dt;
      const e = bot.flashT > 0 ? 0.55 : 0;
      mesh.mats.torso.emissive.setScalar(e);
    }
  }

  bot.hitFlash = () => {
    bot.flashT = 0.07;
    mesh.mats.torso.emissive.setScalar(0.55);
  };

  bot.reset = (x, z, yaw) => {
    bot.mode = 'advance';
    bot.path = [];
    bot.pathIdx = 0;
    bot.destNode = null;
    bot.visible = null;
    bot.lastSeen = null;
    bot.alert = null;
    bot.burstLeft = 0;
    bot.burstWait = 0;
    bot.reloading = 0;
    bot.deathT = 0;
    mesh.group.rotation.set(0, yaw, 0);
    mesh.group.visible = true;
    pose(0);
  };

  bot.holdCrouch = rng.chance(0.45);
  return bot;
}
