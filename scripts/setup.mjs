import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const modelPath = 'public/models/hand_landmarker.task';
const modelHash = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
const validModel = bytes => createHash('sha256').update(bytes).digest('hex') === modelHash;
await mkdir('public/vendor', { recursive: true });
await mkdir('public/models', { recursive: true });
await mkdir('public/vendor/three/addons/controls', { recursive: true });
await mkdir('public/vendor/three/addons/loaders', { recursive: true });
await mkdir('public/vendor/three/addons/libs', { recursive: true });
await mkdir('public/vendor/three/addons/utils', { recursive: true });
await copyFile('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'public/vendor/vision_bundle.mjs');
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/vendor/wasm', { recursive: true });
await copyFile('node_modules/three/build/three.module.js', 'public/vendor/three/three.module.js');
await copyFile('node_modules/three/examples/jsm/controls/OrbitControls.js', 'public/vendor/three/addons/controls/OrbitControls.js');
for (const file of ['GLTFLoader.js', 'STLLoader.js', '3MFLoader.js']) await copyFile('node_modules/three/examples/jsm/loaders/' + file, 'public/vendor/three/addons/loaders/' + file);
await copyFile('node_modules/three/examples/jsm/libs/fflate.module.js', 'public/vendor/three/addons/libs/fflate.module.js');
for (const file of ['BufferGeometryUtils.js', 'SkeletonUtils.js']) await copyFile('node_modules/three/examples/jsm/utils/' + file, 'public/vendor/three/addons/utils/' + file);
let bytes = await readFile(modelPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (!bytes || !validModel(bytes)) {
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (!validModel(bytes)) throw new Error('Hand model checksum changed; review the upstream version before updating.');
  await writeFile(modelPath, bytes);
}
console.log('Hand tracking assets installed locally. Camera frames stay in the browser.');
