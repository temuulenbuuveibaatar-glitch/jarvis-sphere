import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('Air Touch installer assets match the pinned local runtime and model', async () => {
  const [bundle, installedBundle, wasm, model] = await Promise.all([
    readFile('public/vendor/vision_bundle.mjs'),
    readFile('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'),
    readFile('public/vendor/wasm/vision_wasm_internal.wasm'),
    readFile('public/models/hand_landmarker.task')
  ]);
  assert.deepEqual(bundle, installedBundle);
  assert.ok(wasm.length > 1_000_000);
  assert.equal(createHash('sha256').update(model).digest('hex'), 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1');
});
