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
export async function sendChannelMessage(kind, text) {
  const clean = String(text || '').trim();
  if (!clean || clean.length > 1900) throw new Error('Message must contain 1–1,900 characters.');
  if (kind === 'telegram') {
    const { token, chatId } = telegramConfig();
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: clean, disable_web_page_preview: true }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Telegram rejected the message.');
    return { message: 'Sent to the configured Telegram chat.' };
  }
  const api = apiConfig(kind);
  if (api?.token) {
    const endpoint = kind === 'slack' ? 'https://slack.com/api/chat.postMessage' : `https://discord.com/api/v10/channels/${api.channel}/messages`;
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: kind === 'slack' ? `Bearer ${api.token}` : `Bot ${api.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'slack' ? { channel: api.channel, text: clean } : { content: clean }), signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (kind === 'slack' && payload.ok === false)) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} API rejected the message.`);
    return { message: `Sent through the configured ${kind === 'slack' ? 'Slack' : 'Discord'} API.` };
  }
  const response = await fetch(configuredWebhook(kind), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'slack' ? { text: clean } : { content: clean }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} rejected the message.`);
  return { message: `Sent to the configured ${kind === 'slack' ? 'Slack channel' : 'Discord channel'}.` };
}
export function communicationStatus() {
  const valid = kind => { try { if (kind === 'telegram') telegramConfig(); else if (!apiConfig(kind)) configuredWebhook(kind); return true; } catch { return false; } };
  return { slack: valid('slack'), discord: valid('discord'), telegram: valid('telegram'), slackMode: apiConfig('slack') ? 'api' : 'webhook', discordMode: apiConfig('discord') ? 'api' : 'webhook' };
}
