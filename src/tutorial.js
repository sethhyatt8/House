// Tutorial (tutorial pass): five short stations on the cave beach by the canoe, one skill each. A station ends when
// you actually do the move (hold left X 1 s to skip it). Prompts sit on one floating canvas panel (1 draw call, a
// 768x448 canvas with a little controller diagram); a success chime reuses ui_confirm. Attacks, cutscenes and
// teleport are off while it runs (main.js). ?tutorial=<1-5> jumps straight to a station (no menu).
// Bindings are the game's own (walk.js / main.js / golfgrip.js / canoe.js / swim.js):
//   1 walk: left stick (MOVE_SPEED m/s, head-relative)
//   2 turn: right stick left/right (snap SNAP_DEG, or smooth with ?turn=smooth), then hold a stick click (button 3)
//     and turn your head: the world turns with you (main.js pollGazeLock)
//   3 two hands: grip (squeeze) at the handle picks the hockey stick up, the other grip lower on the shaft adds the hand
//   4 row: walk into the canoe, grip both oar handles, push the handles forward with the blades in the water
//   5 swim: walk off the shallows into deep water, pull both hands back through the water (arm strokes), swim back
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const raw = params.get('tutorial');
export const TUTORIAL_JUMP = raw != null && /^[1-5]$/.test(raw) ? Number(raw) : null;
const W = 768;
const H = 448;

