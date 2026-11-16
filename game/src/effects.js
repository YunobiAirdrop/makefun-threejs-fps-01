// Transient visuals, all pooled: tracers, impact sparks, muzzle flashes, explosions and smoke
// clouds. Nothing here allocates in the step loop — pools are fixed arrays of meshes whose
// lifetimes tick down; a spawn takes the oldest free slot.
import * as THREE from 'three';

const TRACERS = 40;
const SPARKS = 90;
const FLASHES = 12;

export function createEffects(scene) {
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }

  const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const sparks = [];
  for (let i = 0; i < SPARKS; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
  }

  const flashGeo = new THREE.PlaneGeometry(0.34, 0.34);
  const flashes = [];
  for (let i = 0; i < FLASHES; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdf9e, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(flashGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, life: 0 });
  }

  const boomLight = new THREE.PointLight(0xffa050, 0, 22, 1.6);
  scene.add(boomLight);
  const boomMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, depthWrite: false }),
  );
  boomMesh.visible = false;
  scene.add(boomMesh);
  let boomLife = 0;

  // Smoke clouds: a cluster of soft spheres. The same objects back the AI's smoke list —
  // rounds.js reads `smokes` (x, y, z, r, active) for sight-line tests.
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xb9bec2, transparent: true, opacity: 0.34, depthWrite: false });
  const smokes = [];
  for (let i = 0; i < 6; i++) {
    const group = new THREE.Group();
    const puffs = [];
    for (let j = 0; j < 7; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), smokeMat);
      group.add(puff);
      puffs.push(puff);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, puffs, x: 0, y: 0, z: 0, r: 3.6, life: 0, active: false });
  }

  let cursor = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function tracer(x1, y1, z1, x2, y2, z2) {
    const slot = tracers[cursor % TRACERS];
    cursor += 1;
    mid.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    dir.set(x2 - x1, y2 - y1, z2 - z1);
    const len = dir.length() || 0.001;
    slot.mesh.position.copy(mid);
    slot.mesh.scale.set(1, 1, len);
    slot.mesh.lookAt(x2, y2, z2);
    slot.mesh.material.opacity = 0.85;
    slot.mesh.visible = true;
    slot.life = 0.05;
  }

  function impact(x, y, z, count, rng) {
    for (let n = 0; n < count; n++) {
      const slot = sparks[cursor % SPARKS];
      cursor += 1;
      slot.mesh.position.set(x, y, z);
      slot.vx = rng.range(-1.6, 1.6);
      slot.vy = rng.range(0.4, 2.6);
      slot.vz = rng.range(-1.6, 1.6);
      slot.life = rng.range(0.18, 0.42);
      slot.mesh.visible = true;
    }
  }

  function muzzle(x, y, z, yaw, pitch) {
    const slot = flashes[cursor % FLASHES];
    cursor += 1;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.set(pitch, yaw, Math.random() * Math.PI, 'YXZ');
    slot.mesh.visible = true;
    slot.life = 0.045;
  }

  function explosion(x, y, z) {
    boomMesh.position.set(x, y, z);
    boomMesh.visible = true;
    boomLife = 0.38;
    boomLight.position.set(x, y + 1, z);
    boomLight.intensity = 60;
  }

  function smoke(x, y, z, rng) {
    let slot = smokes[0];
    for (let i = 0; i < smokes.length; i++) if (!smokes[i].active) { slot = smokes[i]; break; }
    slot.x = x; slot.y = y + 1.4; slot.z = z;
    slot.life = 14;
    slot.active = true;
    slot.group.position.set(x, y, z);
    for (let j = 0; j < slot.puffs.length; j++) {
      const puff = slot.puffs[j];
      const a = (j / slot.puffs.length) * Math.PI * 2;
      puff.position.set(Math.cos(a) * rng.range(0.4, 1.9), rng.range(0.5, 2.4), Math.sin(a) * rng.range(0.4, 1.9));
      const s = rng.range(1.1, 2.1);
      puff.scale.set(s, s * 0.8, s);
    }
    slot.group.visible = true;
    return slot;
  }

  function step(dt) {
    for (let i = 0; i < TRACERS; i++) {
      const s = tracers[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.mesh.material.opacity = Math.max(0, s.life / 0.05) * 0.85;
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (let i = 0; i < SPARKS; i++) {
      const s = sparks[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy -= 9.8 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (let i = 0; i < FLASHES; i++) {
      const s = flashes[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) s.mesh.visible = false;
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const k = Math.max(0, boomLife / 0.38);
      const r = 1 + (1 - k) * 6.5;
      boomMesh.scale.set(r, r, r);
      boomMesh.material.opacity = k * 0.55;
      boomLight.intensity = k * 60;
      if (boomLife <= 0) { boomMesh.visible = false; boomLight.intensity = 0; }
    }
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; s.group.visible = false; }
    }
  }

  return { tracer, impact, muzzle, explosion, smoke, step, smokes, up };
}
