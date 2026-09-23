import { app, BrowserWindow, shell, session } from 'electron';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

let server;
const runtimeFile = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'jarvis-sphere-runtime.json');
const workerMode = process.argv.includes('--agent-worker');
async function startServer() {
  const { createServer } = await import('./server.mjs');
  return new Promise((resolve, reject) => {
    server = createServer(); server.requestTimeout = 15000; server.headersTimeout = 10000;
    server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
async function createWindow() {
  process.env.JARVIS_OBSIDIAN_VAULT ||= 'C:\\jarvis';
  process.env.JARVIS_DATA_DIR ||= 'C:\\jarvis\\.jarvis';
  const port = await startServer();
  await writeFile(runtimeFile, JSON.stringify({ port, pid: process.pid }), { mode: 0o600 });
  const window = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 680, backgroundColor: '#030609', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadURL(`http://127.0.0.1:${port}`);
}
app.whenReady().then(async () => {
  if (workerMode) {
    process.env.JARVIS_OBSIDIAN_VAULT ||= 'C:\\jarvis';
    const { runDueProjectJobs } = await import('./agent_runner.mjs');
    await runDueProjectJobs();
    app.quit();
    return;
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    try { callback(permission === 'media' && new URL(webContents.getURL()).hostname === '127.0.0.1'); }
    catch { callback(false); }
  });
  await createWindow();
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { server?.close(); rm(runtimeFile, { force: true }).catch(() => {}); });
