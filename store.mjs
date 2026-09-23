import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const vaultRoot = process.env.JARVIS_OBSIDIAN_VAULT || 'C:\\jarvis';
export const dataRoot = process.env.JARVIS_DATA_DIR || path.join(vaultRoot, '.jarvis');
mkdirSync(dataRoot, { recursive: true });
export const databasePath = path.join(dataRoot, 'jarvis.sqlite');
export const db = new DatabaseSync(databasePath);
db.exec(`PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, summary TEXT NOT NULL CHECK(length(summary) <= 2000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL DEFAULT 'default', role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS transcripts_conversation_created ON transcripts(conversation_id, id DESC);
  CREATE TABLE IF NOT EXISTS agent_projects (
    id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, instruction TEXT NOT NULL DEFAULT '', schedule_minutes INTEGER NOT NULL DEFAULT 0 CHECK(schedule_minutes BETWEEN 0 AND 10080),
    task_command TEXT NOT NULL DEFAULT '', deploy_command TEXT NOT NULL DEFAULT '', last_summary TEXT NOT NULL DEFAULT '',
    last_result TEXT NOT NULL DEFAULT '', last_run_at TEXT, next_run_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS agent_jobs (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES agent_projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')) DEFAULT 'queued',
    instruction TEXT NOT NULL DEFAULT '', started_at TEXT, finished_at TEXT, result TEXT NOT NULL DEFAULT '', deployment_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS agent_jobs_project_created ON agent_jobs(project_id, id DESC);
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, job_id INTEGER REFERENCES agent_jobs(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK(channel IN ('slack','discord')), event TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')) DEFAULT 'pending',
    detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS notifications_job_created ON notifications(job_id, id DESC);
  CREATE TABLE IF NOT EXISTS agent_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

function tableExists(database, table) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function importRows(file, table, columns, insert) {
  if (!existsSync(file) || path.resolve(file) === path.resolve(databasePath)) return;
  let legacy;
  try {
    legacy = new DatabaseSync(file, { readOnly: true });
    if (!tableExists(legacy, table)) return;
    const rows = legacy.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all();
    for (const row of rows) insert(row);
  } catch {
    // A corrupt legacy cache must never stop the desktop app from opening.
  } finally { try { legacy?.close(); } catch {} }
}

const legacyRoot = process.env.JARVIS_LEGACY_DATA_DIR || process.env.JARVIS_DATA_DIR || path.join(os.homedir(), '.jarvis-sphere');
const legacyMemory = path.join(legacyRoot, 'jarvis.sqlite');
const legacyAgent = path.join(legacyRoot, 'jarvis-agent.sqlite');
if (!db.prepare("SELECT 1 FROM agent_settings WHERE key='legacy_migration_v1'").get()) {
  db.exec('BEGIN');
  try {
    importRows(legacyMemory, 'memories', ['text','created_at'], row => db.prepare('INSERT OR IGNORE INTO memories(text,created_at) VALUES (?,?)').run(String(row.text).slice(0, 1000), row.created_at || new Date().toISOString()));
    importRows(legacyMemory, 'activity', ['kind','summary','created_at'], row => db.prepare('INSERT OR IGNORE INTO activity(kind,summary,created_at) VALUES (?,?,?)').run(String(row.kind).slice(0, 80), String(row.summary).slice(0, 2000), row.created_at || new Date().toISOString()));
    importRows(legacyAgent, 'agent_projects', ['path','name','enabled','last_summary','updated_at'], row => db.prepare('INSERT OR IGNORE INTO agent_projects(path,name,enabled,last_summary,updated_at) VALUES (?,?,?,?,?)').run(row.path, String(row.name).slice(0, 120), Number(row.enabled) ? 1 : 0, String(row.last_summary || '').slice(0, 4000), row.updated_at || new Date().toISOString()));
    db.prepare("INSERT INTO agent_settings(key,value) VALUES ('legacy_migration_v1','complete')").run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeStore() { db.close(); }

