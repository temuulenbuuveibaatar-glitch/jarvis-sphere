export function configuredWebhook(kind) {
  const raw = process.env[kind === 'slack' ? 'JARVIS_SLACK_WEBHOOK_URL' : 'JARVIS_DISCORD_WEBHOOK_URL'];
  if (!raw) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} webhook is not configured on this PC.`);
  const url = new URL(raw);
  const slack = kind === 'slack' && url.protocol === 'https:' && ['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname) && url.pathname.startsWith('/services/');
  const discord = kind === 'discord' && url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname) && /^\/api(?:\/v\d+)?\/webhooks\//.test(url.pathname);
  if (!slack && !discord) throw new Error(`Invalid ${kind} webhook URL.`);
  return url;
}
export async function sendChannelMessage(kind, text) {
  const clean = String(text || '').trim();
  if (!clean || clean.length > 1900) throw new Error('Message must contain 1–1,900 characters.');
  const body = kind === 'slack' ? { text: clean } : { content: clean };
  const response = await fetch(configuredWebhook(kind), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${kind === 'slack' ? 'Slack' : 'Discord'} rejected the message.`);
  return { message: `Sent to the configured ${kind === 'slack' ? 'Slack channel' : 'Discord channel'}.` };
}
export function communicationStatus() {
  const valid = kind => { try { configuredWebhook(kind); return true; } catch { return false; } };
  return { slack: valid('slack'), discord: valid('discord') };
}
