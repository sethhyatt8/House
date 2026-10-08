// Bag / inventory end to end through the real XR rig (IWER): pick the bag up, pick items up (they go into the
// bag), check the pocket icons, open the bag (B), equip from a pocket (trigger), stow back (squeeze), drop a pocket
// item (squeeze on the pocket), and the same after a swim + canoe ride. Prints PASS/FAIL, exits 1 on failure.
// node scripts/ground/bag.mjs <dist> <out.json> [query]
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, out, query = ''] = process.argv.slice(2);
const { ev, logs, close } = await boot(dist, query, { headH: 1.6 });
for (const f of ['probe.js', 'pagelib.js']) await ev(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const res = { query, steps: [], checks: [] };
const step = (name, v) => { res.steps.push({ name, ...v }); console.log(name, JSON.stringify(v).slice(0, 400)); };
const check = (name, ok, v) => { res.checks.push({ name, ok: !!ok, v }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v)); };
await ev(() => {
  const H = __house; const TH = H.THREE;
  T.find = (g) => { let r = null; H.world.scene.traverse((o) => { if (!r && o.userData?.gear === g) r = o; }); return r; };
  T.items = () => { const out = {}; for (const g of ['hatchet', 'torch', 'brush', 'bow']) { const o = T.find(g); if (o) out[g] = { inBag: !!o.userData.inBag, pocket: o.userData.pocket ?? null, carried: !!o.userData.carried, visible: o.visible, icon: !!o.userData.bakedIcon }; } return out; };
  T.pockets = () => { const ps = []; H.world.scene.traverse((o) => { if (o.userData?.gear === 'pocket') ps.push(o); }); ps.sort((a, b) => a.userData.index - b.userData.index); return ps; };
  T.pocketState = () => T.pockets().slice(0, 6).map((p) => ({ i: p.userData.index, filled: p.material.color.getHex() !== 0x2c241c, icon: p.userData.itemIcon.visible || p.userData.axeIcon.visible || p.userData.tileIcon.visible || p.userData.sprayIcon.visible }));
  T.wpos = (o) => { const v = (o.userData.grip && o.userData.grip.visible ? o : o).getWorldPosition(new TH.Vector3()); return [v.x, v.y, v.z]; };
  // aim a controller (native pose) from 25 cm in front of the head at a world point
  T.aim = (side, target) => {
    const hp = T.toLocal(T.headWorld()); const tp = T.toLocal(target);
    const from = [hp[0] + (side === 'right' ? 0.15 : -0.15), hp[1] - 0.25, hp[2]];
    const fw = T.toLocal([0, 0, 0]); // unused
    // place the controller on the line head->target, 0.3 m out
    const d = [tp[0] - from[0], tp[1] - from[1], tp[2] - from[2]]; const L = Math.hypot(...d); const u = d.map((x) => x / L);
    __xr.controllers[side].position.set(from[0], from[1], from[2]);
    const q = new TH.Quaternion().setFromUnitVectors(new TH.Vector3(0, 0, -1), new TH.Vector3(u[0], u[1], u[2]));
    __xr.controllers[side].quaternion.set(q.x, q.y, q.z, q.w);
  };
  T.headWorld = () => { const m = new TH.Matrix4().fromArray(H.cameraMatrix()); const p = new TH.Vector3().setFromMatrixPosition(m); return [p.x, p.y, p.z]; };
  T.unaim = (side) => { __xr.controllers[side].quaternion.set(0, 0, 0, 1); };
  T.press = async (side, id) => { T.btn(side, id, 1); await T.frames(6); T.btn(side, id, 0); await T.frames(6); };
});
const items = () => ev(() => T.x(() => ({ owns: __house.world.gear.ownsBag(), items: T.items(), pockets: T.pocketState(), status: __house.state().status.slice(0, 80) })));
await ev(() => T.x(() => __house.chopDoor()));
await ev(() => T.settle(20));
// 1) the bag in the cave
const bagPos = await ev(() => T.x(() => T.wpos(T.find('bag'))));
await ev((b) => T.x(() => __house.place(b[0], __house.world.cave.floor, b[2] + 0.45)), bagPos); await ev(() => T.settle(20));
await ev((b) => T.x(() => T.hand('right', [b[0], b[1] + 0.05, b[2]])), bagPos); await ev(() => T.settle(5));
await ev(() => T.press('right', 'squeeze'));
let s = await items(); step('1_bag', s);
check('1 picking the bag up (squeeze on it) owns it', s.owns, s.owns);
// 2) items go into the bag when you pick them up with the bag owned
for (const g of ['torch', 'hatchet']) {
  const p = await ev((g) => T.x(() => { const o = T.find(g); return o ? T.wpos(o) : null; }), g);
  if (!p) { check(`2 ${g} exists`, false, null); continue; }
  const floor = await ev((p) => T.x(() => __house.groundModel.groundUnder(p[0], p[2], p[1] - 0.5)), p);
  await ev((a) => T.x(() => __house.place(a.p[0] + 0.35, a.floor, a.p[2])), { p, floor }); await ev(() => T.settle(20));
  const p2 = await ev((g) => T.x(() => T.wpos(T.find(g))), g);
  await ev((p) => T.x(() => T.hand('right', p)), p2); await ev(() => T.settle(5));
  await ev(() => T.press('right', 'squeeze'));
  s = await items(); step(`2_pick_${g}`, { at: p2.map((v) => +v.toFixed(2)), ...s });
  check(`2 ${g} picked up into the bag`, s.items[g]?.inBag && !s.items[g].visible, s.items[g]);
}
check('2 pocket icons show the stored items', s.pockets.filter((p) => p.filled && p.icon).length >= 2, s.pockets);
check('2 baked item icons exist', s.items.torch?.icon && s.items.hatchet?.icon, { torch: s.items.torch?.icon, hatchet: s.items.hatchet?.icon });
// 3) open the bag (B), equip the torch (trigger aimed at its pocket)
await ev(() => T.press('right', 'b-button')); await ev(() => T.settle(5));
const menuVis = await ev(() => T.x(() => !!T.pockets()[0]?.parent?.visible));
check('3 B opens the bag menu', menuVis, menuVis);
const tp = await ev(() => T.x(() => { const i = T.find('torch').userData.pocket; return T.wpos(T.pockets()[i]); }));
await ev((p) => T.x(() => T.aim('right', p)), tp); await ev(() => T.settle(5));
await ev(() => T.press('right', 'trigger'));
s = await items(); step('3_equip_torch', s);
check('3 trigger on a pocket equips the item into the hand', s.items.torch?.carried && !s.items.torch.inBag, s.items.torch);
// 4) squeeze while holding: back into the bag
await ev(() => T.x(() => T.unaim('right'))); await ev(() => T.settle(3));
await ev(() => T.x(() => T.hand('right', [T.headWorld()[0] + 0.3, T.headWorld()[1] - 0.5, T.headWorld()[2]]))); await ev(() => T.settle(3));
await ev(() => T.press('right', 'squeeze'));
s = await items(); step('4_stow_torch', s);
check('4 squeeze with the item in hand stows it again', s.items.torch?.inBag, s.items.torch);
// 5) drop the hatchet out of its pocket (squeeze aimed at the pocket)
let menuOpen = await ev(() => T.x(() => !!T.pockets()[0]?.parent?.visible));
if (!menuOpen) { await ev(() => T.press('right', 'b-button')); await ev(() => T.settle(5)); }
const hp = await ev(() => T.x(() => { const i = T.find('hatchet').userData.pocket; return T.wpos(T.pockets()[i]); }));
await ev((p) => T.x(() => T.aim('right', p)), hp); await ev(() => T.settle(5));
await ev(() => T.press('right', 'squeeze'));
s = await items(); step('5_drop_hatchet', s);
check('5 squeeze on a pocket drops the item in front of you', !s.items.hatchet?.inBag && s.items.hatchet?.visible && !s.items.hatchet?.carried, s.items.hatchet);
await ev(() => T.press('right', 'b-button')); await ev(() => T.settle(5));
await ev(() => T.x(() => T.unaim('right')));
// 6) after a swim and a canoe ride: open the bag, equip the torch
await ev(() => T.x(() => __house.place(-8, -6.4, 4))); await ev(() => T.settle(200));
const swam = await ev(() => T.x(() => !!__house.state().swim?.active));
await ev(() => T.x(() => __house.boardCanoe())); await ev(() => T.settle(30));
await ev(() => T.x(() => __house.leaveCanoe())); await ev(() => T.settle(10));
await ev(() => T.x(() => __house.teleportTo(1))); await ev(() => T.settle(30));
await ev(() => T.press('right', 'b-button')); await ev(() => T.settle(5));
const tp2 = await ev(() => T.x(() => { const i = T.find('torch').userData.pocket; return i == null ? null : T.wpos(T.pockets()[i]); }));
if (tp2) { await ev((p) => T.x(() => T.aim('right', p)), tp2); await ev(() => T.settle(5)); await ev(() => T.press('right', 'trigger')); }
s = await items(); step('6_after_swim_and_canoe', { swam, ...s });
check('6 after swimming + the canoe, the bag still equips', s.items.torch?.carried, s.items.torch);
res.logs = logs;
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const bad = res.checks.filter((c) => !c.ok).length;
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
await close(); process.exit(bad ? 1 : 0);
