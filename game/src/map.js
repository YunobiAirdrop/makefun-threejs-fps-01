// The map: Emberline Yard, an original dusk-industrial rail yard. One data table drives all of
// it — every entry is a box (or a cylinder rendered round and collided as its bounding box):
// the same rows build the meshes, the colliders bullets and bodies test against, and the cover
// the bots hide behind. On top of the geometry sit the two plant sites, the spawn points and
// the waypoint graph the bots navigate by.
import * as THREE from 'three';
import { rayBox } from './physics.js';

export const PALETTE = {
  sand: 0xb59a6d, asphalt: 0x55565c, concrete: 0x9aa0a3, brick: 0xa15c48,
  rust: 0x8a4a38, tealMetal: 0x3f6f6a, mustard: 0xb98a2f, wood: 0x9a7a52,
  darkMetal: 0x3c4148, glass: 0x2c3844, white: 0xd8d3c8, amberGlow: 0xf2a33c,
};

// [cx, cz, w, d, h, material] — centre, size, height. Cylinders: { cyl: [cx, cz, r, h, mat] }.
const BOXES = [
  // Perimeter
  [0, -28.5, 76, 1, 3.4, 'concrete'], [0, 28.5, 76, 1, 3.4, 'concrete'],
  [-37.5, 0, 1, 58, 3.4, 'concrete'], [37.5, 0, 1, 58, 3.4, 'concrete'],
  // A site — the Depot (north-west)
  [-30, -19, 12, 10, 4.2, 'brick'],        // warehouse
  [-31, -5, 9, 5, 3.2, 'concrete'],        // annex
  [-19, -19.5, 5, 2.2, 2.6, 'rust'],       // container
  [-19, -10.5, 5, 2.2, 2.6, 'tealMetal'],  // container
  [-15, -15, 5, 7, 3.2, 'brick'],          // A east block
  [-24, -22, 6, 3, 2.4, 'darkMetal'],      // back shed
  // Mid blocks
  [-9, -1, 7, 9, 3.6, 'concrete'],         // M1
  [8, -4, 8, 10, 3.6, 'brick'],            // M2
  [-8, 12, 10, 8, 3.2, 'brick'],           // M3
  [10, 14, 9, 9, 3.4, 'concrete'],         // M4
  // CT side and B north
  [24, -21, 12, 6, 3.4, 'brick'],          // CT building
  [33, -8, 7, 12, 3.8, 'concrete'],        // B back building
  // B site — the Cistern (east)
  [18, 6, 6, 8, 2.2, 'tealMetal'],         // cistern tank
  [24, 19, 5.5, 2.2, 2.6, 'mustard'],      // container
  [33, 16, 6, 8, 3.4, 'brick'],            // B south-east building
  // T side
  [-33, 11, 6, 11, 3.2, 'brick'],          // T building
  [-33, -1, 6, 9, 3.2, 'concrete'],        // A lane west building
  [-24, 6, 1, 10, 1.1, 'concrete'],        // low wall, A lane cover
  [-16, 15.5, 12, 1, 1.1, 'concrete'],     // low wall, B lane cover
  // Crates (0.9 high: jumpable, steppable cover)
  [-22, -13, 1.8, 1.8, 0.9, 'wood'], [-20.2, -13, 1.8, 1.8, 0.9, 'wood'], [-16, -19, 1.6, 1.6, 0.9, 'wood'],
  [22, 12, 1.8, 1.8, 0.9, 'wood'], [21, -3, 1.8, 1.8, 0.9, 'wood'], [15, -6, 1.6, 1.6, 0.9, 'wood'],
  [1, -2, 1.8, 1.8, 0.9, 'wood'], [-1, 6, 1.8, 1.8, 0.9, 'wood'],
  [0, -14, 1.8, 1.8, 0.9, 'wood'], [7, -16, 1.6, 1.6, 0.9, 'wood'], [-7, -15, 1.6, 1.6, 0.9, 'wood'],
  [13, 5, 1.6, 1.6, 0.9, 'wood'], [8, 22, 1.8, 1.8, 0.9, 'wood'], [20, -13, 1.8, 1.8, 0.9, 'wood'],
  [-27, 14, 1.6, 1.6, 0.9, 'wood'], [-25, 22, 1.8, 1.8, 0.9, 'wood'], [-23.5, 22, 1.8, 1.8, 0.9, 'wood'],
];
const CYLS = [
  [28, -2, 2.6, 7, 'rust'], [28, 12, 2.6, 7, 'mustard'],           // the two cistern silos
  [-18, -21, 0.45, 1.05, 'tealMetal'], [26, 2, 0.45, 1.05, 'rust'], // barrels
  [-4, -10, 0.45, 1.05, 'mustard'], [18, 16, 0.45, 1.05, 'tealMetal'],
];
// Flat painted pads (visual only, 2 cm proud of the ground): streets and site aprons.
const PADS = [
  [-22, -15, 21, 17], [24, 6, 21, 19], [0, 0, 9, 52], [-27, 19, 17, 13], [24, -14, 17, 11],
  [-26, 3, 9, 33], [14, 21, 32, 8], [0, -15, 30, 9], [10, 5, 12, 3],
];

