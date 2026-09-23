import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve('.');
test('vault SQLite migrates legacy memory, activity, and project records once', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'jarvis-store-'));
  const legacy = path.join(temp, 'legacy');
  const vault = path.join(temp, 'vault');
  mkdirSync(legacy, { recursive: true });
  const code = `import { DatabaseSync } from 'node:sqlite'; import path from 'node:path'; const legacy=process.env.JARVIS_LEGACY_DATA_DIR; let db=new DatabaseSync(path.join(legacy,'jarvis.sqlite')); db.exec(\"CREATE TABLE memories(id INTEGER PRIMARY KEY,text TEXT,created_at TEXT); CREATE TABLE activity(id INTEGER PRIMARY KEY,kind TEXT,summary TEXT,created_at TEXT);\"); db.prepare(\"INSERT INTO memories(text,created_at) VALUES (?,?)\").run('remember this','2026-01-01'); db.prepare(\"INSERT INTO activity(kind,summary,created_at) VALUES (?,?,?)\").run('conversation','hello','2026-01-01'); db.close(); db=new DatabaseSync(path.join(legacy,'jarvis-agent.sqlite')); db.exec(\"CREATE TABLE agent_projects(id INTEGER PRIMARY KEY,path TEXT,name TEXT,enabled INTEGER,last_summary TEXT,updated_at TEXT);\"); db.prepare(\"INSERT INTO agent_projects(path,name,enabled,last_summary,updated_at) VALUES (?,?,?,?,?)\").run('C:/registered','Registered',1,'clean','2026-01-01'); db.close(); const store=await import('./store.mjs'); const memory=await import('./memory.mjs'); const agent=await import('./agent.mjs'); if(store.databasePath!==path.join(process.env.JARVIS_OBSIDIAN_VAULT,'.jarvis','jarvis.sqlite')) throw new Error('bad vault path'); if(memory.memories()[0].text!=='remember this') throw new Error('memory not migrated'); if(agent.listProjects()[0].path!=='C:/registered') throw new Error('project not migrated');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: root, encoding: 'utf8', env: { ...process.env, JARVIS_OBSIDIAN_VAULT: vault, JARVIS_LEGACY_DATA_DIR: legacy } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
