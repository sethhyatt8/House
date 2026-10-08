// Static ground-truth survey: flood-fill every cell the walker can reach (10 cm grid) from seeds on every level,
// then compare the model floor (walk.js groundUnder: where the rig's feet end up) with the visible surface under it
// (downward raycast, GT.floor). Also samples blocked edges that have visible floor within a step.
// node survey.mjs <dist> <out.json> [query]
import fs from 'fs'; import { boot } from './boot.mjs';
const [dist, out, query = ''] = process.argv.slice(2);
const t0 = Date.now();
const { ev, logs, close } = await boot(dist, query);
await ev(fs.readFileSync(new URL('./probe.js', import.meta.url), 'utf8'));
const res = await ev(() => {
  const H = __house; const w = H.world;
  H.chopDoor();
  const meshes = GT.init();
  const seeds = [];
  for (const s of H.spots()) if (!s.seat) seeds.push({ x: s.x, z: s.z, y: s.floor, why: s.status });
  seeds.push({ x: 4.12, z: 0.14, y: 0, why: 'cell' });
  for (const f of w.lift?.floors || []) seeds.push({ x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, y: f.y, why: `lift floor ${f.y}` });
  const sh = w.notches?.shelf; if (sh) seeds.push({ x: (sh.x0 + sh.x1) / 2, z: (sh.z0 + sh.z1) / 2, y: sh.floor, why: 'notch shelf' });
  const top = w.crag?.ladder?.userData?.topSpot; if (top) seeds.push({ x: top.x, z: top.z, y: top.y, why: 'crag top' });
  const gr = w.golf?.green; if (gr) seeds.push({ x: (gr.x0 + gr.x1) / 2, z: (gr.z0 + gr.z1) / 2, y: gr.y, why: 'green' });
  const shallow = w.cave?.shallows; if (shallow) seeds.push({ x: (shallow.x0 + shallow.rampTo) / 2, z: (shallow.z0 + shallow.z1) / 2, y: shallow.floorY, why: 'shallows' });
  const S = 0.1; const seen = new Set(); const q = []; const cells = []; const edges = [];
  const k = (ix, iz, g) => `${ix},${iz},${Math.round(g * 4)}`;
  for (const s of seeds) {
    const g = H.groundModel.groundUnder(s.x, s.z, s.y + 0.05);
    const ix = Math.round(s.x / S); const iz = Math.round(s.z / S);
    if (!seen.has(k(ix, iz, g))) { seen.add(k(ix, iz, g)); q.push([ix, iz, g, s.why]); }
  }
  const t = performance.now();
  while (q.length && cells.length < 300000) {
    const [ix, iz, g, seed] = q.shift();
    const x = ix * S; const z = iz * S;
    const gt = GT.floor(x, z, g + 0.45, g - 0.9, false);
    const lab = (gt == null || Math.abs(gt - g) > 0.05) ? (GT.floor(x, z, g + 0.45, g - 0.9, true)?.label || '-') : undefined;
    cells.push([+x.toFixed(2), +z.toFixed(2), +g.toFixed(3), gt == null ? null : +gt.toFixed(3), seed, lab]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = (ix + dx) * S; const nz = (iz + dz) * S;
      const wv = H.walker.walkable(nx, nz, g);
      if (wv.ok) { const kk = k(ix + dx, iz + dz, wv.ground); if (!seen.has(kk)) { seen.add(kk); q.push([ix + dx, iz + dz, wv.ground, seed]); } }
      else if (wv.why === 'water' || wv.why === 'ledge' || wv.why === 'edge' || wv.why === 'too high') {
        const gt2 = GT.floor(nx, nz, g + 0.42, g - 0.5, false);
        if (gt2 != null) edges.push([+nx.toFixed(2), +nz.toFixed(2), +g.toFixed(3), +gt2.toFixed(3), wv.why, +H.groundModel.groundUnder(nx, nz, g).toFixed(3)]);
      }
    }
  }
  return { meshes, seeds, cells, edges, ms: Math.round(performance.now() - t) };
});
res.logs = logs; res.query = query; res.wall = Date.now() - t0;
fs.writeFileSync(out, JSON.stringify(res));
console.log('meshes', res.meshes, 'seeds', res.seeds.length, 'cells', res.cells.length, 'edges', res.edges.length, 'ms', res.ms, 'wall', res.wall, 'logs', logs.slice(0, 5));
await close(); process.exit(0);