export const SITES = {
  A: { id: 'A', name: 'Depot', x: -22, z: -15, r: 5.5 },
  B: { id: 'B', name: 'Cistern', x: 24, z: 6, r: 5.5 },
};
export const SPAWNS = {
  jackal: [[-29, 19], [-31, 21], [-27, 21], [-29, 16.5], [-25.5, 18]],
  sentry: [[24, -15], [21, -16], [27, -16], [22, -12.5], [26, -12.5]],
};

// Waypoint graph: nodes the bots walk between; edges are walked straight, so every edge below
// was checked against the box table to run through open ground.
const NODES = {
  tspawn: [-29, 19], a_lane1: [-28, 10], a_lane2: [-27, 0], a_junc: [-20, -5],
  a_entry: [-22, -10], a_site: [-22, -15], a_north: [-20, -20], a_link: [-9, -8],
  mid_s: [0, 20], mid_m: [0, 7], mid_c: [0, -3], mid_n: [0, -11], north_yard: [-2, -16],
  ct_front: [14, -13], ct_spawn: [24, -15], ct_b: [26, -11], b_north: [24, -7],
  cross1: [10, 4], cross_n: [16, -1], cross_s: [16, 12], b_chan: [23, 2], b_sw: [22, 11],
  b_site: [24, 6], b_south: [23, 16], b_lane2: [20, 21], b_lane1: [10, 21],
};
const EDGES = [
  ['tspawn', 'a_lane1'], ['tspawn', 'b_lane1'], ['a_lane1', 'a_lane2'], ['a_lane2', 'a_junc'],
  ['a_junc', 'a_entry'], ['a_entry', 'a_site'], ['a_site', 'a_north'], ['a_entry', 'a_link'],
  ['a_link', 'mid_c'], ['a_north', 'north_yard'], ['mid_s', 'mid_m'], ['mid_m', 'mid_c'],
  ['mid_c', 'mid_n'], ['mid_n', 'north_yard'], ['north_yard', 'ct_front'], ['ct_front', 'ct_spawn'],
  ['ct_spawn', 'ct_b'], ['ct_b', 'b_north'], ['b_north', 'b_site'], ['mid_m', 'cross1'],
  ['cross1', 'cross_n'], ['cross_n', 'b_chan'], ['b_chan', 'b_site'], ['cross1', 'cross_s'],
  ['cross_s', 'b_sw'], ['b_sw', 'b_site'], ['b_lane1', 'b_lane2'], ['b_lane2', 'b_south'],
  ['b_south', 'b_site'], ['b_south', 'b_sw'], ['mid_s', 'b_lane1'], ['ct_front', 'b_north'],
  ['ct_front', 'cross_n'],
];
// Defender posts: node, and the point the post watches.
export const HOLDS = {
  A: [['a_north', -22, -9], ['a_entry', -24, -4], ['a_site', -14, -12]],
  B: [['b_north', 24, 4], ['b_sw', 16, 6], ['b_site', 24, 16]],
  MID: [['mid_n', 0, 4], ['cross_n', 8, 2]],
};

