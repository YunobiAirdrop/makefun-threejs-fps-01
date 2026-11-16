// Every sound is synthesised with WebAudio — noise bursts, filtered clicks and short oscillator
// notes — so the game ships no audio files and makes no requests. The context is created lazily
// on the first user gesture; until then every call is a no-op. Distant shots are low-passed and
// quieted by distance, which is also how the bots' world sounds to the player.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = ctx.sampleRate * 1;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(when, dur, { freq = 1800, q = 0.8, gain = 0.5, type = 'bandpass', slideTo = 0 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, when);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(when, Math.random() * 0.4);
    src.stop(when + dur + 0.02);
  }

  function tone(when, dur, { freq = 440, end = 0, gain = 0.2, type = 'sine' } = {}) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(g).connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  // A gunshot: a crack of noise plus a low thump. `dist` metres to the listener: past ~12 m the
  // crack is filtered away and only the thump carries, quieter.
  function shot(kind, dist = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const near = Math.max(0, 1 - dist / 60);
    const vol = 0.12 + near * 0.5;
    if (kind === 'sniper') {
      noise(t, 0.32, { freq: 900 + near * 1600, gain: vol, slideTo: 300 });
      tone(t, 0.22, { freq: 120, end: 45, gain: vol * 0.9, type: 'triangle' });
    } else if (kind === 'shotgun') {
      noise(t, 0.26, { freq: 700 + near * 900, gain: vol, slideTo: 240 });
      tone(t, 0.18, { freq: 100, end: 40, gain: vol * 0.9, type: 'triangle' });
    } else if (kind === 'smg') {
      noise(t, 0.09, { freq: 1500 + near * 1800, gain: vol * 0.7, slideTo: 700 });
    } else if (kind === 'pistol') {
      noise(t, 0.12, { freq: 1300 + near * 1500, gain: vol * 0.85, slideTo: 500 });
      tone(t, 0.08, { freq: 150, end: 60, gain: vol * 0.5, type: 'triangle' });
    } else { // rifle
      noise(t, 0.16, { freq: 1100 + near * 1500, gain: vol, slideTo: 420 });
      tone(t, 0.12, { freq: 130, end: 50, gain: vol * 0.7, type: 'triangle' });
    }
  }

  return {
    unlock() { ensure(); },
    shot,
    dry() { if (ensure()) noise(ctx.currentTime, 0.04, { freq: 2600, gain: 0.12 }); },
    reload() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t + 0.05, 0.05, { freq: 900, gain: 0.2 });
      noise(t + 0.35, 0.05, { freq: 1400, gain: 0.22 });
      noise(t + 0.62, 0.06, { freq: 700, gain: 0.26 });
    },
    draw() { if (ensure()) noise(ctx.currentTime, 0.07, { freq: 2000, gain: 0.1, slideTo: 900 }); },
    hit(head) {
      if (!ensure()) return;
      tone(ctx.currentTime, 0.07, { freq: head ? 2100 : 1500, gain: 0.16, type: 'square' });
    },
    kill() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 0.09, { freq: 1250, gain: 0.16, type: 'square' });
      tone(t + 0.08, 0.12, { freq: 1750, gain: 0.16, type: 'square' });
    },
    hurt() { if (ensure()) tone(ctx.currentTime, 0.14, { freq: 190, end: 90, gain: 0.3, type: 'triangle' }); },
    step(run) { if (ensure()) noise(ctx.currentTime, 0.05, { freq: run ? 500 : 380, gain: run ? 0.1 : 0.05, type: 'lowpass' }); },
    throwIt() { if (ensure()) noise(ctx.currentTime, 0.12, { freq: 800, gain: 0.08, slideTo: 1600 }); },
    explosion(dist = 0) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const vol = Math.max(0.15, 1 - dist / 70);
      noise(t, 0.7, { freq: 500, gain: 0.8 * vol, type: 'lowpass', slideTo: 60 });
      tone(t, 0.6, { freq: 90, end: 30, gain: 0.7 * vol, type: 'sine' });
    },
    flashbang() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.1, { freq: 3000, gain: 0.3 });
      tone(t, 1.4, { freq: 3400, gain: 0.06, type: 'sine' });
    },
    beep(final) {
      if (!ensure()) return;
      tone(ctx.currentTime, final ? 0.4 : 0.07, { freq: final ? 1560 : 1180, gain: 0.14, type: 'square' });
    },
    uiClick() { if (ensure()) tone(ctx.currentTime, 0.05, { freq: 880, gain: 0.1, type: 'square' }); },
    buyOk() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 0.07, { freq: 990, gain: 0.12, type: 'square' });
      tone(t + 0.07, 0.1, { freq: 1320, gain: 0.12, type: 'square' });
    },
    denied() { if (ensure()) tone(ctx.currentTime, 0.12, { freq: 220, gain: 0.14, type: 'square' }); },
    stinger(win) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const notes = win ? [392, 523, 659] : [330, 262, 196];
      notes.forEach((f, i) => tone(t + i * 0.13, 0.34, { freq: f, gain: 0.14, type: 'triangle' }));
    },
  };
}
