import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudLiteConfigured, cloudLiteProvider, cloudLiteReply } from './cloud-lite-provider.mjs';

const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export const cloudLiteCapabilities = Object.freeze({
  hermes: false, python: false, localModels: false, airTouch: false,
  desktop: false, agent: false, osiris: false, godsEye: false,
});

const blocked = Object.freeze([
  '/api/agent', '/api/agent-task', '/api/computer', '/api/desktop',
  '/api/integrations', '/api/ollama', '/api/self-update', '/api/transcribe', '/api/voicebox',
]);

export function isCloudLiteBlocked(pathname) { return blocked.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)); }
function allowedHost(host, port) { return host === `127.0.0.1:${port}` || host === `localhost:${port}`; }
function validMessages(value) { return Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim() && item.content.length <= 6000) && value.at(-1).role === 'user'; }

export async function createCloudLiteServer() {
  const token = randomBytes(32).toString('hex');
  return http.createServer(async (req, res) => {
    const port = req.socket.localPort;
    const origin = `http://${req.headers.host}`;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    if (!allowedHost(req.headers.host, port)) return send(403, { error: 'Host not allowed.' });
    if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-origin request blocked.' });
    let requestUrl;
    try { requestUrl = new URL(req.url, origin); } catch { return send(400, { error: 'Invalid URL.' }); }
    let pathname;
    try { pathname = decodeURIComponent(requestUrl.pathname); } catch { return send(400, { error: 'Invalid URL.' }); }
    if (isCloudLiteBlocked(pathname)) return send(404, { error: 'This capability is unavailable in Cloud Lite.' });
    if (req.method === 'GET' && pathname === '/api/session') {
      const provider = cloudLiteProvider(process.env);
      return send(200, { token, provider, route: 'direct', configured: cloudLiteConfigured(provider, process.env), edition: 'cloud-lite', capabilities: cloudLiteCapabilities, cameraReady: false, desktopReady: false, localSpeechReady: false, localSpeechError: 'Cloud Lite uses browser voice input.', voiceboxReady: false });
    }
    if (req.method === 'GET' && pathname === '/api/status') return send(200, { platform: os.platform(), cores: os.cpus().length, memoryTotal: os.totalmem(), memoryFree: os.freemem(), uptime: Math.floor(process.uptime()) });
    if (req.method === 'GET' && pathname === '/api/memory') return send(200, { memories: [], activities: [], conversations: [], transcripts: [], events: [] });
    if (req.method === 'POST' && pathname === '/api/chat') {
      const candidate = Buffer.from(String(req.headers['x-jarvis-token'] || ''));
      if (candidate.length !== token.length || !timingSafeEqual(candidate, Buffer.from(token))) return send(403, { error: 'Refresh the page to reconnect.' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON required.' });
      const chunks = []; let size = 0;
      try {
        for await (const chunk of req) { size += chunk.length; if (size > 32_000) return send(413, { error: 'Request too large.' }); chunks.push(chunk); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!validMessages(data.messages)) return send(400, { error: 'Invalid messages.' });
        return send(200, { reply: await cloudLiteReply(data.messages) });
      } catch (error) { return send(503, { error: error.message || 'Cloud provider unavailable.' }); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(404, { error: 'Not found.' });
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1), file = path.resolve(publicRoot, requested);
    if (!file.startsWith(publicRoot + path.sep) || !mime[path.extname(file)]) return send(404, { error: 'Not found.' });
    try {
      let bytes = await readFile(file);
      if (path.basename(file) === 'index.html') bytes = Buffer.from(bytes.toString('utf8').replace('</head>', '<link rel="stylesheet" href="/cloud-lite.css"></head>').replace('</body>', '<script type="module" src="/cloud-lite.js"></script></body>'));
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { send(404, { error: 'Not found.' }); }
  });
}
