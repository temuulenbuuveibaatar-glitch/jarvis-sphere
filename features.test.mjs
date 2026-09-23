import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

test('both interfaces use the local transcription endpoint and command launcher is wired', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const sphere = readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const command = readFileSync(path.join(root, 'public', 'command.html'), 'utf8');
  const commandScript = readFileSync(path.join(root, 'public', 'command.js'), 'utf8');
  assert.match(sphere, /startLocalVoice/);
  assert.match(sphere, /\$\('command'\)\.onclick/);
  assert.match(sphere, /frame\.getAttribute\('src'\)/);
  assert.doesNotMatch(sphere, /command\.css/);
  assert.match(sphere, /\['notes','Memory'\]/);
  assert.match(commandScript, /LOCAL VOICE/);
  assert.match(command, /<script src="\/command\.js"><\/script>/);
  assert.match(commandScript, /\/api\/transcribe/);
  assert.doesNotMatch(commandScript, /new SR\(/);
  const dashboard = readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(dashboard, /discord_message/);
  assert.ok(sphere.includes("if (/Electron\\//.test(navigator.userAgent))"));
  assert.match(sphere, /session\?\.localSpeechReady\) return startLocalVoice/);
});
test('transcription companion reports startup failures instead of claiming readiness', async () => {
  const { startTranscriptionCompanion } = await import(`./server.mjs?voice-test=${Date.now()}`);
  const companion = startTranscriptionCompanion({ executable: 'C:\\missing-python.exe' });
  assert.equal(companion.ready, false);
  assert.match(companion.error, /runtime is unavailable/i);
  await assert.rejects(() => companion.transcribe({ audio: '' }), /Local speech is unavailable/);
});

test('Obsidian vault is local, bounded, and cannot escape its root', async () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'jarvis-vault-'));
  process.env.JARVIS_OBSIDIAN_VAULT = vault;
  const obsidian = await import(`./obsidian.mjs?test=${Date.now()}`);
  assert.equal(obsidian.obsidianStatus().ready, true);
  assert.deepEqual(obsidian.appendObsidianNote('Jarvis/test.md', 'Private note.'), { path: 'Jarvis/test.md' });
  assert.match(obsidian.readObsidianNote('Jarvis/test.md').text, /Private note/);
  assert.throws(() => obsidian.appendObsidianNote('../escape.md', 'blocked'), /Obsidian path is outside the vault/);
  delete process.env.JARVIS_OBSIDIAN_VAULT;
});

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
    const command = await fetch(`${base}/command.html`);
    assert.match(command.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(session.localSpeechReady, true);
    const headers = { 'Content-Type': 'application/json', 'X-Jarvis-Token': session.token };
    let response = await fetch(`${base}/api/integrations`, { headers });
    assert.equal(response.status, 200);
    const integrations = await response.json();
    assert.equal(typeof integrations.local.osiris.ready, 'boolean');
    assert.equal(typeof integrations.local.godEye.ready, 'boolean');
    response = await fetch(`${base}/api/memory`, { method: 'POST', headers, body: JSON.stringify({ action: 'remember', text: 'Use concise briefings.' }) });
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

test('agent project tracking is explicitly scoped and Telegram remains credential-gated', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'jarvis-agent-data-'));
  const project = mkdtempSync(path.join(tmpdir(), 'jarvis-agent-project-'));
  process.env.JARVIS_DATA_DIR = dataDir;
  const agent = await import(`./agent.mjs?test=${Date.now()}`);
  const saved = agent.addProject(project);
  assert.equal(saved.path, project);
  assert.ok(agent.listProjects().some(item => item.path === project));
  assert.ok(agent.scanProjects().some(item => item.path === project));
  assert.throws(() => agent.addProject(path.parse(project).root), /drive root/);
  agent.removeProject(saved.id);
  const communications = await import(`./communications.mjs?test=${Date.now()}`);
  await assert.rejects(() => communications.sendChannelMessage('telegram', 'Hello.'), /Telegram bot token/);
  delete process.env.JARVIS_DATA_DIR;
});

