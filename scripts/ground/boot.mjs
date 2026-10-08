// Shared boot for the ground/boat harness: serve a dist folder, open it in headless Chrome with IWER (emulated
// Quest 3), enter the XR session and install page helpers (T.*). Usage: const { pg, ev, close } = await boot(dist, query)
import fs from 'fs'; import http from 'http'; import path from 'path'; import { createRequire } from 'module';
// Dev-only deps (not in package.json): npm i --no-save puppeteer-core@23 iwer@2.5
// Overrides: HOUSE_NODE_MODULES (folder that has puppeteer-core + iwer), CHROME (Chrome/Chromium executable).
const require = createRequire(process.env.HOUSE_NODE_MODULES ? path.join(process.env.HOUSE_NODE_MODULES, 'x.js') : import.meta.url);
const puppeteer = require('puppeteer-core');
const iwer = fs.readFileSync(require.resolve('iwer/build/iwer.js'), 'utf8');
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webp': 'image/webp' };
export async function boot(dist, query = '', { port = 8790 + Math.floor(Math.random() * 200), headH = 1.6 } = {}) {
  const root = path.resolve(dist);
  const srv = http.createServer((q, r) => {
    let p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
  }).listen(port);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 1800000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage(); await pg.setViewport({ width: 320, height: 200 });
  const logs = [];
  pg.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') logs.push('console.error: ' + m.text().slice(0, 240)); });
  await pg.evaluateOnNewDocument(iwer + `
;(() => { const cfg = { ...IWER.metaQuest3, supportedSessionModes: ['inline', 'immersive-vr'] };
  const d = new IWER.XRDevice(cfg); d.stereoEnabled = false; d.installRuntime({ forceInstall: true }); window.__xr = d;
  const RS = window.XRReferenceSpace.prototype; const orig = RS.getOffsetReferenceSpace;
  RS.getOffsetReferenceSpace = function (t) { return orig.call(this, t && t.matrix ? t.matrix : t); }; })();`);
  await pg.goto(`http://localhost:${port}/?testhooks=1&shadow=256&xrscale=0.25&${query}`);
  await pg.waitForFunction(() => document.getElementById('loading')?.hidden && window.__house, { timeout: 600000, polling: 1000 });
  const btn = await pg.evaluate(() => { const b = document.getElementById('XRButton'); return b ? b.textContent + '|' + b.disabled + '|' + getComputedStyle(b).display : 'none'; }); console.log('xrbutton', btn); await pg.evaluate(() => document.getElementById('XRButton').click());
  try { await pg.waitForFunction(() => window.__xr.activeSession, { timeout: 60000 }); } catch (e) { console.log('no session', logs); throw e; }
  await new Promise((r) => setTimeout(r, 2500));
  await pg.evaluate((headH) => {
    __xr.position.set(0, headH, 0);
    const qm = (q) => { const { x, y, z, w } = q; return new DOMMatrix([1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]); };
    const headLocal = () => { const p = __xr.position; return new DOMMatrix().translate(p.x, p.y, p.z).multiply(qm(__xr.quaternion)); };
    const W = () => DOMMatrix.fromFloat32Array(new Float32Array(__house.cameraMatrix())).multiply(headLocal().inverse());
    const H = __house;
    window.T = {
      W,
      toLocal(p) { const r = W().inverse().transformPoint(new DOMPoint(p[0], p[1], p[2])); return [r.x, r.y, r.z]; },
      hand(side, p) { const l = T.toLocal(p); __xr.controllers[side].position.set(l[0], l[1], l[2]); },
      stick(side, x, y) { __xr.controllers[side].updateAxes('thumbstick', x, y); },
      btn(side, id, v) { __xr.controllers[side].updateButtonValue(id, v); },
      st: () => H.state(),
      yawTo(world) { // turn the emulated head so it faces world yaw `world` (0 = -Z, PI/2 = -X)
        const m = DOMMatrix.fromFloat32Array(new Float32Array(H.cameraMatrix())); const cur = Math.atan2(m.m31, m.m33);
        const d = world - cur; const q = __xr.quaternion; const h = d / 2; const c = Math.cos(h), sn = Math.sin(h);
        __xr.quaternion.set(q.x * c - q.z * sn, q.y * c + q.w * sn, q.z * c + q.x * sn, q.w * c - q.y * sn);
      },
      frames(n) { return new Promise((r) => { let k = 0; const f = () => { if (++k >= n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); },
      follow: null,
    };

  }, headH);
  const ev = (fn, ...a) => pg.evaluate(fn, ...a);
  return { pg, ev, logs, close: async () => { await b.close(); srv.close(); } };
}
