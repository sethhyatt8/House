import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libs = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');
const jobs = [
  ['draco/gltf/draco_decoder.js', 'public/decoders/draco/draco_decoder.js'],
  ['draco/gltf/draco_decoder.wasm', 'public/decoders/draco/draco_decoder.wasm'],
  ['draco/gltf/draco_wasm_wrapper.js', 'public/decoders/draco/draco_wasm_wrapper.js'],
  ['basis/basis_transcoder.js', 'public/decoders/basis/basis_transcoder.js'],
  ['basis/basis_transcoder.wasm', 'public/decoders/basis/basis_transcoder.wasm'],
];

for (const [from, to] of jobs) {
  const dest = join(root, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(libs, from), dest);
}
