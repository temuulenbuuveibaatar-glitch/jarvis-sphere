import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { minimalChildEnv } from './capability-policy.mjs';
import path from 'node:path';

const npm = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const definitions = Object.freeze({
  osiris: { name: 'OSIRIS', cwd: process.env.JARVIS_OSIRIS_HOME || path.join(os.homedir(), 'Projects', 'osiris'), port: 3000, args: ['run', 'dev', '--', '-p', '3000'] },
  godEye: { name: "GOD'S EYE", cwd: process.env.JARVIS_GODS_EYE_HOME || path.join(os.homedir(), 'Projects', 'gods-eye-view'), port: 4173, args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'] },
});
const processes = new Map();

function definition(id) {
  const value = definitions[id];
  if (!value) throw new Error('Unknown local integration.');
  return value;
}
async function ready(value, timeout = 900) {
  try { return (await fetch(`http://127.0.0.1:${value.port}/`, { redirect: 'error', signal: AbortSignal.timeout(timeout) })).ok; }
  catch { return false; }
}
function stopRecord(id) {
  const record = processes.get(id);
  if (!record) return;
  processes.delete(id);
  if (record.child.killed) return;
  if (process.platform === 'win32' && record.child.pid) spawn('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else record.child.kill('SIGTERM');
}
export async function integrationStatus() {
  const result = {};
  for (const [id, value] of Object.entries(definitions)) {
    const record = processes.get(id);
    result[id] = { name: value.name, ready: await ready(value), managed: Boolean(record), pid: record?.child.pid || null, error: record?.error || '' };
  }
  return result;
}
export async function startIntegration(id) {
  const value = definition(id);
  for (const other of processes.keys()) if (other !== id) stopRecord(other);
  if (await ready(value)) return { id, ready: true, url: `http://127.0.0.1:${value.port}/`, managed: processes.has(id) };
  if (!existsSync(value.cwd)) throw new Error(`${value.name} is not installed at ${value.cwd}.`);
  let record = processes.get(id);
  if (!record) {
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...value.args] : value.args;
    const child = spawn(npm, args, { cwd: value.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: minimalChildEnv(process.env, { BROWSER: 'none' }) });
    record = { child, error: '', output: '' }; processes.set(id, record);
    const collect = chunk => { record.output = `${record.output}${chunk}`.slice(-8000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { record.error = error.message; });
    child.on('close', code => { if (processes.get(id) === record) { record.error ||= `${value.name} stopped (${code}).`; processes.delete(id); } });
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await ready(value, 1200)) return { id, ready: true, url: `http://127.0.0.1:${value.port}/`, managed: true };
    if (!processes.has(id)) throw new Error(record.error || `${value.name} stopped during startup.`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  stopRecord(id);
  throw new Error(`${value.name} did not become ready within 30 seconds.${record.output ? `\n${record.output.slice(-1000)}` : ''}`);
}
export function stopIntegration(id) { definition(id); stopRecord(id); return { id, stopped: true }; }
export function stopAllIntegrations() { for (const id of [...processes.keys()]) stopRecord(id); }
