# makefun-threejs-fps-01

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/YunobiAirdrop/makefun-threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/YunobiAirdrop/makefun-threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

**EMBERLINE** — a round-based tactical FPS in three.js, built from scratch for this bounty. You lead the Jackals in a 5v5: plant the charge at site A "Depot" or site B "Cistern", or eliminate the Sentries holding them — they will defuse if you let them. Rounds run buy → live → planted → end; first to 7 takes the yard.

What's inside:

- **Real gunplay.** Five weapons (P9 sidearm, Raptor SMG, Mule shotgun, Kestrel rifle, Longbow sniper with a scoped zoom), head/chest/leg hitboxes with a 4× head bonus, distance falloff, armor that blunts body shots, and a spread model that punishes running and jumping while rewarding the stop-and-crouch — the crosshair breathes with your true accuracy.
- **A full economy.** $800 start, kill and objective rewards, loss-streak bonuses, and a buy menu (B) with rifles, armor and three grenades: frag, flash (blinds by line of sight and facing) and smoke (blocks sight for bots and players alike).
- **Bots that play the round.** Teammates push the called site, pick up the dropped charge and plant it; defenders hold posts at A, B and mid, investigate gunfire, rotate to retake, and defuse. They perceive through view cones, sight lines and sound — smoke and silence both work on them.
- **An original map.** Emberline Yard: two bomb sites, a mid street, link and cross connectors and a north yard, built for lanes, corners and crossfires — no commercial map, art or names anywhere.
- **Craft.** Fixed-step simulation split from rendering, one-job modules (`rounds.js` owns all match state), pooled effects, zero per-frame allocation in the hot loops, synthesized WebAudio sound (no audio files), and a fully offline static game — vendored three.js, no build step, no network.

## Run it

```sh
node serve.ts
# then open http://localhost:8080 in desktop Chrome — click "Click to play"
# WASD move · mouse look · B buy · E plant/defuse · R reload · 1–5 weapons · Tab scores
```

`main.ts` is the bounty entrypoint: it copies `game/` and `screenshots/` to the output directory and writes `dossier.json` using the kit's own library.

---

<sub>Entered on [make.fun](https://make.fun/?ref=zqdg0kc1&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
