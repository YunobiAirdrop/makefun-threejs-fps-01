// Keyboard and mouse state, plus pointer lock. The simulation reads `keys` (a Set of codes),
// consumes look deltas with takeLook(), and reads the edge-triggered `pressed` set once a step.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Tab') event.preventDefault();
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; aiming = false; });

  canvas.addEventListener('mousedown', (event) => {
    if (!locked) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) { firing = false; aiming = false; }
    onLockChange(locked);
  });

  return {
    keys,
    get locked() { return locked; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    requestLock() {
      try {
        const pending = canvas.requestPointerLock();
        if (pending && pending.catch) pending.catch(() => {});
      } catch { /* pointer lock is unavailable in some frames/headless contexts */ }
    },
    takeLook() {
      const taken = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return taken;
    },
    wasPressed(code) { return pressed.has(code); },
    endStep() { pressed.clear(); },
  };
}
