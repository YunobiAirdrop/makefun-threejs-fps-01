// Weapon definitions, the damage/spread model both sides shoot by, the first-person
// viewmodels, and thrown grenades. Accuracy is the game's core bargain: spread grows with
// movement, airtime and sustained fire, and shrinks to a point when you stop and crouch —
// so holding an angle beats running at one.
import * as THREE from 'three';
import { groundHeightAt } from './physics.js';

// damage: per pellet/bullet at the muzzle. head/legs multiply it; past `range` it falls
// linearly to minFactor at `falloff`. spread is in degrees: base + bloom + move * moveSpread.
export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', short: 'P9', price: 0, slot: 'sidearm', kind: 'pistol',
    damage: 26, headMult: 4, legMult: 0.75, rpm: 340, auto: false, mag: 12, reserve: 60,
    reload: 1.5, range: 14, falloff: 38, minFactor: 0.5, pellets: 1,
    spreadBase: 0.55, spreadMove: 2.4, bloom: 0.5, bloomMax: 2.6, recoil: 0.011, kick: 0.05,
  },
  raptor: {
    name: 'Raptor SMG', short: 'Raptor', price: 1200, slot: 'primary', kind: 'smg',
    damage: 21, headMult: 4, legMult: 0.75, rpm: 800, auto: true, mag: 30, reserve: 90,
    reload: 2.1, range: 11, falloff: 32, minFactor: 0.45, pellets: 1,
    spreadBase: 0.8, spreadMove: 1.7, bloom: 0.32, bloomMax: 3.2, recoil: 0.008, kick: 0.035,
  },
  mule: {
    name: 'Mule 12', short: 'Mule', price: 1100, slot: 'primary', kind: 'shotgun',
    damage: 11, headMult: 2.2, legMult: 0.75, rpm: 68, auto: false, mag: 6, reserve: 24,
    reload: 2.9, range: 6, falloff: 20, minFactor: 0.25, pellets: 8,
    spreadBase: 3.4, spreadMove: 2.0, bloom: 0, bloomMax: 0, recoil: 0.05, kick: 0.16,
  },
  kestrel: {
    name: 'Kestrel Rifle', short: 'Kestrel', price: 2700, slot: 'primary', kind: 'rifle',
    damage: 33, headMult: 4, legMult: 0.75, rpm: 600, auto: true, mag: 30, reserve: 90,
    reload: 2.4, range: 20, falloff: 60, minFactor: 0.6, pellets: 1,
    spreadBase: 0.32, spreadMove: 2.6, bloom: 0.42, bloomMax: 3.4, recoil: 0.013, kick: 0.06,
  },
  longbow: {
    name: 'Longbow .338', short: 'Longbow', price: 3500, slot: 'primary', kind: 'sniper',
    damage: 97, headMult: 2, legMult: 0.6, rpm: 38, auto: false, mag: 5, reserve: 30,
    reload: 3.1, range: 40, falloff: 120, minFactor: 0.9, pellets: 1, zoom: 3.2,
    spreadBase: 0.06, spreadMove: 4.5, bloom: 0, bloomMax: 0, recoil: 0.07, kick: 0.22,
  },
};
export const GRENADES = {
  frag: { name: 'Frag Grenade', short: 'Frag', price: 300 },
  flash: { name: 'Flashbang', short: 'Flash', price: 200 },
  smoke: { name: 'Smoke Grenade', short: 'Smoke', price: 300 },
};
export const ARMOR_PRICE = 650;
// The buy menu, in key order: [key, kind, id].
export const SHOP = [
  ['1', 'weapon', 'mule'], ['2', 'weapon', 'raptor'], ['3', 'weapon', 'kestrel'], ['4', 'weapon', 'longbow'],
  ['5', 'armor', 'armor'], ['6', 'grenade', 'frag'], ['7', 'grenade', 'flash'], ['8', 'grenade', 'smoke'],
];

export function damageAt(def, dist, part, target) {
  let dmg = def.damage;
  if (dist > def.range) {
    const k = Math.min(1, (dist - def.range) / Math.max(1, def.falloff - def.range));
    dmg *= 1 - k * (1 - def.minFactor);
  }
  if (part === 'head') dmg *= def.headMult;
  else if (part === 'legs') dmg *= def.legMult;
  if (target.armor > 0 && part !== 'legs') {
    dmg *= part === 'head' ? 0.7 : 0.55;
    target.armor = Math.max(0, target.armor - def.damage * 0.45);
  }
  return dmg;
}

