// node scripts/daynight-check.mjs
// Day/night pass: steps the clock through 24 h (every 6 game minutes) and checks the pure parts of src/daynight.js:
// the sun's arc (east -> south -> west, below the horizon at night), the sun/moon light weights (never both on, both
// ~0 where the light swaps direction), the 6-key look gradient (night = the old fixed lighting exactly, continuous,
// noon brightest) and the morning fog curve (0 at night, rolls in, holds, burns off by 10:00; ?fog=0 is always 0).
globalThis.location = { search: '' };
const THREE = await import('three');
const dn = await import('../src/daynight.js');
let fails = 0;
const ok = (name, pass, info = '') => { if (!pass) fails += 1; console.log(pass ? 'PASS' : 'FAIL', name, info); };
const hex = (c) => c.getHexString();

// ---- defaults / flags
ok('defaults: 24 min day, start 10:00, timescale 1, fog on', dn.DAY_MINUTES === 24 && dn.START_HOUR === 10 && dn.TIMESCALE === 1 && dn.MORNING_FOG && dn.DAYNIGHT);
ok('6 keys: night, dawn, morning, noon, dusk, night', dn.KEY_NAMES.join() === 'night,dawn,morning,noon,dusk,night'
  && dn.KEYS.map((k) => k[1]).filter((n, i, a) => n !== a[i - 1]).join() === 'night,dawn,morning,noon,dusk,night'
  && dn.KEYS.every((k, i, a) => i === 0 || k[0] > a[i - 1][0]));

// ---- sun arc
const rows = [];
for (let m = 0; m <= 24 * 60; m += 6) {
  const h = m / 60; const s = dn.sunDir(h);
  rows.push({ h, s, sunW: dn.sunWeight(h), moonW: dn.moonWeight(h), fog: dn.fogAmount(h), look: dn.lookAt(h) });
}
const at = (h) => dn.sunDir(h);
const rise = at(dn.SUNRISE); const set = at(dn.SUNSET); const noon = at(dn.NOON);
ok('sunrise due east on the horizon', rise.x > 0.999 && Math.abs(rise.y) < 1e-6, rise.toArray().map((v) => v.toFixed(3)).join());
ok('sunset due west on the horizon (over the sea, -x)', set.x < -0.999 && Math.abs(set.y) < 1e-6, set.toArray().map((v) => v.toFixed(3)).join());
ok('noon: 62 deg up, in the south (+z)', Math.abs(Math.asin(noon.y) * 180 / Math.PI - 62) < 0.01 && noon.z > 0.4 && Math.abs(noon.x) < 1e-6, (Math.asin(noon.y) * 180 / Math.PI).toFixed(2));
const day = rows.filter((r) => r.h > dn.SUNRISE + 0.01 && r.h < dn.SUNSET - 0.01);
ok('above the horizon all day, below all night', day.every((r) => r.s.y > 0) && rows.filter((r) => r.h < dn.SUNRISE - 0.01 || r.h > dn.SUNSET + 0.01).every((r) => r.s.y < 0));
ok('arcs east to west (x falls monotonically through the day)', day.every((r, i) => i === 0 || r.s.x < day[i - 1].s.x));
ok('unit vectors', rows.every((r) => Math.abs(r.s.length() - 1) < 1e-9));
let maxStep = 0; for (let i = 1; i < rows.length; i += 1) if (rows[i].s.y > -0.2) maxStep = Math.max(maxStep, rows[i].s.angleTo(rows[i - 1].s) * 180 / Math.PI);
ok('continuous while it can light anything (sun > -11 deg): < 2 deg per 6 game minutes', maxStep < 2, maxStep.toFixed(3) + ' deg');

// ---- light weights
ok('sun light off at night, full by midday', rows.every((r) => (r.s.y <= 0 ? r.sunW === 0 : true)) && dn.sunWeight(dn.NOON) === 1);
ok('moon full in the deep night, off by day', dn.moonWeight(0) === 1 && dn.moonWeight(23) === 1 && dn.moonWeight(3) === 1 && day.every((r) => r.moonW === 0));
ok('never sun and moon at once', rows.every((r) => Math.min(r.sunW, r.moonW) === 0));
const swaps = rows.filter((r, i) => i > 0 && (r.s.y > -0.05) !== (rows[i - 1].s.y > -0.05));
ok('direction swap (sun <-> moon) happens with the light at 0', swaps.length === 2 && swaps.every((r) => r.sunW === 0 && r.moonW === 0), swaps.map((r) => r.h.toFixed(2)).join(' '));
ok('moon = the old fixed key direction (-7, 9, 2) -> (0, 0.6, -0.2)', dn.MOON_DIR.distanceTo(new THREE.Vector3(-7, 8.4, 2.2).normalize()) < 1e-9);

