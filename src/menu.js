// Start menu (menu pass): a plain white room with one button panel, shown when the game starts and again after a
// 1.5 s hold of the left Y button (desktop: M). Its own tiny scene: room box + panel + 2 lasers + cursor = 5 draw calls,
// one 1024x640 canvas texture, no assets. The world is loaded behind it but not rendered or simulated while it is up.
// ?menu=0 skips it (exactly the old start). Choices persist in localStorage ('house.menu.v1'); URL flags win.
import * as THREE from 'three';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const MENU = params.get('menu') !== '0' && params.get('watch') == null;
const KEY = 'house.menu.v1';
export const SPAWN_IDS = ['cliff', 'cave', 'peak', 'garden', 'hockey'];
const SPAWN_LABEL = { cliff: 'Cliff (outside room)', cave: 'Down in the cave', peak: 'Raptor peak', garden: 'Japanese garden', hockey: 'Hockey room (lift)' };
export const DEFAULT_CHOICE = { mode: 'game', spawn: 'cliff', attacks: true, teleport: true, raptor: true, croc: true };

export function loadChoice() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const c = { ...DEFAULT_CHOICE, ...raw };
      if (!SPAWN_IDS.includes(c.spawn)) c.spawn = DEFAULT_CHOICE.spawn;
      if (c.mode !== 'test' && c.mode !== 'tutorial') c.mode = 'game';
      return c;
    }
  } catch { /* private mode / bad JSON: defaults */ }
  return { ...DEFAULT_CHOICE };
}
export function saveChoice(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage off: the menu still works */ }
}

// What the game should do for a choice. URL flags win over the menu: ?teleport= fixes teleport.
export function settingsFor(c, { urlTeleport = null } = {}) {
  const test = c.mode === 'test';
  // tutorial pass: on the cave beach, no attacks, no cutscenes, no teleport (everything by walking)
  if (c.mode === 'tutorial') return { mode: 'tutorial', spawn: 'tutorial', teleport: false, raptor: false, croc: false, cutscene: false };
  return {
    mode: c.mode,
    spawn: test ? c.spawn : 'start',
    teleport: urlTeleport != null ? urlTeleport : (test ? true : !!c.teleport),
    raptor: test ? !!c.attacks : !!c.raptor,
    croc: test ? !!c.attacks : !!c.croc,
    cutscene: test ? !!c.attacks : true,
  };
}

const W = 1024;
const H = 640;
const PANEL_W = 1.6;
const PANEL_H = PANEL_W * (H / W);

