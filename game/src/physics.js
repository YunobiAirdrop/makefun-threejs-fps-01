// Collision and ray tests against the map's axis-aligned boxes. A box is
// { minX, maxX, minZ, maxZ, top } with its base on the ground (y = 0) — every wall, crate and
// building in EMBERLINE is one of these, so movement, bullets and sight lines all share them.
//
// Movement treats an actor as a circle in plan view (x/z) plus a feet height: boxes no taller
// than STEP can be stood on, taller ones block. Rays are true 3D slab tests against the boxes.

export const STEP = 1.05; // highest ledge an actor steps/lands on instead of being blocked
export const ACTOR_RADIUS = 0.36;

// The ground height under a point: the top of the tallest steppable box there, else 0.
export function groundHeightAt(boxes, x, z) {
  let ground = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.top <= STEP && b.top > ground) {
      ground = b.top;
    }
  }
  return ground;
}

// Move a circle in plan view, axis separated so actors slide along walls. `pos` is a
// { x, z } mutated in place; feetY is the actor's current feet height (boxes at or below
// feetY + STEP never block, so you can walk up onto a crate and across it).
export function moveCircle(boxes, pos, dx, dz, feetY) {
  const limit = feetY + STEP;
  if (dx !== 0) {
    const nx = pos.x + dx;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.top <= limit) continue;
      if (nx + ACTOR_RADIUS > b.minX && nx - ACTOR_RADIUS < b.maxX && pos.z + ACTOR_RADIUS > b.minZ && pos.z - ACTOR_RADIUS < b.maxZ) {
        pos.x = dx > 0 ? b.minX - ACTOR_RADIUS : b.maxX + ACTOR_RADIUS;
        dx = 0;
        break;
      }
    }
    if (dx !== 0) pos.x += dx;
  }
  if (dz !== 0) {
    const nz = pos.z + dz;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.top <= limit) continue;
      if (pos.x + ACTOR_RADIUS > b.minX && pos.x - ACTOR_RADIUS < b.maxX && nz + ACTOR_RADIUS > b.minZ && nz - ACTOR_RADIUS < b.maxZ) {
        pos.z = dz > 0 ? b.minZ - ACTOR_RADIUS : b.maxZ + ACTOR_RADIUS;
        dz = 0;
        break;
      }
    }
    if (dz !== 0) pos.z += dz;
  }
}

// Slab-test one ray against one box; returns the entry distance or Infinity. The origin is
// (ox, oy, oz), the direction (dx, dy, dz) need not be normalised — t is in direction units.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  if (dx === 0) { if (ox < b.minX || ox > b.maxX) return Infinity; }
  else {
    let t1 = (b.minX - ox) / dx;
    let t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (dz === 0) { if (oz < b.minZ || oz > b.maxZ) return Infinity; }
  else {
    let t1 = (b.minZ - oz) / dz;
    let t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (dy === 0) { if (oy < 0 || oy > b.top) return Infinity; }
  else {
    let t1 = (0 - oy) / dy;
    let t2 = (b.top - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest box hit along a ray, in direction units; -1 when nothing is hit within maxT.
export function rayWorld(boxes, ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  let found = -1;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]);
    if (t < best) { best = t; found = t; }
  }
  return found;
}

// Ray against a sphere; returns the entry distance or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  return t >= 0 ? t : Infinity;
}

// Is the straight segment a→b clear of boxes (and of any smoke sphere in `smokes`)?
// Used for sight lines: an actor sees a target only when this comes back true.
export function segmentClear(boxes, smokes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ax, ay, az, dx, dy, dz, boxes[i]);
    if (t > 0.001 && t < 0.999) return false;
  }
  if (smokes) {
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      if (!s.active) continue;
      // The segment is blocked when it passes through the smoke's sphere.
      const t = raySphere(ax, ay, az, dx, dy, dz, s.x, s.y, s.z, s.r);
      if (t > 0.02 && t < 0.98) return false;
    }
  }
  return true;
}
