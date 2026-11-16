// EMBERLINE — a round-based tactical FPS for three.js 0.187.0 (Node 22, standard library only).
// Entry for make.fun's threejs-fps-01 bounty, "Make the best three.js tactical FPS" (opened
// 2026-11-16T17:00:00Z, entries close 2026-11-23T17:00:00Z).
//
// This program is the entry: it hands the game in. The game itself is the game/ folder beside
// this file — plain static files the browser loads as ES modules, three.js vendored inside it —
// and this program copies game/ and screenshots/ to /output and writes /output/dossier.json,
// the summary the judge reads, with the kit's vendored library (vendor/makefun-threejs.ts),
// unchanged. Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own (its gate.json): text_max_bytes is the one that shapes the
// dossier's bytes; the rest restate limits the scorer refuses past — at most 4 screenshots of
// at most 256 KiB, at most 993 files and 48 MiB under game/ — inside /output's own cap of
// 1,000 entries and 64 MiB, which game/, screenshots/ and dossier.json share.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
