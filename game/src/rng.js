// Seeded randomness (mulberry32). One stream drives the whole simulation, so a match with the
// same seed plays out the same way — that is what makes the screenshot poses reproducible.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A tiny helper bundle over one random stream: ranges, picks and shuffles without allocating
// closures per call site.
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
    pick(list) { return list[Math.floor(next() * list.length) % list.length]; },
    chance(p) { return next() < p; },
  };
}
