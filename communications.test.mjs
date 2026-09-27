import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function reset() {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}

function response(ok = true, payload = { ok: true }) { return { ok, json: async () => payload }; }
async function moduleFor(name) { return import(`./communications.mjs?${name}=${Date.now()}-${Math.random()}`); }

test.afterEach(reset);

test('stale Slack bridge is ignored and API messages redact configured secrets', async () => {
  const local = mkdtempSync(path.join(os.tmpdir(), 'jarvis-slack-stale-'));
  const runtime = path.join(local, 'jarvis-slack-runtime.json');
  writeFileSync(runtime, JSON.stringify({ port: 4319, token: 'a'.repeat(64) }));
  const old = new Date(Date.now() - 11 * 60_000);
  utimesSync(runtime, old, old);
  process.env.LOCALAPPDATA = local;
  process.env.JARVIS_SLACK_BOT_TOKEN = `xoxb-${'s'.repeat(32)}`;
  process.env.JARVIS_SLACK_CHANNEL_ID = 'C123456789';
  process.env.JARVIS_DISCORD_BOT_TOKEN = 'd'.repeat(40);
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return response(); };
  const communications = await moduleFor('stale');
  await communications.sendChannelMessage('slack', `done ${process.env.JARVIS_DISCORD_BOT_TOKEN}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
  assert.equal(JSON.parse(calls[0].options.body).text, 'done [REDACTED]');
  assert.equal(communications.communicationStatus().slackMode, 'api');
});

test('dead fresh Slack listener falls back to the configured API', async () => {
  const local = mkdtempSync(path.join(os.tmpdir(), 'jarvis-slack-dead-'));
  writeFileSync(path.join(local, 'jarvis-slack-runtime.json'), JSON.stringify({ port: 4319, token: 'b'.repeat(64) }));
  process.env.LOCALAPPDATA = local;
  process.env.JARVIS_SLACK_BOT_TOKEN = `xoxb-${'s'.repeat(32)}`;
  process.env.JARVIS_SLACK_CHANNEL_ID = 'C123456789';
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (calls.length === 1) throw new Error('connect ECONNREFUSED secret');
    return response();
  };
  const communications = await moduleFor('dead');
  const result = await communications.sendChannelMessage('slack', 'Build completed.');
  assert.deepEqual(calls, ['http://127.0.0.1:4319/message', 'https://slack.com/api/chat.postMessage']);
  assert.match(result.message, /Slack API/);
});

test('Discord voice announcement uses only the loopback bridge', async () => {
  process.env.JARVIS_DISCORD_VOICE_BRIDGE_PORT = '4322';
  process.env.JARVIS_DISCORD_VOICE_BRIDGE_TOKEN = 'c'.repeat(64);
  process.env.JARVIS_DISCORD_VOICE_CHANNEL_ID = '123456789012345678';
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return response(); };
  const communications = await moduleFor('voice');
  const result = await communications.announceWithTextFallback('Task completed.');
  assert.equal(result.channel, 'discord-voice');
  assert.equal(calls[0].url, 'http://127.0.0.1:4322/announce');
  assert.deepEqual(JSON.parse(calls[0].options.body), { channel_id: '123456789012345678', text: 'Task completed.' });
});

test('failed Discord voice announcement falls back to configured Discord text', async () => {
  process.env.JARVIS_DISCORD_VOICE_BRIDGE_PORT = '4322';
  process.env.JARVIS_DISCORD_VOICE_BRIDGE_TOKEN = 'c'.repeat(64);
  process.env.JARVIS_DISCORD_VOICE_CHANNEL_ID = '123456789012345678';
  process.env.JARVIS_DISCORD_BOT_TOKEN = 'd'.repeat(40);
  process.env.JARVIS_DISCORD_CHANNEL_ID = '223456789012345678';
  const calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); return calls.length === 1 ? response(false) : response(true, {}); };
  const communications = await moduleFor('fallback');
  const result = await communications.announceWithTextFallback('Task completed.');
  assert.equal(result.channel, 'discord');
  assert.deepEqual(calls, ['http://127.0.0.1:4322/announce', 'https://discord.com/api/v10/channels/223456789012345678/messages']);
});
