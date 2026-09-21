import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const dataDir = process.env.JARVIS_DATA_DIR || path.join(os.homedir(), '.jarvis-sphere');
const db = new DatabaseSync(path.join(dataDir, 'jarvis-agent.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS agent_projects (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

function safeProjectPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 260) throw new Error('Choose a project folder.');
  const resolved = path.resolve(value.trim());
  if (resolved === path.parse(resolved).root || !existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error('Choose an existing project folder, not a drive root.');
  return resolved;
}
function projectSummary(folder) {
  const packagePath = path.join(folder, 'package.json');
  let name = path.basename(folder), packageName = '';
  try { packageName = JSON.parse(readFileSync(packagePath, 'utf8')).name || ''; } catch {}
  if (packageName) name = packageName;
  let git = 'not a Git repository';
  try { git = execFileSync('git', ['-C', folder, 'status', '--short', '--branch'], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim().slice(0, 400) || 'clean working tree'; } catch {}
  let entries = 0;
  try { entries = readdirSync(folder, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.')).length; } catch {}
  return { name: String(name).slice(0, 120), summary: `${git}\n${entries} visible top-level items` };
}
export function addProject(value) {
  const folder = safeProjectPath(value), details = projectSummary(folder);
  db.prepare('INSERT INTO agent_projects(path,name,last_summary) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET enabled=1,name=excluded.name,last_summary=excluded.last_summary,updated_at=CURRENT_TIMESTAMP').run(folder, details.name, details.summary);
  return { path: folder, ...details };
}
export function listProjects() {
  return db.prepare('SELECT id,path,name,enabled,last_summary AS lastSummary,updated_at AS updatedAt FROM agent_projects ORDER BY updated_at DESC LIMIT 20').all();
}
export function scanProjects() {
  const rows = db.prepare('SELECT id,path,name,last_summary AS lastSummary FROM agent_projects WHERE enabled=1 ORDER BY id').all();
  return rows.map(row => {
    const details = projectSummary(row.path), changed = details.summary !== row.lastSummary;
    db.prepare('UPDATE agent_projects SET name=?,last_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(details.name, details.summary, row.id);
    return { ...row, ...details, changed };
  });
}
export function removeProject(id) { return db.prepare('DELETE FROM agent_projects WHERE id=?').run(Number(id)).changes === 1; }