export function createMenu({ renderer, urlTeleport = null, onStart }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f6f4);
  const root = new THREE.Group(); // the room + panel, moved to wherever you stand when the menu opens
  scene.add(root);
  // the room: one box, walls white, floor faces a light grey so you know where down is (vertex colours, 1 draw call)
  const roomGeo = new THREE.BoxGeometry(8, 3.4, 8);
  roomGeo.translate(0, 1.7, 0);
  const col = [];
  const pos = roomGeo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const c = y < 0.01 ? 0.8 : y > 3.39 ? 0.97 : 0.94; // grey floor, white walls and ceiling
    col.push(c, c, c);
  }
  roomGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const room = new THREE.Mesh(roomGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false }));
  root.add(room);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g2 = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  panel.position.set(0, 1.35, -1.25);
  panel.rotation.x = -0.12;
  root.add(panel);

  const lasers = [0, 1].map(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1f7a45, toneMapped: false }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    return line;
  });
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 6), new THREE.MeshBasicMaterial({ color: 0x1f7a45, toneMapped: false }));
  cursor.visible = false;
  scene.add(cursor);

  const state = { active: MENU, choice: loadChoice(), hover: null, presses: 0, last: null };
  let buttons = [];

  function layout() {
    const c = state.choice;
    const test = c.mode === 'test';
    const b = [];
    const tut = c.mode === 'tutorial';
    b.push({ id: 'mode:game', x: 60, y: 96, w: 280, h: 70, label: 'Game', on: !test && !tut, kind: 'tab' });
    b.push({ id: 'mode:tutorial', x: 372, y: 96, w: 280, h: 70, label: 'Tutorial', on: tut, kind: 'tab' });
    b.push({ id: 'mode:test', x: 684, y: 96, w: 280, h: 70, label: 'Test', on: test, kind: 'tab' });
    if (tut) {
      // no options: the body text explains it
    } else if (test) {
      SPAWN_IDS.forEach((id, i) => {
        const colN = i % 2; const row = Math.floor(i / 2);
        b.push({ id: `spawn:${id}`, x: 60 + colN * 474, y: 196 + row * 76, w: 430, h: 62, label: SPAWN_LABEL[id], on: c.spawn === id });
      });
      b.push({ id: 'toggle:attacks', x: 534, y: 348, w: 430, h: 62, label: `Attacks + cutscenes: ${c.attacks ? 'ON' : 'OFF'}`, on: c.attacks, kind: 'toggle' });
    } else {
      const tp = urlTeleport != null ? urlTeleport : c.teleport;
      b.push({ id: 'toggle:teleport', x: 60, y: 210, w: 904, h: 62, label: `Teleport: ${tp ? 'ON' : 'OFF'}${urlTeleport != null ? '  (set by URL)' : ''}`, on: tp, kind: 'toggle', locked: urlTeleport != null });
      b.push({ id: 'toggle:raptor', x: 60, y: 286, w: 904, h: 62, label: `Raptor attack: ${c.raptor ? 'ON' : 'OFF'}`, on: c.raptor, kind: 'toggle' });
      b.push({ id: 'toggle:croc', x: 60, y: 362, w: 904, h: 62, label: `Alligator attack: ${c.croc ? 'ON' : 'OFF'}`, on: c.croc, kind: 'toggle' });
    }
    b.push({ id: 'start', x: 312, y: 470, w: 400, h: 86, label: 'START', on: true, kind: 'start' });
    buttons = b;
  }

  function draw() {
    layout();
    g2.fillStyle = '#ffffff';
    g2.fillRect(0, 0, W, H);
    g2.strokeStyle = '#d4d4d0';
    g2.lineWidth = 4;
    g2.strokeRect(2, 2, W - 4, H - 4);
    g2.fillStyle = '#22262b';
    g2.font = '600 44px system-ui, sans-serif';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    g2.fillText('HOUSE', W / 2, 48);
    for (const b of buttons) {
      const hot = state.hover === b.id;
      g2.fillStyle = b.kind === 'start' ? (hot ? '#17603a' : '#1f7a45') : b.on ? (hot ? '#2d6fa8' : '#3a82c4') : (hot ? '#dfe3e8' : '#eceff2');
      g2.beginPath();
      g2.roundRect(b.x, b.y, b.w, b.h, 14);
      g2.fill();
      g2.fillStyle = b.kind === 'start' || b.on ? '#ffffff' : '#30353b';
      if (b.locked) g2.globalAlpha = 0.6;
      g2.font = `${b.kind === 'start' ? 700 : 600} ${b.kind === 'start' ? 40 : 30}px system-ui, sans-serif`;
      g2.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      g2.globalAlpha = 1;
    }
    g2.fillStyle = '#6b7178';
    g2.font = '24px system-ui, sans-serif';
    if (state.choice.mode === 'tutorial') {
      g2.fillStyle = '#30353b';
      g2.font = '28px system-ui, sans-serif';
      ['Five short stations on the cave beach by the canoe:', 'walk, turn, two-handed stick, row, swim.', 'Each one ends when you do the move. Hold left X to skip.', 'No attacks, no cutscenes, no teleport.'].forEach((t, i) => g2.fillText(t, W / 2, 220 + i * 44));
      g2.fillStyle = '#6b7178';
      g2.font = '24px system-ui, sans-serif';
    } else g2.fillText(state.choice.mode === 'test' ? 'Test: pick a start spot. Attacks off = no raptor/alligator, no fall cutscene.' : 'Game: you start in the locked room.', W / 2, 446);
    g2.fillText('Trigger / click to choose.  Back to this menu: hold left Y (desktop: M).', W / 2, 600);
    tex.needsUpdate = true;
  }

  function press(id) {
    const c = state.choice;
    state.presses += 1;
    state.last = id;
    if (!id) return;
    const [k, v] = id.split(':');
    if (k === 'mode') c.mode = v;
    else if (k === 'spawn') c.spawn = v;
    else if (k === 'toggle') { if (!(v === 'teleport' && urlTeleport != null)) c[v] = !c[v]; }
    saveChoice(c);
    if (id === 'start') {
      state.active = false;
      lasers.forEach((l) => { l.visible = false; });
      cursor.visible = false;
      onStart?.(settingsFor(c, { urlTeleport }), { ...c });
      return;
    }
    draw();
  }

  const ray = new THREE.Raycaster();
  const m4 = new THREE.Matrix4();
  // hit test: ray in world space -> button id (or null), cursor point
  function hitTest(origin, dir) {
    ray.set(origin, dir);
    const hit = ray.intersectObject(panel, false)[0];
    if (!hit?.uv) return { id: null, point: null };
    const px = hit.uv.x * W; const py = (1 - hit.uv.y) * H;
    const b = buttons.find((bb) => px >= bb.x && px <= bb.x + bb.w && py >= bb.y && py <= bb.y + bb.h);
    return { id: b?.id ?? null, point: hit.point };
  }
  function setHover(id) {
    if (id !== state.hover) { state.hover = id; draw(); }
  }

  const triggerLatch = [false, false];
  const o = new THREE.Vector3(); const d = new THREE.Vector3();
  // XR: lasers from both controllers; trigger (button 0) edge picks
  function frameXr() {
    let hover = null;
    for (let i = 0; i < 2; i += 1) {
      const ctl = renderer.xr.getController(i);
      const src = ctl.userData.inputSource;
      const line = lasers[i];
      if (!src) { line.visible = false; continue; }
      ctl.updateMatrixWorld(true);
      o.setFromMatrixPosition(ctl.matrixWorld);
      d.set(0, 0, -1).transformDirection(m4.extractRotation(ctl.matrixWorld));
      const h = hitTest(o, d);
      const len = h.point ? o.distanceTo(h.point) : 3;
      line.position.copy(o);
      line.quaternion.setFromRotationMatrix(m4);
      line.scale.set(1, 1, len);
      line.visible = true;
      if (h.point) { cursor.position.copy(h.point); cursor.visible = true; }
      if (h.id) hover = h.id;
      const pressed = !!src.gamepad?.buttons?.[0]?.pressed;
      if (pressed && !triggerLatch[i]) { triggerLatch[i] = true; if (h.id) { press(h.id); if (!state.active) return; } }
      else if (!pressed) triggerLatch[i] = false;
    }
    setHover(hover);
  }

  const ndc = new THREE.Vector2();
  function pointer(event, camera, click) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = hitTest(ray.ray.origin, ray.ray.direction);
    setHover(h.id);
    if (click && h.id) press(h.id);
  }

  // at = { x, y, z, yaw }: put the room around the player (feet y, facing yaw: 0 = -Z)
  function open(at = null) {
    root.position.set(at?.x ?? 0, at?.y ?? 0, at?.z ?? 0);
    root.rotation.set(0, at?.yaw ?? 0, 0);
    root.updateMatrixWorld(true);
    state.active = true;
    state.choice = loadChoice();
    triggerLatch[0] = triggerLatch[1] = true; // the button that opened it must be released first
    draw();
  }

  // panel button centre in menu-scene world space (headless checks aim the emulated controller at it)
  function buttonPoint(id) {
    layout();
    const b = buttons.find((bb) => bb.id === id);
    if (!b) return null;
    const u = (b.x + b.w / 2) / W; const v = 1 - (b.y + b.h / 2) / H;
    panel.updateMatrixWorld(true);
    return new THREE.Vector3((u - 0.5) * PANEL_W, (v - 0.5) * PANEL_H, 0).applyMatrix4(panel.matrixWorld).toArray();
  }

  draw();
  return { scene, state, frameXr, pointer, press, open, draw, buttonPoint, get active() { return state.active; } };
}
