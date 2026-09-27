import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('spatial workspace accepts only bounded local model extensions', async () => {
  const source = await readFile(new URL('./public/spatial.js', import.meta.url), 'utf8');
  assert.match(source, /new Set\(\['glb', 'gltf', 'stl', '3mf'\]\)/);
  assert.match(source, /readAsArrayBuffer/);
  assert.doesNotMatch(source, /fetch\([^)]*file|fetch\([^)]*path/i);
});