function buildGraph() {
  const graph = new Map();
  for (const id of Object.keys(NODES)) graph.set(id, []);
  for (const [a, b] of EDGES) { graph.get(a).push(b); graph.get(b).push(a); }
  return graph;
}
const GRAPH = buildGraph();

// Breadth-first shortest path over the waypoint graph; returns node ids including both ends.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of GRAPH.get(cur)) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path = [to];
        let walk = cur;
        while (walk !== null) { path.unshift(walk); walk = prev.get(walk); }
        return path;
      }
      queue.push(next);
    }
  }
  return [from];
}
export function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const id of Object.keys(NODES)) {
    const [nx, nz] = NODES[id];
    const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}
export function nodePos(id) { return NODES[id]; }

export function createWorld(scene) {
  const colliders = [];
  const materials = new Map();
  const mat = (key) => {
    if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial({ color: PALETTE[key] }));
    return materials.get(key);
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  function addBox(cx, cz, w, d, h, key, collide = true) {
    const mesh = new THREE.Mesh(boxGeo, mat(key));
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = h > 1.2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: h });
    return mesh;
  }

  // Ground and painted pads.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 72), mat('sand'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  for (const [cx, cz, w, d] of PADS) {
    const pad = new THREE.Mesh(boxGeo, mat('asphalt'));
    pad.scale.set(w, 0.04, d);
    pad.position.set(cx, 0.02, cz);
    pad.receiveShadow = true;
    scene.add(pad);
  }

  for (const [cx, cz, w, d, h, key] of BOXES) {
    addBox(cx, cz, w, d, h, key);
    if (h >= 3) { // a parapet lip gives tall blocks a silhouette against the sky
      const lip = new THREE.Mesh(boxGeo, mat('darkMetal'));
      lip.scale.set(w + 0.35, 0.22, d + 0.35);
      lip.position.set(cx, h + 0.11, cz);
      lip.castShadow = true;
      scene.add(lip);
    }
    if (h >= 3.2 && w >= 6) { // a band of dark windows on the street face
      const win = new THREE.Mesh(boxGeo, mat('glass'));
      win.scale.set(w * 0.7, 0.8, 0.06);
      win.position.set(cx, h * 0.62, cz + d / 2 + 0.03);
      scene.add(win);
    }
  }
  for (const [cx, cz, r, h, key] of CYLS) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat(key));
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = h > 1.2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({ minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r, top: h });
    if (h > 4) { // silo cap
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, 0.8, 10), mat('darkMetal'));
      cap.position.set(cx, h + 0.4, cz);
      scene.add(cap);
    }
  }

  // Site markers: an amber ring and four corner posts per site, so a site reads at a glance.
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.amberGlow });
  for (const site of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.35, site.r, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.06, site.z);
    scene.add(ring);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(boxGeo, mat('darkMetal'));
      post.scale.set(0.18, 1.5, 0.18);
      post.position.set(site.x + px * (site.r - 0.4), 0.75, site.z + pz * (site.r - 0.4));
      scene.add(post);
      const tip = new THREE.Mesh(boxGeo, ringMat);
      tip.scale.set(0.26, 0.18, 0.26);
      tip.position.set(post.position.x, 1.55, post.position.z);
      scene.add(tip);
    }
  }

  // Dusk light: a low warm sun with shadows, a cool sky fill, and distance fog.
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.6);
  sun.position.set(-38, 44, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbdd3e2, 0x8a6f4d, 0.85));
  scene.background = new THREE.Color(0x93a9ba);
  scene.fog = new THREE.Fog(0x93a9ba, 55, 130);

  return { colliders, rayBox };
}
