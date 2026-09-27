import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cloudLiteCapabilities, createCloudLiteServer, isCloudLiteBlocked } from './cloud-lite-server.mjs';
import { cloudLiteConfigured, cloudLiteProvider, cloudLiteReply } from './cloud-lite-provider.mjs';

test('Cloud Lite disables every local and heavy capability', async () => {
  assert.ok(Object.values(cloudLiteCapabilities).every(value => value === false));
  for (const path of ['/api/agent', '/api/agent-task/1', '/api/computer', '/api/desktop', '/api/integrations', '/api/ollama', '/api/self-update', '/api/transcribe', '/api/voicebox']) assert.equal(isCloudLiteBlocked(path), true, path);
  assert.equal(isCloudLiteBlocked('/api/chat'), false);
  const config = await readFile(new URL('./electron-builder.cloud-lite.yml', import.meta.url), 'utf8');
  assert.match(config, /appId: com\.jarvis\.cloudlite/); assert.match(config, /main: cloud-lite-main\.mjs/); assert.match(config, /!\*\.py/); assert.match(config, /!node_modules\/@mediapipe/);
  assert.doesNotMatch(await readFile(new URL('./cloud-lite-server.mjs', import.meta.url), 'utf8'), /from ['"]\.\/server\.mjs['"]/);
});

test('Cloud Lite provider uses direct configured cloud APIs', async () => {
  assert.equal(cloudLiteProvider({ GEMINI_API_KEY: 'x' }), 'gemini');
  assert.equal(cloudLiteProvider({ OPENROUTER_API_KEY: 'x' }), 'openrouter');
  assert.equal(cloudLiteConfigured('openrouter', { OPENROUTER_API_KEY: 'x' }), false);
  const before = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /generativelanguage\.googleapis\.com/);
    assert.equal(options.headers['x-goog-api-key'], 'secret');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Ready.' }] } }] }) };
  };
  try { assert.equal(await cloudLiteReply([{ role: 'user', content: 'Hello' }], undefined, { JARVIS_PROVIDER: 'gemini', GEMINI_API_KEY: 'secret' }), 'Ready.'); }
  finally { globalThis.fetch = before; }
});

test('Cloud Lite server reports its edition and rejects local endpoints', async () => {
  const provider = process.env.JARVIS_PROVIDER, key = process.env.GEMINI_API_KEY;
  process.env.JARVIS_PROVIDER = 'gemini'; process.env.GEMINI_API_KEY = 'test-key';
  const server = await createCloudLiteServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await (await fetch(`${base}/api/session`)).json();
    assert.equal(session.edition, 'cloud-lite'); assert.deepEqual(session.capabilities, cloudLiteCapabilities);
    assert.equal((await fetch(`${base}/api/integrations`)).status, 404);
    assert.equal((await fetch(`${base}/api/agent-task`)).status, 404);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (provider === undefined) delete process.env.JARVIS_PROVIDER; else process.env.JARVIS_PROVIDER = provider;
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
  }
});