// ---- looks
const n0 = dn.lookAt(0); const n23 = dn.lookAt(23); const n3 = dn.lookAt(3);
const old = { keyCol: 'd5e2ff', keyI: 1.15, hemiSky: '8ea4cc', hemiGround: '2a2622', hemiI: 0.26, fillI: 0.34, rimI: 0.4, fog: '10182c', fogNear: 18, fogFar: 210, haze: '1b2738', deep: '02080c', shallow: '0e3a40', scatter: '0a3a3c', foam: 'a7b3bb', refl: '1c2636', glint: 1.6 };
const same = (L) => Object.entries(old).every(([k, v]) => (typeof v === 'string' ? hex(L[k]) === v : Math.abs(L[k] - v) < 1e-9));
ok('night end (00:00, 03:00, 23:00) = the old fixed lighting exactly', same(n0) && same(n3) && same(n23));
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const kI = (h) => dn.lookAt(h).keyI * (dn.sunDir(h).y > -0.05 ? dn.sunWeight(h) : dn.moonWeight(h));
ok('key light: noon > morning > dawn-ish; night = 1.15', kI(12.5) > kI(9) && kI(9) > kI(6.5) && Math.abs(kI(1) - 1.15) < 1e-9, [6.5, 9, 12.5, 19, 1].map((h) => `${h}:${kI(h).toFixed(2)}`).join(' '));
ok('warm sun at dawn/dusk (r > b), neutral at noon, blue moon at night', (() => { const d = dn.lookAt(6).keyCol; const u = dn.lookAt(18.6).keyCol; const nn = dn.lookAt(12.5).keyCol; return d.r > d.b * 1.5 && u.r > u.b * 1.8 && nn.b > 0.8 && n0.keyCol.b > n0.keyCol.r; })());
ok('sky/fog brightness: noon > morning > dawn > night', lum(dn.lookAt(12.5).fog) > lum(dn.lookAt(6).fog) && lum(dn.lookAt(9).fog) > lum(dn.lookAt(6).fog) && lum(dn.lookAt(6).fog) > lum(n0.fog));
let jump = 0; for (let i = 1; i < rows.length; i += 1) jump = Math.max(jump, Math.abs(rows[i].look.keyI - rows[i - 1].look.keyI), Math.abs(lum(rows[i].look.fog) - lum(rows[i - 1].look.fog)) * 4);
ok('looks are continuous (no step > 0.2 per 6 game minutes)', jump < 0.2, jump.toFixed(3));
const glow = (h) => dn.lookAt(h).night;
ok('lantern/fireflies/night bed: on at night, off by day, fading in after dusk', glow(0) === 1 && glow(12.5) === 0 && glow(9) === 0 && glow(19.2) > 0.3 && glow(19.2) < 1);

// ---- fog curve
const f = (h) => dn.fogAmount(h);
ok('no fog at night or in the afternoon', [0, 3, 5, 5.3, 10, 12, 15, 19, 23].every((h) => f(h) === 0));
ok('fog peaks at 1 between 07:12 and 07:48', f(7.2) === 1 && f(7.5) === 1 && f(7.8) === 1);
const curve = rows.filter((r) => r.h >= 5.4 && r.h <= 10);
ok('rolls in monotonically (05:24 -> 07:12), burns off monotonically (07:48 -> 10:00)', curve.filter((r) => r.h <= 7.2).every((r, i, a) => i === 0 || r.fog >= a[i - 1].fog) && curve.filter((r) => r.h >= 7.8).every((r, i, a) => i === 0 || r.fog <= a[i - 1].fog));
ok('rolling in takes ~1.8 real minutes, burning off ~2.2 (24 min day)', Math.abs((dn.FOG_TIMES.in1 - dn.FOG_TIMES.in0) * dn.DAY_MINUTES / 24 - 1.8) < 0.01 && Math.abs((dn.FOG_TIMES.out1 - dn.FOG_TIMES.out0) * dn.DAY_MINUTES / 24 - 2.2) < 0.01);
ok('dawn (06:00) already foggy, mid-morning (10:00) clear', f(6) > 0.2 && f(10) === 0, `06:00 ${f(6).toFixed(2)}`);
ok('low bank over the sea outlives the fog a little', dn.bankAmount(10.2) > 0 && dn.bankAmount(5.3) > 0 && dn.bankAmount(12) === 0);
const fogDist = (h) => { const L = dn.lookAt(h); return L.fogFar + (dn.FOG_PEAK.far - L.fogFar) * f(h); };
ok('view distance: fog far 26 m at the peak, back to >= 200 m by noon', Math.abs(fogDist(7.5) - 26) < 1e-9 && fogDist(12.5) >= 200 && dn.FOG_PEAK.near >= 1, `${fogDist(6.5).toFixed(0)} / ${fogDist(7.5).toFixed(0)} / ${fogDist(9).toFixed(0)} / ${fogDist(12.5).toFixed(0)} m`);
ok('fog near stays >= 1 m (the underwater absorption gate is fog.near < 1)', rows.every((r) => r.look.fogNear + (dn.FOG_PEAK.near - r.look.fogNear) * r.fog >= 1));

// ---- flags in fresh module instances
globalThis.location = { search: '?fog=0&daylen=6&time=19.5&timescale=2' };
const dn2 = await import('../src/daynight.js?flags');
ok('?fog=0: no fog at any hour', rows.every((r) => dn2.fogAmount(r.h) === 0 && dn2.bankAmount(r.h) === 0));
ok('?daylen=6&time=19.5&timescale=2 parsed', dn2.DAY_MINUTES === 6 && dn2.START_HOUR === 19.5 && dn2.TIMESCALE === 2);
globalThis.location = { search: '?daynight=0&time=30' };
const dn3 = await import('../src/daynight.js?off');
ok('?daynight=0 parsed; ?time wraps', dn3.DAYNIGHT === false && dn3.START_HOUR === 6);

console.log('\nhour  sunY   sunW moonW fog   keyI  fogFar  sky');
for (const h of [0, 4.6, 5.5, 6, 6.5, 7.2, 8, 9, 10, 12.5, 15, 18.6, 19.25, 20, 20.4, 22]) {
  const L = dn.lookAt(h);
  console.log(String(h).padEnd(5), dn.sunDir(h).y.toFixed(2).padStart(5), dn.sunWeight(h).toFixed(2), dn.moonWeight(h).toFixed(2).padStart(5), f(h).toFixed(2), kI(h).toFixed(2).padStart(5), fogDist(h).toFixed(0).padStart(6), '  #' + hex(L.horizon));
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