// Total spread in radians for a shooter in this state. speedRatio is 0 standing, 1 at full
// run; crouch and ground contact pull it back down.
export function spreadRadians(def, bloom, speedRatio, crouched, grounded) {
  let deg = def.spreadBase + bloom + speedRatio * def.spreadMove;
  if (!grounded) deg *= 2.6;
  if (crouched) deg *= 0.55;
  return (deg * Math.PI) / 180;
}

// ---- Viewmodels: one low-poly gun per weapon, built from boxes, parented to the camera. ----
const VM_MATS = {
  body: new THREE.MeshLambertMaterial({ color: 0x2e3238 }),
  grip: new THREE.MeshLambertMaterial({ color: 0x1d2024 }),
  accent: new THREE.MeshLambertMaterial({ color: 0xb98a2f }),
  steel: new THREE.MeshLambertMaterial({ color: 0x6a7076 }),
};
function vmBox(parent, mat, x, y, z, w, h, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function buildViewmodel(id) {
  const g = new THREE.Group();
  if (id === 'p9') {
    vmBox(g, VM_MATS.body, 0, 0, 0, 0.055, 0.07, 0.19);
    vmBox(g, VM_MATS.grip, 0, -0.075, 0.055, 0.05, 0.11, 0.06);
    vmBox(g, VM_MATS.steel, 0, 0.045, -0.06, 0.02, 0.02, 0.05);
  } else if (id === 'raptor') {
    vmBox(g, VM_MATS.body, 0, 0, -0.05, 0.06, 0.09, 0.42);
    vmBox(g, VM_MATS.grip, 0, -0.08, 0.08, 0.05, 0.11, 0.055);
    vmBox(g, VM_MATS.body, 0, -0.07, -0.08, 0.045, 0.13, 0.06);
    vmBox(g, VM_MATS.steel, 0, 0.01, -0.32, 0.03, 0.03, 0.14);
    vmBox(g, VM_MATS.body, 0, 0, 0.19, 0.05, 0.07, 0.12);
  } else if (id === 'mule') {
    vmBox(g, VM_MATS.body, 0, 0, -0.06, 0.07, 0.08, 0.4);
    vmBox(g, VM_MATS.steel, 0, 0.02, -0.3, 0.045, 0.045, 0.22);
    vmBox(g, new THREE.MeshLambertMaterial({ color: 0x9a7a52 }), 0, -0.045, -0.16, 0.06, 0.05, 0.16);
    vmBox(g, VM_MATS.grip, 0, -0.08, 0.09, 0.05, 0.11, 0.055);
  } else if (id === 'kestrel') {
    vmBox(g, VM_MATS.body, 0, 0, -0.05, 0.065, 0.095, 0.5);
    vmBox(g, VM_MATS.grip, 0, -0.085, 0.1, 0.05, 0.115, 0.055);
    vmBox(g, VM_MATS.body, 0, -0.075, -0.1, 0.045, 0.14, 0.06);
    vmBox(g, VM_MATS.steel, 0, 0.015, -0.38, 0.028, 0.028, 0.18);
    vmBox(g, VM_MATS.accent, 0, 0.075, -0.05, 0.03, 0.045, 0.1);
    vmBox(g, VM_MATS.body, 0, 0, 0.24, 0.055, 0.075, 0.14);
  } else if (id === 'longbow') {
    vmBox(g, VM_MATS.body, 0, 0, -0.08, 0.06, 0.085, 0.52);
    vmBox(g, VM_MATS.steel, 0, 0.01, -0.48, 0.024, 0.024, 0.3);
    vmBox(g, VM_MATS.grip, 0, -0.08, 0.12, 0.05, 0.11, 0.055);
    vmBox(g, VM_MATS.body, 0, -0.06, -0.12, 0.042, 0.12, 0.055);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), VM_MATS.grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.1);
    g.add(scope);
    vmBox(g, VM_MATS.body, 0, -0.01, 0.28, 0.055, 0.07, 0.16);
  } else { // a grenade in hand
    const color = id === 'frag' ? 0x4a5d3a : id === 'flash' ? 0xd8d3c8 : 0x707880;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshLambertMaterial({ color }));
    ball.position.set(0, -0.01, -0.05);
    g.add(ball);
    vmBox(g, VM_MATS.steel, 0, 0.045, -0.05, 0.02, 0.03, 0.02);
  }
  g.position.set(0.24, -0.22, -0.42);
  g.rotation.y = 0.03;
  return g;
}

