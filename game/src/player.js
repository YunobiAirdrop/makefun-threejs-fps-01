// The player's body: Counter-Strike-flavoured movement — ground acceleration and friction so
// you slide to a stop, a whisper-quiet walk, a crouch that steadies aim, and a jump that
// throws it off. The camera reads eye height and recoil from here; rounds.js owns the rest of
// the player's state (health, money, weapons).
import { groundHeightAt, moveCircle } from './physics.js';

export const RUN_SPEED = 5.3;
const WALK_SPEED = 2.6;
const CROUCH_SPEED = 2.8;
const GRAVITY = 17;
const JUMP_VEL = 5.7;

export function createPlayer(actor, colliders, onStep) {
  const vel = { x: 0, z: 0 };
  let velY = 0;
  let grounded = true;
  let eye = 1.62;
  let recoilPitch = 0;
  let recoilYaw = 0;
  let stepAcc = 0;

  function look(dx, dy, sensitivity) {
    actor.yaw -= dx * sensitivity;
    actor.pitch -= dy * sensitivity;
    const limit = 1.45;
    actor.pitch = Math.max(-limit, Math.min(limit, actor.pitch));
  }

  function addRecoil(pitch, yaw) {
    recoilPitch += pitch;
    recoilYaw += yaw;
  }

  function step(dt, input, frozen) {
    const keys = input.keys;
    const crouched = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    actor.crouched = crouched && grounded;
    const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    actor.walking = walking;
    const maxSpeed = crouched ? CROUCH_SPEED : walking ? WALK_SPEED : RUN_SPEED;

    // Wish direction from the keys, in world space.
    let wx = 0;
    let wz = 0;
    const sin = Math.sin(actor.yaw);
    const cos = Math.cos(actor.yaw);
    if (keys.has('KeyW')) { wx -= sin; wz -= cos; }
    if (keys.has('KeyS')) { wx += sin; wz += cos; }
    if (keys.has('KeyA')) { wx -= cos; wz += sin; }
    if (keys.has('KeyD')) { wx += cos; wz -= sin; }
    const wishLen = Math.hypot(wx, wz);
    if (wishLen > 0) { wx /= wishLen; wz /= wishLen; }

    if (grounded) {
      // Friction first, then accelerate up to the cap: the slide-stop this movement is known for.
      const speed = Math.hypot(vel.x, vel.z);
      if (speed > 0) {
        const drop = speed * Math.min(1, 9 * dt);
        const scale = Math.max(0, speed - drop) / speed;
        vel.x *= scale;
        vel.z *= scale;
      }
      const accel = 11;
      const cur = vel.x * wx + vel.z * wz;
      const add = Math.min(maxSpeed - cur, accel * maxSpeed * dt);
      if (add > 0) { vel.x += wx * add; vel.z += wz * add; }
      if (!frozen && keys.has('Space')) {
        velY = JUMP_VEL;
        grounded = false;
      }
    } else {
      // A whisper of air control, never enough to steer a jump.
      const accel = 1.6;
      const cur = vel.x * wx + vel.z * wz;
      const add = Math.min(maxSpeed - cur, accel * dt * 10);
      if (add > 0 && wishLen > 0) { vel.x += wx * add * 0.1; vel.z += wz * add * 0.1; }
    }

    if (frozen) { vel.x = 0; vel.z = 0; }

    const pos = { x: actor.x, z: actor.z };
    moveCircle(colliders, pos, vel.x * dt, vel.z * dt, actor.feetY);
    actor.x = pos.x;
    actor.z = pos.z;

    // Vertical: gravity, landing, and stepping up or down to the ground underfoot.
    const ground = groundHeightAt(colliders, actor.x, actor.z);
    if (!grounded) {
      velY -= GRAVITY * dt;
      actor.feetY += velY * dt;
      if (actor.feetY <= ground) {
        actor.feetY = ground;
        velY = 0;
        grounded = true;
      }
    } else if (ground > actor.feetY) {
      actor.feetY = ground; // stepped up onto a crate
    } else if (ground < actor.feetY - 0.4) {
      grounded = false; // walked off a ledge
      velY = 0;
    } else {
      actor.feetY = ground;
    }

    // Eye height eases between standing and crouched.
    const targetEye = actor.crouched ? 1.12 : 1.62;
    eye += (targetEye - eye) * Math.min(1, dt * 11);

    // Recoil recovers toward zero; the camera adds it to the player's own pitch.
    recoilPitch = Math.max(0, recoilPitch - dt * 0.09);
    recoilYaw *= Math.max(0, 1 - dt * 9);

    // Footsteps: quieter and slower when walking or crouched — the bots listen for these.
    const speedNow = Math.hypot(vel.x, vel.z);
    if (grounded && speedNow > 0.6) {
      stepAcc += speedNow * dt;
      const stride = walking || crouched ? 3.4 : 2.6;
      if (stepAcc > stride) {
        stepAcc = 0;
        onStep(walking || crouched ? 6 : 15, speedNow > 4);
      }
    }
    actor.speedRatio = Math.min(1, speedNow / RUN_SPEED);
    actor.grounded = grounded;
    actor.eyeHeight = eye;
  }

  return {
    look,
    addRecoil,
    step,
    eyePos(out) {
      out.set(actor.x, actor.feetY + eye, actor.z);
      return out;
    },
    camPitch() { return actor.pitch + recoilPitch; },
    camYaw() { return actor.yaw + recoilYaw; },
    reset() {
      vel.x = 0; vel.z = 0; velY = 0;
      grounded = true;
      recoilPitch = 0; recoilYaw = 0;
    },
  };
}
