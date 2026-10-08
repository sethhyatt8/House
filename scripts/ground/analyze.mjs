// Summarise a survey JSON: mismatch clusters (|model - visible| > 5 cm or no visible floor), grouped by seed and level.
import fs from 'fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const TOL = 0.05;
const bySeed = {};
for (const [x, z, g, gt, seed, lab] of r.cells) {
  const s = (bySeed[seed] ||= { n: 0, ok: 0, float: [], sink: [], none: [] });
  s.n++;
  if (gt == null) s.none.push([x, z, g]);
  else if (g - gt > TOL) s.float.push([x, z, g, gt, lab]);
  else if (gt - g > TOL) s.sink.push([x, z, g, gt, lab]);
  else s.ok++;
}
// cluster points (8-neighbour, same level within 0.3)
function clusters(pts) {
  const key = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
  const map = new Map(pts.map((p) => [key(p[0], p[1]) + ',' + Math.round(p[2] * 3), p]));
  const seen = new Set(); const out = [];
  for (const [k0, p0] of map) {
    if (seen.has(k0)) continue;
    const c = []; const st = [k0]; seen.add(k0);
    while (st.length) {
      const k = st.pop(); const p = map.get(k); c.push(p);
      const [ix, iz, il] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dl = -1; dl <= 1; dl++) {
        const kk = `${ix + dx},${iz + dz},${il + dl}`; if (map.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); }
      }
    }
    out.push(c);
  }
  return out.sort((a, b) => b.length - a.length).map((c) => {
    const xs = c.map((p) => p[0]); const zs = c.map((p) => p[1]);
    const d = c.map((p) => (p[3] == null ? null : p[2] - p[3])).filter((v) => v != null).sort((a, b) => a - b);
    const labs = {}; c.forEach((p) => { if (p[4]) labs[p[4]] = (labs[p[4]] || 0) + 1; });
    return { labs: Object.entries(labs).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]).join(' | '), n: c.length, x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)], model: +(c.reduce((s, p) => s + p[2], 0) / c.length).toFixed(2), diffMed: d.length ? +d[d.length >> 1].toFixed(3) : null, diffMin: d.length ? +d[0].toFixed(3) : null, diffMax: d.length ? +d[d.length - 1].toFixed(3) : null };
  });
}
for (const [seed, s] of Object.entries(bySeed)) {
  console.log(`\n== ${seed}: cells ${s.n}, ok ${s.ok}, float ${s.float.length}, sink ${s.sink.length}, no-visible-floor ${s.none.length}`);
  for (const [name, list] of [['FLOAT', s.float], ['SINK', s.sink], ['NONE', s.none]]) {
    for (const c of clusters(list).filter((c) => c.n >= (process.argv[3] ? +process.argv[3] : 3)).slice(0, 8)) console.log(`  ${name} n=${c.n} x ${c.x} z ${c.z} model ${c.model} diff med ${c.diffMed} [${c.diffMin}..${c.diffMax}] ${c.labs}`);
  }
}
// blocked edges that look walkable
const eb = {};
for (const [x, z, g, gt, why, gm] of r.edges) { if (Math.abs(gt - g) <= 0.42) (eb[why] ||= []).push([x, z, g, gt]); }
console.log('\n== blocked edges with visible floor within a step:', Object.fromEntries(Object.entries(eb).map(([k, v]) => [k, v.length])));
for (const [why, list] of Object.entries(eb)) for (const c of clusters(list).slice(0, 10)) if (c.n >= 4) console.log(`  ${why} n=${c.n} x ${c.x} z ${c.z} model ${c.model}`);
