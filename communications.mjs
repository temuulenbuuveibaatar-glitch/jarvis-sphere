export function configuredWebhook(kind) {
  const raw = process.env[kind === 'slack' ? 'JARVIS_SLACK_WEBHOOK_URL' : 'JARVIS_DISCORD_WEBHOOK_URL'];
  if (!raw) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} webhook is not configured on this PC.`);
  const url = new URL(raw);
  const slack = kind === 'slack' && url.protocol === 'https:' && ['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname) && url.pathname.startsWith('/services/');
  const discord = kind === 'discord' && url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname) && /^\/api(?:\/v\d+)?\/webhooks\//.test(url.pathname);
  if (!slack && !discord) throw new Error(`Invalid ${kind} webhook URL.`);
  return url;
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
  const response = await fetch(configuredWebhook(kind), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'slack' ? { text: clean } : { content: clean }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} rejected the message.`);
  return { message: `Sent to the configured ${kind === 'slack' ? 'Slack channel' : 'Discord channel'}.` };
}
export function communicationStatus() {
  const valid = kind => { try { kind === 'telegram' ? telegramConfig() : configuredWebhook(kind); return true; } catch { return false; } };
  return { slack: valid('slack'), discord: valid('discord'), telegram: valid('telegram') };
}
