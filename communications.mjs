import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './capability-policy.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const RUNTIME_MAX_AGE_MS = 10 * 60_000;

export function configuredWebhook(kind) {
  const raw = process.env[kind === 'slack' ? 'JARVIS_SLACK_WEBHOOK_URL' : 'JARVIS_DISCORD_WEBHOOK_URL'];
  if (!raw) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} webhook is not configured on this PC.`);
  const url = new URL(raw);
  const slack = kind === 'slack' && url.protocol === 'https:' && ['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname) && url.pathname.startsWith('/services/');
  const discord = kind === 'discord' && url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname) && /^\/api(?:\/v\d+)?\/webhooks\//.test(url.pathname);
  if (!slack && !discord) throw new Error(`Invalid ${kind} webhook URL.`);
  return url;
}

function apiConfig(kind) {
  if (kind === 'slack') {
    const token = process.env.JARVIS_SLACK_BOT_TOKEN || process.env.JARVIS_SLACK_ACCESS_TOKEN;
    const channel = process.env.JARVIS_SLACK_CHANNEL_ID;
    if (token && channel && /^(?:xox[baprs]-|xoxe\.)/.test(token) && /^[A-Z0-9_-]+$/i.test(channel)) return { token, channel };
  }
  if (kind === 'discord') {
    const token = process.env.JARVIS_DISCORD_BOT_TOKEN;
    const channel = process.env.JARVIS_DISCORD_CHANNEL_ID;
    if (token && channel && token.length >= 30 && /^\d{10,}$/.test(channel)) return { token, channel };
  }
  return null;
}

function telegramConfig() {
  const token = process.env.JARVIS_TELEGRAM_BOT_TOKEN, chatId = process.env.JARVIS_TELEGRAM_CHAT_ID;
  if (!token || !chatId || !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token) || !/^-?\d+$/.test(chatId)) throw new Error('Telegram bot token or chat ID is not configured on this PC.');
  return { token, chatId };
}

function configuredSecrets() {
  return [
    'JARVIS_SLACK_BOT_TOKEN', 'JARVIS_SLACK_ACCESS_TOKEN', 'JARVIS_SLACK_WEBHOOK_URL',
    'JARVIS_DISCORD_BOT_TOKEN', 'JARVIS_DISCORD_WEBHOOK_URL', 'JARVIS_DISCORD_VOICE_BRIDGE_TOKEN',
    'JARVIS_TELEGRAM_BOT_TOKEN'
  ].map(name => process.env[name]).filter(Boolean);
}

function cleanMessage(text, limit = 1900) {
  const clean = String(text || '').trim();
  if (!clean || clean.length > limit) throw new Error(`Message must contain 1–${limit.toLocaleString('en-US')} characters.`);
  return redactSecrets(clean, { secrets: configuredSecrets() });
}

function runtimeAlive(config) {
  if (!Number.isInteger(config.pid) || config.pid <= 0) return false;
  try { process.kill(config.pid, 0); return true; } catch { return false; }
}

function slackBridgeConfig() {
  try {
    const runtimePath = path.join(process.env.LOCALAPPDATA || '', 'jarvis-slack-runtime.json');
    const config = JSON.parse(readFileSync(runtimePath, 'utf8'));
    const fresh = Date.now() - statSync(runtimePath).mtimeMs <= RUNTIME_MAX_AGE_MS || runtimeAlive(config);
    if (fresh && Number.isInteger(config.port) && config.port > 0 && config.port <= 65535 && /^[a-f0-9]{64}$/.test(config.token)) return config;
  } catch {}
  return null;
}

function discordVoiceConfig() {
  const port = Number(process.env.JARVIS_DISCORD_VOICE_BRIDGE_PORT);
  const token = process.env.JARVIS_DISCORD_VOICE_BRIDGE_TOKEN;
  const channel = process.env.JARVIS_DISCORD_VOICE_CHANNEL_ID;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/i.test(token || '') || !/^\d{10,}$/.test(channel || '')) return null;
  return { port, token, channel };
}

async function postSlackBridge(bridge, text) {
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': bridge.token },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    return response.ok;
  } catch { return false; }
}

export async function sendChannelMessage(kind, text) {
  const clean = cleanMessage(text);
  if (kind === 'telegram') {
    const { token, chatId } = telegramConfig();
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: clean, disable_web_page_preview: true }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error('Telegram rejected the message.');
    return { message: 'Sent to the configured Telegram chat.' };
  }
  if (!['slack', 'discord'].includes(kind)) throw new Error('Unsupported communication channel.');
  const bridge = kind === 'slack' && slackBridgeConfig();
  if (bridge && await postSlackBridge(bridge, clean)) return { message: 'Sent through the local JARVIS Slack app.' };
  const api = apiConfig(kind);
  if (api?.token) {
    const endpoint = kind === 'slack' ? 'https://slack.com/api/chat.postMessage' : `https://discord.com/api/v10/channels/${api.channel}/messages`;
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: kind === 'slack' ? `Bearer ${api.token}` : `Bot ${api.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'slack' ? { channel: api.channel, text: clean } : { content: clean }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (kind === 'slack' && payload.ok === false)) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} API rejected the message.`);
    return { message: `Sent through the configured ${kind === 'slack' ? 'Slack' : 'Discord'} API.` };
  }
  const response = await fetch(configuredWebhook(kind), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'slack' ? { text: clean } : { content: clean }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} rejected the message.`);
  return { message: `Sent to the configured ${kind === 'slack' ? 'Slack channel' : 'Discord channel'}.` };
}

export async function announceToDiscordVoice(text) {
  const config = discordVoiceConfig();
  if (!config) throw new Error('Discord voice bridge is not configured on this PC.');
  const clean = cleanMessage(text, 600);
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/announce`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': config.token },
      body: JSON.stringify({ channel_id: config.channel, text: clean }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch { throw new Error('Discord voice bridge is unavailable.'); }
  if (!response.ok) throw new Error('Discord voice bridge rejected the announcement.');
  return { message: 'Announced in the configured Discord voice channel.' };
}

export async function announceWithTextFallback(text, order = ['discord', 'slack', 'telegram']) {
  try { return { channel: 'discord-voice', ...(await announceToDiscordVoice(text)) }; } catch {}
  for (const channel of order) {
    if (!['discord', 'slack', 'telegram'].includes(channel)) continue;
    try { return { channel, ...(await sendChannelMessage(channel, text)) }; } catch {}
  }
  throw new Error('No configured communication channel accepted the announcement.');
}

export function communicationStatus() {
  const bridge = slackBridgeConfig(), voice = discordVoiceConfig();
  const valid = kind => { try { if (kind === 'slack' && bridge) return true; if (kind === 'telegram') telegramConfig(); else if (!apiConfig(kind)) configuredWebhook(kind); return true; } catch { return false; } };
  return {
    slack: valid('slack'), discord: valid('discord'), telegram: valid('telegram'), discordVoice: Boolean(voice),
    slackMode: bridge ? 'local-app' : apiConfig('slack') ? 'api' : 'webhook', discordMode: apiConfig('discord') ? 'api' : 'webhook'
  };
}
