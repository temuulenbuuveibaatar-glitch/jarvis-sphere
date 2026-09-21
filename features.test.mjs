import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('local memory and reviewed channel actions stay bounded', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'jarvis-test-'));
  process.env.JARVIS_DATA_DIR = dataDir;
  const [{ createServer, validComputerAction }, { configuredWebhook }, memory] = await Promise.all([
      import(`./server.mjs?test=${Date.now()}`),
      import(`./communications.mjs?test=${Date.now()}`),
      import('./memory.mjs'),
    ]);
    assert.equal(validComputerAction({ action: 'slack_message', text: 'Ready.' }), true);
    assert.equal(validComputerAction({ action: 'discord_message', text: '' }), false);
    process.env.JARVIS_SLACK_WEBHOOK_URL = 'https://example.com/services/not-allowed';
    assert.throws(() => configuredWebhook('slack'), /Invalid slack webhook URL/);
    delete process.env.JARVIS_SLACK_WEBHOOK_URL;

    const server = createServer({ reply: async () => 'Ready.', desktop: { ready: false, send() {} }, transcriber: { ready: true, stop() {}, transcribe: async () => ({ transcript: 'Jarvis wake up' }) } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await (await fetch(`${base}/api/session`)).json();
    assert.equal(session.localSpeechReady, true);
    const headers = { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token };
    let response = await fetch(`${base}/api/memory`, { method: 'POST', headers, body: JSON.stringify({ action: 'remember', text: 'Use concise briefings.' }) });
    assert.equal(response.status, 200);
    response = await fetch(`${base}/api/memory`, { headers: { 'X-Jarvis-Token': session.token } });
    const stored = await response.json();
    assert.equal(stored.memories[0].text, 'Use concise briefings.');
    await new Promise(resolve => server.close(resolve));
  memory.closeMemoryStore();
});

test('desktop helper starts from its own process directory', async () => {
  const helperRoot = path.dirname(fileURLToPath(import.meta.url));
  const python = 'C:\\Hermes\\hermes-agent\\venv\\Scripts\\python.exe';
  const child = spawn(python, [path.join(helperRoot, 'desktop_control.py')], { cwd: helperRoot, stdio: ['pipe', 'pipe', 'ignore'] });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Desktop helper did not become ready.')), 2000);
    child.stdout.once('data', chunk => { clearTimeout(timer); resolve(chunk.toString('utf8')); });
    child.once('error', reject);
  });
  child.stdin.end();
  assert.match(ready, /"ready":true/);
});