export function createViewmodels(camera) {
  const groups = new Map();
  for (const id of [...Object.keys(WEAPONS), 'frag', 'flash', 'smoke']) {
    const group = buildViewmodel(id);
    group.visible = false;
    camera.add(group);
    groups.set(id, group);
  }
  let current = null;
  let kickZ = 0;
  let dipY = 0;
  let bobT = 0;
  return {
    show(id) {
      if (current) groups.get(current).visible = false;
      current = id;
      if (id) groups.get(id).visible = true;
    },
    kick(amount) { kickZ = Math.min(0.16, kickZ + amount); },
    dip(amount) { dipY = amount; },
    muzzle(out) {
      // Just past the barrel of the current viewmodel, in world space.
      out.set(0.24, -0.2, -0.85);
      return groups.get(current)?.localToWorld(out) ?? out;
    },
    step(dt, speedRatio, reloading) {
      if (!current) return;
      const group = groups.get(current);
      kickZ = Math.max(0, kickZ - dt * 1.4);
      bobT += dt * (2 + speedRatio * 7);
      const targetDip = reloading ? 0.13 : 0;
      dipY += (targetDip - dipY) * Math.min(1, dt * 10);
      group.position.set(
        0.24 + Math.sin(bobT * 0.5) * 0.006 * speedRatio,
        -0.22 - Math.abs(Math.sin(bobT)) * 0.012 * speedRatio - dipY,
        -0.42 + kickZ,
      );
      group.rotation.x = dipY * 1.6 + kickZ * 0.7;
    },
  };
}

// ---- Grenades: thrown projectiles with bounce, then a timed effect through callbacks. ----
// handlers: { explode(x,y,z,owner), flash(x,y,z,owner), smoke(x,y,z) } — rounds.js owns damage.
export function createGrenades(scene, effects, audio, colliders, handlers, rng) {
  const COLORS = { frag: 0x4a5d3a, flash: 0xd8d3c8, smoke: 0x707880 };
  const live = [];
  const geo = new THREE.SphereGeometry(0.055, 10, 8);
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a5d3a }));
    mesh.visible = false;
    scene.add(mesh);
    live.push({ mesh, active: false, kind: 'frag', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, owner: null });
  }
  let cursor = 0;

  function throwIt(kind, from, dir, owner) {
    const slot = live[cursor % live.length];
    cursor += 1;
    slot.kind = kind;
    slot.owner = owner;
    slot.x = from.x; slot.y = from.y; slot.z = from.z;
    const speed = 15;
    slot.vx = dir.x * speed;
    slot.vy = dir.y * speed + 2.4;
    slot.vz = dir.z * speed;
    slot.fuse = kind === 'smoke' ? 1.1 : 1.6;
    slot.active = true;
    slot.mesh.material.color.setHex(COLORS[kind]);
    slot.mesh.visible = true;
    audio.throwIt();
  }

  function detonate(slot) {
    slot.active = false;
    slot.mesh.visible = false;
    const { x, y, z } = slot;
    if (slot.kind === 'frag') {
      effects.explosion(x, y + 0.4, z);
      effects.impact(x, y + 0.4, z, 14, rng);
      handlers.explode(x, y, z, slot.owner);
    } else if (slot.kind === 'flash') {
      effects.explosion(x, y + 0.3, z);
      handlers.flash(x, y, z, slot.owner);
    } else {
      effects.smoke(x, 0, z, rng);
      handlers.smoke(x, y, z, slot.owner);
    }
  }

  function step(dt) {
    for (const slot of live) {
      if (!slot.active) continue;
      slot.fuse -= dt;
      slot.vy -= 14 * dt;
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt;
      slot.z += slot.vz * dt;
      const ground = groundHeightAt(colliders, slot.x, slot.z) + 0.06;
      if (slot.y < ground) {
        slot.y = ground;
        slot.vy = Math.abs(slot.vy) * 0.38;
        slot.vx *= 0.72;
        slot.vz *= 0.72;
        if (slot.kind === 'smoke') { detonate(slot); continue; }
      }
      // Bounce off tall walls cheaply: reverse the dominant horizontal axis on penetration.
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (b.top < 1.2) continue;
        if (slot.x > b.minX - 0.06 && slot.x < b.maxX + 0.06 && slot.z > b.minZ - 0.06 && slot.z < b.maxZ + 0.06 && slot.y < b.top) {
          const dxMin = Math.min(Math.abs(slot.x - b.minX), Math.abs(slot.x - b.maxX));
          const dzMin = Math.min(Math.abs(slot.z - b.minZ), Math.abs(slot.z - b.maxZ));
          if (dxMin < dzMin) slot.vx = -slot.vx * 0.5; else slot.vz = -slot.vz * 0.5;
          slot.x += slot.vx * dt * 2;
          slot.z += slot.vz * dt * 2;
          break;
        }
      }
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      if (slot.fuse <= 0) detonate(slot);
    }
  }

  return { throwIt, step };
}
