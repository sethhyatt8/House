// Summarise dyn/boat rows: per section, frames where |feet - visible floor| > 5 cm (spans), snaps and voids.
import fs from 'fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const TOL = 0.05;
const secs = {};
for (const row of r.rows) (secs[row[0]] ||= []).push(row);
for (const [tag, rows] of Object.entries(secs)) {
  let bad = 0; const spans = []; let cur = null; const snaps = []; let free = 0;
  rows.forEach((row, i) => {
    const [, f, x, z, feet, eye, gt, model, aboard, climb, vy, lift] = row;
    if (aboard || climb) { cur = null; return; }
    free++;
    const d = gt == null ? null : feet - gt;
    const off = d == null || Math.abs(d) > TOL;
    if (off) {
      bad++;
      if (!cur || f - cur.f1 > 2) { cur = { f0: f, f1: f, x0: x, z0: z, x1: x, z1: z, dmin: d, dmax: d, model, feet, n: 0, falling: vy }; spans.push(cur); }
      cur.f1 = f; cur.x1 = x; cur.z1 = z; cur.n++;
      if (d != null) { cur.dmin = cur.dmin == null ? d : Math.min(cur.dmin, d); cur.dmax = cur.dmax == null ? d : Math.max(cur.dmax, d); }
      cur.falling = Math.min(cur.falling, vy);
    } else cur = null;
    if (i > 0) { const p = rows[i - 1]; const dy = feet - p[4]; if (Math.abs(dy) > 0.2 && !lift && !p[8] && !p[9] && f - p[1] <= 2) snaps.push({ f, x, z, from: p[4], to: feet }); }
  });
  console.log(`\n== ${tag}: frames ${rows.length}, free ${free}, off>5cm ${bad}`);
  for (const s of spans.filter((s) => s.n >= 2).sort((a, b) => b.n - a.n).slice(0, 12)) console.log(`  span n=${s.n} (${s.x0.toFixed(2)},${s.z0.toFixed(2)})->(${s.x1.toFixed(2)},${s.z1.toFixed(2)}) feet ${s.feet} model ${s.model} feet-visible ${s.dmin == null ? 'VOID' : s.dmin.toFixed(3) + '..' + s.dmax.toFixed(3)} vy ${s.falling}`);
  for (const s of snaps.slice(0, 8)) console.log(`  snap f${s.f} (${s.x},${s.z}) ${s.from} -> ${s.to}`);
}
for (const s of r.steps) if (s.name !== 'fps') console.log(s.name, JSON.stringify(s).slice(0, 400));
