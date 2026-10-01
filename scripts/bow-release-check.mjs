// node scripts/bow-release-check.mjs
// Headless regression check for the bow: a loosed arrow must leave the bow at every draw length and aim.
// Builds the real createGear() with DOM stubs, holds the bow in a fake XR controller that carries the
// same laser beam + dot meshes main.js setupController() adds, draws, releases and steps gear.update().
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} }) : (typeof k === 'string' ? () => {} : undefined) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.location = { search: process.env.QUERY || '' };
globalThis.window = { innerWidth: 800, innerHeight: 600, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const { createGear } = await import('../src/gear.js');
const tagControllers = process.argv[2] !== 'untagged'; // mirror main.js: controller.userData.noArrow = true
let shots = 0; let failures = 0; const fails = [];
for (const pitch of [-0.1, 0.3, 0.7, 1.1]) for (const pull of [0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.58]) for (const [dx, dy] of [[0, 0], [0.03, -0.05], [-0.02, -0.12], [0.06, 0.02], [0, -0.14]]) {
  const scene = new THREE.Scene();
  const targets = [];
  const roof = { y: 3.26, x: 1.85, z: 0, x0: 0.46, x1: 3.25, z0: -3.275, z1: 3.275, roomX1: 2.7, roomZ0: -2.7, roomZ1: 2.7 };
  const cave = { floor: -7.92, x1: 4.05, z: -1.925 };
  const gear = createGear(scene, new THREE.PerspectiveCamera(), targets, roof, cave, null, null);
  const makeController = () => {
    const c = new THREE.Group(); scene.add(c);
    if (tagControllers) c.userData.noArrow = true;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0014, 1, 8), new THREE.MeshBasicMaterial());
    beam.geometry.translate(0, 0.5, 0); beam.rotation.x = Math.PI / 2; beam.scale.y = 2.8; c.add(beam);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshBasicMaterial()); dot.position.set(0, 0, -2.8); c.add(dot);
    const grip = new THREE.Group(); scene.add(grip); c.userData.grip = grip;
    if (tagControllers) grip.userData.noArrow = true;
    return c;
  };
  const bowHand = makeController(); const drawHand = makeController();
  bowHand.position.set(-1.0, 1.35, 0);
  bowHand.rotation.set(pitch, Math.PI / 2, 0, 'YXZ');
  bowHand.userData.grip.position.copy(bowHand.position);
  scene.updateMatrixWorld(true);
  const bow = targets.find((t) => t.userData.gear === 'bow');
  gear.tryGrip(bowHand, [bow.getWorldPosition(new THREE.Vector3())], null);
  if (!bow.userData.carried) throw new Error('could not pick up the bow');
  scene.updateMatrixWorld(true);
  const put = (x, y, z) => { const p = new THREE.Vector3(x, y, z); bow.localToWorld(p); drawHand.position.copy(p); drawHand.userData.grip.position.copy(p); scene.updateMatrixWorld(true); };
  put(0, 0.04, 0.3);
  if (!gear.tryDraw(drawHand)) throw new Error('could not start the draw');
  put(dx, 0.04 + dy, 0.28 + pull);
  gear.update(1 / 72);
  gear.releaseDraw(drawHand);
  const arrow = scene.children.find((o) => o.userData.arrow && o.visible && o.userData.vel);
  if (!arrow) throw new Error(`pull ${pull} did not loose an arrow`);
  const start = arrow.position.clone();
  for (let i = 0; i < 20; i += 1) gear.update(1 / 72);
  shots += 1;
  if (arrow.userData.stuck && arrow.position.distanceTo(start) < 0.5) { failures += 1; fails.push({ pitch, pull, dx, dy }); }
}
console.log(`${shots} shots, ${failures} arrows stuck at the bow${tagControllers ? '' : ' (controllers untagged: negative control)'}`);
if (failures) { console.log(JSON.stringify(fails.slice(0, 8))); process.exit(1); }
