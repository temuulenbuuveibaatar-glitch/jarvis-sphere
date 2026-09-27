import { app, BrowserWindow, shell, session } from 'electron';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudLiteConfigured, cloudLiteProvider } from './cloud-lite-provider.mjs';

let server;
const runtimeFile = path.join(app.getPath('userData'), 'jarvis-cloud-lite-runtime.json');

async function createWindow() {
  process.env.JARVIS_EDITION = 'cloud-lite';
  process.env.JARVIS_PROVIDER = cloudLiteProvider();
  const { createCloudLiteServer } = await import('./cloud-lite-server.mjs');
  server = await createCloudLiteServer();
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  await writeFile(runtimeFile, JSON.stringify({ port, pid: process.pid, edition: 'cloud-lite' }), { mode: 0o600 });
  const window = new BrowserWindow({ width: 1320, height: 860, minWidth: 900, minHeight: 640, backgroundColor: '#030609', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    try { callback(permission === 'media' && new URL(webContents.getURL()).hostname === '127.0.0.1'); } catch { callback(false); }
  });
  if (!cloudLiteConfigured(cloudLiteProvider())) console.warn('JARVIS Cloud Lite needs a Gemini, OpenRouter, or Bytez environment key.');
  await createWindow();
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { server?.close(); rm(runtimeFile, { force: true }).catch(() => {}); });