export function createTutorial({ scene, sfx, api, snapDeg = 30, turnMode = 'snap' }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.42), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, depthWrite: false }));
  panel.visible = false;
  panel.renderOrder = 10;
  scene.add(panel);

  const turnText = turnMode === 'smooth' ? 'Push the RIGHT stick left or right to turn.' : `Flick the RIGHT stick left or right: you snap-turn ${snapDeg}\u00b0.`;
  // each step: title, text, the diagram highlight [hand, button], and done(ctx) -> true when the move was made
  const STATIONS = [
    { n: 1, name: 'Walk', steps: [
      { text: 'Push the LEFT stick forward to walk. Walk 1.5 m.', hi: ['L', 'stick'], begin: (c) => { c.from = api.head(); }, done: (c) => dist(api.head(), c.from) > 1.5 },
    ] },
    { n: 2, name: 'Turn', steps: [
      { text: turnText, hi: ['R', 'stick'], begin: (c) => { c.yaw0 = api.yaw(); }, done: (c) => Math.abs(angle(api.yaw() - c.yaw0)) > THREE.MathUtils.degToRad(Math.min(25, snapDeg * 0.8)) },
      { text: 'Turn without turning round: click and HOLD a stick, then turn your head. Turn 45\u00b0.', hi: ['R', 'click'], begin: (c) => { c.acc = 0; c.last = api.yaw(); }, done: (c) => { const y = api.yaw(); if (api.gazeLock()) c.acc += Math.abs(angle(y - c.last)); c.last = y; return c.acc > THREE.MathUtils.degToRad(45); } },
    ] },
    { n: 3, name: 'Two hands', steps: [
      { text: 'A hockey stick is on the sand in front of you. Reach to its handle and squeeze GRIP to pick it up.', hi: ['R', 'grip'], begin: () => api.offerStick(), done: () => api.stick().carried },
      { text: 'Now put your other hand lower on the shaft and squeeze its GRIP: two-handed hold.', hi: ['L', 'grip'], done: () => api.stick().twoHands },
    ] },
    { n: 4, name: 'Row', steps: [
      { text: 'Walk into the canoe (left stick) to sit in it.', hi: ['L', 'stick'], done: () => api.aboard() },
      { text: 'Reach to the end of each oar handle and squeeze both GRIPs.', hi: ['B', 'grip'], done: () => api.oars() >= 2 },
      { text: 'Row: push both handles forward with the blades in the water, lift them back. Move the boat a little way.', hi: ['B', 'grip'], begin: (c) => { c.boat = api.boat().clone(); }, done: (c) => dist(api.boat(), c.boat) > 0.7 },
    ] },
    { n: 5, name: 'Swim', steps: [
      { text: 'Leave the boat (push the left stick to the beach), then walk out past the shallows into deep water.', hi: ['L', 'stick'], done: () => api.swim().active },
      { text: 'Pull both hands back through the water, like a breaststroke. Two strokes.', hi: ['B', 'grip'], begin: (c) => { c.s0 = api.swim().strokes; }, done: (c) => api.swim().strokes - c.s0 >= 2 },
      { text: 'Swim back to the beach (left stick or strokes) until you stand up.', hi: ['L', 'stick'], done: () => !api.swim().active && api.onFeet() },
    ] },
  ];

  const st = { wait: 0, active: false, station: 0, step: 0, ctx: {}, log: [], skipT0: 0, doneT: -1, flash: 0 };

  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function angle(d) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  function cur() { return STATIONS[st.station]?.steps[st.step] ?? null; }
  // a step's starting point is taken a few frames in: a spawn move (or the previous step's last motion) lands first
  function enter() {
    st.ctx = {};
    st.wait = 6;
    draw();
  }
  function start(n = 1) {
    st.active = true;
    st.station = Math.max(0, Math.min(STATIONS.length - 1, n - 1));
    st.step = 0;
    st.doneT = -1;
    st.log.push(['start', n]);
    panel.visible = true;
    place(true);
    enter();
  }
  function advance(how) {
    const s = STATIONS[st.station];
    st.log.push([how, s.n, st.step]);
    if (how === 'done') { sfx?.play?.('ui_confirm', { gain: 0.6 }); st.flash = 0.6; }
    if (how === 'skip' || st.step + 1 >= s.steps.length) { st.station += 1; st.step = 0; } else st.step += 1;
    if (st.station >= STATIONS.length) { finish(); return; }
    enter();
  }
  function finish() {
    st.active = false;
    st.doneT = 0;
    st.log.push(['finished']);
    api.finished?.();
    draw();
  }
  function stop() { st.active = false; st.doneT = -1; panel.visible = false; }

  const tmp = new THREE.Vector3();
  // the panel floats 1.1 m ahead, a little below eye height, and catches up when you look > 35 deg away from it
  function place(now) {
    const h = api.head();
    const yaw = api.headYaw();
    const want = Math.atan2(panel.position.x - h.x, panel.position.z - h.z);
    const facing = yaw + Math.PI; // yaw 0 = looking -Z
    if (!now && Math.abs(angle(want - facing)) < 0.6 && dist(panel.position, h) < 2.2 && Math.abs(panel.position.y - (h.y - 0.2)) < 0.6) return;
    tmp.set(h.x - Math.sin(yaw) * 1.1, h.y - 0.2, h.z - Math.cos(yaw) * 1.1);
    if (now) panel.position.copy(tmp); else panel.position.lerp(tmp, 0.08);
    panel.lookAt(h.x, h.y - 0.2, h.z);
  }

  function update(dt) {
    if (st.doneT >= 0) {
      st.doneT += dt;
      place(false);
      if (st.doneT > 10) { panel.visible = false; st.doneT = -1; }
      return;
    }
    if (!st.active) return;
    place(false);
    if (st.flash > 0) { st.flash -= dt; if (st.flash <= 0) draw(); }
    // skip: hold left X (button 4) 1 s; teleport (the other X/A use) is off during the tutorial
    if (api.skipHeld()) {
      if (!st.skipT0) st.skipT0 = performance.now();
      else if (performance.now() - st.skipT0 > 1000) { st.skipT0 = 0; advance('skip'); return; }
    } else st.skipT0 = 0;
    const step = cur();
    if (!step) return;
    if (st.wait > 0) { st.wait -= 1; if (st.wait === 0) step.begin?.(st.ctx); return; }
    if (step.done(st.ctx)) advance('done');
  }

  // --- drawing --------------------------------------------------------------------------------------------------
  function controller(x, y, side, hi) {
    const on = (part) => hi && (hi[0] === side || hi[0] === 'B') && hi[1] === part;
    g.lineWidth = 3;
    g.strokeStyle = '#d8dde3';
    g.fillStyle = '#2a3038';
    g.beginPath(); g.ellipse(x, y, 46, 58, 0, 0, Math.PI * 2); g.fill(); g.stroke(); // ring + body (top view)
    g.fillStyle = on('stick') || on('click') ? '#3ef0c4' : '#56606b';
    g.beginPath(); g.arc(x + (side === 'L' ? 10 : -10), y - 8, 15, 0, Math.PI * 2); g.fill();
    if (on('click')) { g.fillStyle = '#0d2a22'; g.beginPath(); g.arc(x + (side === 'L' ? 10 : -10), y - 8, 6, 0, Math.PI * 2); g.fill(); }
    const b = side === 'L' ? ['Y', 'X'] : ['B', 'A'];
    b.forEach((name, i) => {
      g.fillStyle = (side === 'L' && name === 'X' && hi?.[1] === 'skip') ? '#3ef0c4' : '#56606b';
      g.beginPath(); g.arc(x + (side === 'L' ? -16 : 16) + (i ? 10 : -4), y + 20 + i * 18, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8edf2'; g.font = '600 11px system-ui, sans-serif'; g.fillText(name, x + (side === 'L' ? -16 : 16) + (i ? 10 : -4), y + 21 + i * 18);
    });
    g.fillStyle = on('grip') ? '#3ef0c4' : '#56606b'; // grip on the inner side
    g.fillRect(side === 'L' ? x + 40 : x - 52, y + 6, 12, 40);
    g.fillStyle = '#e8edf2'; g.font = '600 18px system-ui, sans-serif'; g.fillText(side === 'L' ? 'LEFT' : 'RIGHT', x, y + 80);
  }
  function wrap(text, x, y, maxW, lh) {
    const words = text.split(' '); let line = ''; let yy = y;
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += lh; } else line = t; }
    if (line) g.fillText(line, x, yy);
  }
  function draw() {
    g.clearRect(0, 0, W, H);
    g.fillStyle = st.flash > 0 ? 'rgba(20, 92, 56, 0.9)' : 'rgba(18, 22, 28, 0.86)';
    g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 26); g.fill();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    if (st.doneT >= 0) {
      g.fillStyle = '#3ef0c4'; g.font = '700 40px system-ui, sans-serif'; g.fillText('Tutorial done!', 40, 70);
      g.fillStyle = '#f2f4f6'; g.font = '28px system-ui, sans-serif';
      wrap('Keep playing from here, or hold the LEFT Y button for 1.5 s to go back to the menu.', 40, 150, W - 80, 40);
    } else {
      const s = STATIONS[st.station]; const step = cur();
      g.fillStyle = '#3ef0c4'; g.font = '700 30px system-ui, sans-serif'; g.fillText(`${s.n}/5  ${s.name}`, 36, 50);
      g.fillStyle = '#9aa4ae'; g.font = '20px system-ui, sans-serif'; g.textAlign = 'right';
      g.fillText(`step ${st.step + 1}/${s.steps.length}`, W - 36, 50); g.textAlign = 'left';
      g.fillStyle = '#f2f4f6'; g.font = '26px system-ui, sans-serif';
      wrap(step.text, 36, 108, 430, 36);
      g.textAlign = 'center';
      controller(540, 170, 'L', step.hi); controller(668, 170, 'R', step.hi);
      g.textAlign = 'left'; g.fillStyle = '#9aa4ae'; g.font = '20px system-ui, sans-serif';
      g.fillText('Hold LEFT X (1 s) to skip this step.   Hold LEFT Y (1.5 s) for the menu.', 36, H - 36);
    }
    tex.needsUpdate = true;
  }

  return {
    panel, start, stop, update, finish,
    get active() { return st.active; },
    state: () => ({ active: st.active, station: STATIONS[st.station]?.n ?? null, step: st.step, log: st.log.slice(-30), done: st.doneT >= 0 }),
    skip: () => st.active && advance('skip'),
  };
}
