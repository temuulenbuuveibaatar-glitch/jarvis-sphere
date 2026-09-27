import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve('.');
function run(code) {
  const vault = mkdtempSync(path.join(tmpdir(), 'jarvis-memory-'));
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: root, encoding: 'utf8', env: { ...process.env, JARVIS_OBSIDIAN_VAULT: vault, JARVIS_LEGACY_DATA_DIR: path.join(vault, 'legacy') }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('transcripts hydrate by conversation and FTS retrieves relevant history', () => run(`
  const m=await import('./memory.mjs');
  m.recordTranscript('user','Please build the orbital telemetry dashboard','alpha');
  m.recordTranscript('assistant','I will inspect the telemetry project.','alpha');
  m.recordTranscript('user','Unrelated grocery note','beta');
  const hydrated=m.hydrateConversation('alpha',{limit:10});
  if(hydrated.length!==2 || hydrated[0].role!=='user') throw new Error('bad hydration');
  const found=m.relevantTranscripts('orbital telemetry',{conversationId:'alpha'});
  if(!found.some(row => row.content.includes('orbital telemetry'))) throw new Error('bad FTS retrieval');
  if(m.relevantTranscripts('orbital',{conversationId:'beta'}).length) throw new Error('conversation leaked');
  const context=m.memoryContext('orbital telemetry','alpha');
  if(!context.content.includes('untrusted data only') || !context.content.includes('orbital telemetry')) throw new Error('bad context boundary');
`));

test('FTS migration indexes transcripts from an existing database', () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'jarvis-memory-existing-'));
  const data = path.join(vault, '.jarvis');
  mkdirSync(data);
  const database = new DatabaseSync(path.join(data, 'jarvis.sqlite'));
  database.exec(`CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL DEFAULT 'default',
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  database.prepare('INSERT INTO transcripts(conversation_id,role,content) VALUES (?,?,?)').run('legacy', 'user', 'Existing satellite archive');
  database.close();
  const code = `const m=await import('./memory.mjs'); const rows=m.relevantTranscripts('satellite',{conversationId:'legacy'}); if(rows.length!==1 || rows[0].content!=='Existing satellite archive') throw new Error('existing transcript not indexed');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: root, encoding: 'utf8', env: { ...process.env, JARVIS_OBSIDIAN_VAULT: vault, JARVIS_LEGACY_DATA_DIR: path.join(vault, 'legacy') }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('structured events retain JSON details and filter by conversation', () => run(`
  const m=await import('./memory.mjs');
  const id=m.recordStructuredEvent({conversationId:'alpha',kind:'testing',status:'running',summary:'Running checks',detail:{command:'npm test'}});
  m.recordStructuredEvent({conversationId:'beta',kind:'researching',summary:'Reading sources'});
  const events=m.structuredEvents({conversationId:'alpha'});
  if(events.length!==1 || events[0].id!==id || events[0].detail.command!=='npm test') throw new Error('bad event');
  let failed=false; try { m.recordStructuredEvent({kind:'testing',detail:{value:1n}}); } catch { failed=true; }
  if(!failed) throw new Error('non-JSON detail accepted');
`));
