// Renders the grip preview frames (hand + club at address, top of the backswing, impact) for the driver and the
// hockey stick through the real rig: the game's own hold code poses the club from the emulated controller grips,
// then a staging scene (club clone, stylised fists + forearms, ball, ground) is rendered off-screen.
// node scripts/ground/gripsheet.mjs <dist> <outDir> [query]   (writes <kit>_<shot>.jpg + info.json; ?golf=old for the before frames)
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, outDir = '.', query = ''] = process.argv.slice(2);
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
await ev(() => { window.__realRender = __house.renderer.render; });
for (const f of ['pagelib.js', 'golflib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const X = (fn, a) => ev((src, a) => T.x(() => (0, eval)(src)(a)), fn.toString(), a);
const frames = (n) => ev((n) => T.frames(n), n);
const info = {};
await frames(20);

// staging renderer (shares the game renderer: textures are already on the GPU)
await ev(() => {
  const TH = __house.THREE; const S = (window.SHEET = {});
  S.render = (cfg) => {
    const H = __house; const club = G.club(); club.updateWorldMatrix(true, true);
    const scene = new TH.Scene(); scene.background = new TH.Color(0xbfd3e6);
    scene.add(new TH.HemisphereLight(0xeef4ff, 0x5a6b45, 1.6));
    const sun = new TH.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 5, 3); scene.add(sun);
    const g = new TH.Mesh(new TH.CircleGeometry(6, 48), new TH.MeshStandardMaterial({ color: 0x6f9a52, roughness: 0.95 }));
    g.rotation.x = -Math.PI / 2; g.position.set(cfg.ground[0], cfg.ground[1] - 0.0005, cfg.ground[2]); scene.add(g);
    const grid = new TH.GridHelper(4, 20, 0x4f7a3a, 0x5f8a48); grid.position.set(cfg.ground[0], cfg.ground[1] + 0.0005, cfg.ground[2]); scene.add(grid);
    // target line
    const tl = new TH.Mesh(new TH.BoxGeometry(cfg.targetDir[0] ? 3 : 0.006, 0.002, cfg.targetDir[2] ? 3 : 0.006), new TH.MeshBasicMaterial({ color: 0xffffff }));
    tl.position.set(cfg.ball[0] + cfg.targetDir[0] * 1.5, cfg.ground[1] + 0.001, cfg.ball[2] + cfg.targetDir[2] * 1.5); scene.add(tl);
    const c = club.clone(true); c.matrixAutoUpdate = false; c.matrix.copy(club.matrixWorld); c.visible = true; if (!cfg.noClub) scene.add(c);
    const ball = new TH.Mesh(new TH.SphereGeometry(cfg.ballR, 24, 16), new TH.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    ball.position.set(...cfg.ball); scene.add(ball);
    const fist = (ctrl, color) => { if (cfg.noFist) return;
      const gr = ctrl.userData.grip; gr.updateWorldMatrix(true, false);
      const m = new TH.MeshStandardMaterial({ color, roughness: 0.7 });
      const grp = new TH.Group(); grp.matrixAutoUpdate = false; grp.matrix.copy(gr.matrixWorld);
      const body = new TH.Mesh(new TH.CapsuleGeometry(0.036, 0.055, 6, 14), m); body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.9); grp.add(body);
      const thumb = new TH.Mesh(new TH.CapsuleGeometry(0.012, 0.035, 4, 8), m); thumb.position.set(0, 0.022, -0.05); thumb.rotation.x = Math.PI / 2 - 0.5; grp.add(thumb);
      const arm = new TH.Mesh(new TH.CylinderGeometry(0.028, 0.034, 0.2, 12), m);
      const dir = new TH.Vector3(0, 0.702, 0.702).normalize(); arm.quaternion.setFromUnitVectors(new TH.Vector3(0, 1, 0), dir); arm.position.copy(dir.clone().multiplyScalar(0.13)); grp.add(arm);
      scene.add(grp);
    };
    const lead = club.parent; fist(lead, 0xf3f1ea);
    if (club.userData.offHand) fist(club.userData.offHand, 0xd9a384);
    const cam = new TH.PerspectiveCamera(cfg.fov || 35, 960 / 720, 0.01, 50); cam.position.set(...cfg.cam); cam.lookAt(new TH.Vector3(...cfg.look));
    const r = H.renderer; const xrOn = r.xr.enabled; r.xr.enabled = false;
    const prevT = r.getRenderTarget(); const sc0 = r.getScissorTest(); r.setScissorTest(false); const rt = new TH.WebGLRenderTarget(960, 720); rt.texture.colorSpace = TH.SRGBColorSpace; S.rt = rt; r.setRenderTarget(rt); r.clear(); window.__realRender.call(r, scene, cam); // pagelib stubs r.render for speed
    const px = new Uint8Array(960 * 720 * 4); r.readRenderTargetPixels(S.rt, 0, 0, 960, 720, px);
    r.setRenderTarget(prevT); r.setScissorTest(sc0); r.xr.enabled = xrOn; rt.dispose();
    const cv = document.createElement('canvas'); cv.width = 960; cv.height = 720; const cx = cv.getContext('2d'); const id = cx.createImageData(960, 720);
    for (let y = 0; y < 720; y += 1) id.data.set(px.subarray((719 - y) * 960 * 4, (720 - y) * 960 * 4), y * 960 * 4);
    cx.putImageData(id, 0, 0);
    if (cfg.stats) { const pick = (x, y) => Array.from(px.slice(((719 - y) * 960 + x) * 4, ((719 - y) * 960 + x) * 4 + 4)); return [pick(480, 360), pick(10, 10), pick(480, 700)]; }
    return cv.toDataURL('image/jpeg', 0.92);
  };
});
const save = (name, url) => fs.writeFileSync(`${outDir}/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));

// rigid move of both fists about a pivot
const posePair = (a) => {
  const TH = __house.THREE; const ax = new TH.Vector3(...a.axis).normalize(); const pv = new TH.Vector3(...a.pivot);
  const r = new TH.Quaternion().setFromAxisAngle(ax, a.ang);
  for (const [s, p, q] of [[a.lead, a.p1, a.q1], [a.trail, a.p2, a.q2]]) {
    if (!s) continue;
    const pp = new TH.Vector3(...p).sub(pv).applyQuaternion(r).add(pv);
    const qq = r.clone().multiply(new TH.Quaternion(q.x, q.y, q.z, q.w));
    G.setGrip(s, pp, qq);
  }
};
const gripOf = (s) => { const g = G.ctrl(s).userData.grip; g.updateWorldMatrix(true, false); const p = new __house.THREE.Vector3(); const q = new __house.THREE.Quaternion(); g.matrixWorld.decompose(p, q, new __house.THREE.Vector3()); return { p: p.toArray(), q: { x: q.x, y: q.y, z: q.z, w: q.w } }; };

async function kit(name) {
  const golf = name === 'golf';
  await X((n) => G.useKit(n), name);
  const lead = 'left'; const trail = 'right'; // right-handed player: left hand on top
  let BALL; let floor; let target;
  if (golf) {
    const d = await X(() => ({ deck: __house.world.golf.green.y, tee: __house.world.golf.debug().tee }));
    floor = d.deck; BALL = [d.tee.x, d.tee.y, d.tee.z]; target = [-1, 0, 0];
    await X((a) => __house.place(a.x, a.y, a.z), { x: BALL[0] + 0.05, y: floor, z: Math.min(0.58, BALL[2] + 0.92) });
  } else {
    const i = await X(() => ({ b: __house.world.hockey.ball.position.toArray() }));
    BALL = i.b; floor = await X((b) => __house.groundModel.groundUnder(b[0], b[2], b[1] + 0.3), BALL); target = [0, 0, -1];
    await X((a) => __house.place(a.x, a.y, a.z), { x: BALL[0] - 0.8, y: floor, z: BALL[2] });
  }
  await frames(20);
  const at = await X(() => G.club().getWorldPosition(new __house.THREE.Vector3()).toArray());
  await X((a) => T.hand(a.s, [a.p[0], a.p[1] + 0.03, a.p[2]]), { s: lead, p: at }); await frames(4);
  await ev((s) => T.btn(s, 'squeeze', 1), lead); await frames(6); await ev((s) => T.btn(s, 'squeeze', 0), lead); await frames(6);
  const anat = await X((s) => G.anatomy(s, 17, false), lead);
  // place the lead fist so the face centre sits just behind the ball
  const back = golf ? [0.0214 + 0.004, 0, 0] : [0, 0, 0.0364 + 0.02];
  const place = async (h) => {
    const base = golf ? [BALL[0] + 0.3, floor + h, BALL[2] + 0.7] : [BALL[0] - 0.5, floor + h, BALL[2] + 0.3];
    await X((a) => G.setGrip(a.s, new __house.THREE.Vector3(...a.base), a.q), { s: lead, base, q: anat }); await frames(3);
    const m = await X(() => G.measure());
    const nb = [base[0] + BALL[0] + back[0] - m.faceC[0], base[1], base[2] + BALL[2] + back[2] - m.faceC[2]];
    await X((a) => G.setGrip(a.s, new __house.THREE.Vector3(...a.nb), a.q), { s: lead, nb, q: anat }); await frames(3);
    return X(() => G.measure());
  };
  let h0 = 0.9; for (let h = 1.05; h >= 0.55; h -= 0.01) { const m = await place(h); if (m.soleAboveGround <= 0.012) { h0 = h; break; } }
  await place(golf ? h0 : 0.85); await frames(100); // still at address: the length fit settles the sole
  await place(golf ? h0 : 0.85); await frames(10);
  // trail fist below the lead one on the shaft (9 cm golf, 30 cm hockey)
  const m0 = await X(() => G.measure());
  const sdW = await X((sd) => new __house.THREE.Vector3(...sd).applyQuaternion(G.R).toArray(), m0.shaftDir);
  const L = await X(gripOf, lead);
  const p2 = L.p.map((v, i) => v + sdW[i] * (golf ? 0.09 : 0.3));
  const q2 = await X((s) => { const q = G.anatomy(s, 17, false); return { x: q.x, y: q.y, z: q.z, w: q.w }; }, trail);
  await X((a) => G.setGrip(a.s, new __house.THREE.Vector3(...a.p), a.q), { s: trail, p: p2, q: q2 }); await frames(3);
  await ev((s) => T.btn(s, 'squeeze', 1), trail); await frames(40);
  const addr = await X(() => ({ m: G.measure(), d: G.club().userData.debug ? G.club().userData.debug() : __house.world.golf.debug() }));
  info[name] = { address: { lie: addr.m.lie, faceYaw: addr.m.faceYaw, loft: addr.m.loft, shaftFromVertical: addr.m.shaftFromVertical, sole: addr.m.soleAboveGround, twoHand: addr.d.twoHand, ext: addr.d.ext } };
  console.log(name, JSON.stringify(info[name]));
  const T2 = await X(gripOf, trail);
  const axis = [sdW[1] * target[2] - sdW[2] * target[1], sdW[2] * target[0] - sdW[0] * target[2], sdW[0] * target[1] - sdW[1] * target[0]];
  const hub = L.p.map((v, i) => v + sdW[i] * 0.55 * 0 - sdW[i] * 0.55);
  const faceC = addr.m.faceC; // golf frame == world for golf; for hockey use the world face centre
  const fcW = await X(() => { const f = G.golf().face; return [f.c.x, f.c.y, f.c.z]; });
  const side = golf ? [0, 0, -1] : [1, 0, 0]; // camera side: in front of the player
  const right = golf ? [1, 0, 0] : [0, 0, 1];
  const resetBall = async () => { if (golf) await X(() => G.resetBall()); else await X(() => { const d = G.club().userData.debug(); const b = d.ballState; Object.assign(b.p, d.spawn); b.v.x = b.v.y = b.v.z = 0; b.w.x = b.w.y = b.w.z = 0; }); };
  const ballR = golf ? 0.02135 : 0.0364;
  const shot = async (label, ang, pivot, cam, look, fov) => {
    await X(posePair, { lead, trail, p1: L.p, q1: L.q, p2: T2.p, q2: T2.q, axis, pivot, ang }); await frames(30);
    await resetBall(); await frames(2);
    const ballP = await X(() => { const b = G.club().userData.debug ? G.club().userData.debug().ballState.p : __house.world.golf.ballState.p; return [b.x, b.y, b.z]; });
    const url = await ev((c) => SHEET.render(c), { ground: [BALL[0], floor, BALL[2]], ball: ballP, ballR, targetDir: target, cam, look, fov });
    save(`${name}_${label}`, url);
    const m = await X(() => G.measure());
    info[name][`shot_${label}`] = { lie: m.lie, faceYaw: m.faceYaw, shaftFromVertical: m.shaftFromVertical };
  };
  const mid = [(BALL[0] + L.p[0]) / 2, floor, (BALL[2] + L.p[2]) / 2];
  const off3 = (base, d, dir, up) => base.map((v, i) => v + dir[i] * d + (i === 1 ? up : 0));
  const FO = off3(mid, 2.5, side, 0.95); const foLook = [mid[0], floor + 0.62, mid[2]];
  const FOT = off3(mid, 3.3, side, 1.2); const fotLook = [mid[0], floor + 1.0, mid[2]];
  const DTL = off3(mid, 2.6, target.map((v) => -v), 1.0); const dtlLook = [mid[0], floor + 0.6, mid[2]];
  const hc = L.p.map((v, i) => (v + p2[i]) / 2);
  await shot('address', 0, hub, FO, foLook, 40);
  await shot('top', golf ? -2.3 : -1.3, hub, FOT, fotLook, 50);
  // impact: hands ahead of the head (shaft lean about the face centre)
  await shot('impact', golf ? 0.14 : 0.1, fcW, FO, foLook, 40);
  await shot('dtl', 0, hub, DTL, dtlLook, 40);
  await shot('grip', 0, hub, hc.map((v, i) => v + side[i] * 0.95 + target[i] * 0.45 + (i === 1 ? 0.15 : 0)), hc.map((v, i) => v + sdW[i] * 0.12), 40);
  await shot('head', 0, hub, [fcW[0] - target[0] * 0.55, fcW[1] + 0.14, fcW[2] - target[2] * 0.55].map((v, i) => v + side[i] * 0.15), fcW, 35);
  await ev((s) => T.btn(s, 'squeeze', 0), trail); await frames(6);
  // drop the club (squeeze the lead again) and walk on
  await ev((s) => T.btn(s, 'squeeze', 1), lead); await frames(6); await ev((s) => T.btn(s, 'squeeze', 0), lead); await frames(10);
}
await kit('golf');
await kit('hockey');
fs.writeFileSync(`${outDir}/info.json`, JSON.stringify({ info, logs: logs.filter((l) => !/favicon|404/.test(l)) }, null, 1));
await close();
