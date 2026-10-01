import * as THREE from 'three';
import { proxyMaterial } from './assets.js';

export function createSprayShared() {
  return {
    body: new THREE.CylinderGeometry(0.033, 0.033, 0.17, 16),
    band: new THREE.CylinderGeometry(0.0335, 0.0335, 0.09, 16),
    dome: new THREE.SphereGeometry(0.033, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    valve: new THREE.CylinderGeometry(0.008, 0.008, 0.018, 8),
    cap: new THREE.BoxGeometry(0.018, 0.016, 0.018),
    pick: new THREE.CylinderGeometry(0.04, 0.04, 0.24),
    metal: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.7, roughness: 0.35 }),
    guide: new THREE.ConeGeometry(1, 1, 16, 1, true),
  };
}

function quiet(mesh) {
  mesh.raycast = () => {};
  mesh.castShadow = true;
  return mesh;
}

export function createSprayCan(color, shared) {
  const group = new THREE.Group();
  const tint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
  const body = quiet(new THREE.Mesh(shared.body, shared.metal));
  body.position.y = 0.085;
  const band = quiet(new THREE.Mesh(shared.band, tint));
  band.position.y = 0.075;
  const dome = quiet(new THREE.Mesh(shared.dome, shared.metal));
  dome.position.y = 0.17;
  const valve = quiet(new THREE.Mesh(shared.valve, shared.metal));
  valve.position.y = 0.205;
  const cap = quiet(new THREE.Mesh(shared.cap, tint));
  cap.position.y = 0.215;
  const nozzle = new THREE.Object3D();
  nozzle.position.set(0, 0.216, -0.012);
  const guideMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  const guide = new THREE.Mesh(shared.guide, guideMat);
  guide.raycast = () => {};
  guide.rotation.x = Math.PI / 2;
  guide.visible = false;
  nozzle.add(guide);
  const pick = new THREE.Mesh(shared.pick, proxyMaterial);
  pick.position.y = 0.12;
  group.add(body, band, dome, valve, cap, nozzle, pick);
  group.userData = {
    type: 'gear',
    gear: 'spray',
    color,
    floorY: 0,
    houseY: 0,
    nozzle,
    guide,
    guideLeft: 0,
    cone: 0.12,
    reach: 1.2,
    rattled: false,
  };
  return group;
}

export function createSprayFx(scene) {
  const count = 8000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) positions[i * 3 + 1] = -50;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.0028,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.raycast = () => {};
  points.userData.noArrow = true;
  scene.add(points);
  const slots = Array.from({ length: count }, (_, index) => ({ index, life: 0 }));
  const live = [];
  let cursor = 0;
  const color = new THREE.Color();

  function emit(origin, direction, hex, speed, life, mist) {
    const particle = slots[cursor];
    cursor = (cursor + 1) % count;
    if (particle.life <= 0) live.push(particle);
    particle.age = 0;
    particle.life = life;
    particle.mist = mist;
    particle.vx = direction.x * speed;
    particle.vy = direction.y * speed - (mist ? 0.05 : 0.15);
    particle.vz = direction.z * speed;
    color.set(hex);
    particle.rgb = [color.r, color.g, color.b];
    positions[particle.index * 3] = origin.x;
    positions[particle.index * 3 + 1] = origin.y;
    positions[particle.index * 3 + 2] = origin.z;
    colors[particle.index * 3] = color.r;
    colors[particle.index * 3 + 1] = color.g;
    colors[particle.index * 3 + 2] = color.b;
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const particle = live[i];
      particle.age += dt;
      const index = particle.index;
      if (particle.age >= particle.life) {
        particle.life = 0;
        positions[index * 3 + 1] = -50;
        live.splice(i, 1);
        continue;
      }
      particle.vy -= (particle.mist ? 0.35 : 0.8) * dt;
      positions[index * 3] += particle.vx * dt;
      positions[index * 3 + 1] += particle.vy * dt;
      positions[index * 3 + 2] += particle.vz * dt;
      const fade = 1 - particle.age / particle.life;
      const scale = particle.mist ? fade : 0.45 + 0.55 * fade;
      colors[index * 3] = particle.rgb[0] * scale;
      colors[index * 3 + 1] = particle.rgb[1] * scale;
      colors[index * 3 + 2] = particle.rgb[2] * scale;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  return { emit, update };
}

export function sprayDirections(forward, cone, count) {
  const aim = forward.clone().normalize();
  const helper = Math.abs(aim.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(aim, helper).normalize();
  const up = new THREE.Vector3().crossVectors(right, aim).normalize();
  const directions = [];
  for (let i = 0; i < count; i += 1) {
    const angle = Math.sqrt(Math.random()) * cone;
    const spin = Math.random() * Math.PI * 2;
    directions.push(aim.clone()
      .addScaledVector(right, Math.cos(spin) * Math.sin(angle))
      .addScaledVector(up, Math.sin(spin) * Math.sin(angle))
      .normalize());
  }
  return directions;
}
