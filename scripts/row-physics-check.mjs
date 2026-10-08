// node scripts/row-physics-check.mjs   [row=old]
// Starboard-only power strokes yaw the bow to port (positive yaw).
// Port-only strokes yaw the other way. Both together go nearly straight.
// Coast (swim/boat/reef pass): from 1.5 m/s the hull glides 8-14 s before it drops under 0.1 m/s (row=old: the
// previous drag, stopped under 0.05 m/s within 8 s).
const ctx2d = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? () => {} : undefined) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.location = { search: '?' + process.argv.slice(2).join('&') };
const OLD = process.argv.includes('row=old');
globalThis.window = { innerWidth: 800, innerHeight: 600, addEventListener() {} };
const { createBoatSim, stepBoat } = await import('../src/canoe.js');

function row(side, seconds) {
  const sim = createBoatSim(true);
  const start = sim.yaw;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const phase = (t * (25 / 60)) % 1;
    const drive = phase < 0.45 ? { k: 0.8, along: 1.4 } : null;
    stepBoat(sim, dt, {
      starboard: side === 'starboard' || side === 'both' ? drive : null,
      port: side === 'port' || side === 'both' ? drive : null,
    });
  }
  const bowX = -Math.sin(sim.yaw);
  const bowZ = -Math.cos(sim.yaw);
  const forward = sim.vx * bowX + sim.vz * bowZ;
  return { yawRate: sim.yawRate, turn: sim.yaw - start, forward };
}

function coast() {
  const sim = createBoatSim(true);
  sim.vx = -1.5;
  const dt = 1 / 60;
  let t = 0;
  for (; t < 30; t += dt) {
    stepBoat(sim, dt, {});
    if (Math.hypot(sim.vx, sim.vz) < (OLD ? 0.05 : 0.1)) return t;
  }
  return t;
}

const starboard = row('starboard', 5);
const port = row('port', 5);
const both = row('both', 8);
const stopped = coast();
const speedOk = OLD ? both.forward >= 1.2 && both.forward <= 1.8 : both.forward >= 1.4 && both.forward <= 2.6;
const coastOk = OLD ? stopped <= 8 : stopped >= 8 && stopped <= 14;
const straight = Math.abs(both.turn) < 3 * Math.PI / 180;
console.log(JSON.stringify({ starboard, port, both, stopped, speedOk, coastOk, straight }, null, 2));
if (!(starboard.yawRate > 0 && port.yawRate < 0 && speedOk && straight && coastOk)) process.exit(1);
