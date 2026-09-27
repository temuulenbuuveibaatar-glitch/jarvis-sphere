import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { SelfUpdateManager } from './self_update.mjs';

function command(cwd, ...args) {
  const result = spawnSync(args.shift(), args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-self-update-repo-'));
  command(root, 'git', 'init');
  command(root, 'git', 'config', 'user.email', 'jarvis@example.invalid');
  command(root, 'git', 'config', 'user.name', 'JARVIS Test');
  writeFileSync(path.join(root, 'app.mjs'), 'export const version = 1;\n');
  writeFileSync(path.join(root, 'capability-policy.mjs'), 'export const protectedPolicy = true;\n');
  writeFileSync(path.join(root, 'self_update.mjs'), 'export const rollbackController = true;\n');
  command(root, 'git', 'add', '.');
  command(root, 'git', 'commit', '-m', 'base');
  return root;
}

function hooks(failure) {
  return Object.fromEntries(['unit', 'security', 'browser', 'package', 'migration', 'startup', 'health'].map(name => [name, {
    command: process.execPath,
    args: ['-e', name === failure ? 'process.exit(7)' : 'process.exit(0)'],
  }]));
}

function database(file) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE memory(value TEXT); INSERT INTO memory VALUES (\'kept\')');
  db.close();
}

test('candidate verification uses a copied database and keeps two rollback builds', async () => {
  const repoRoot = repository();
  const stateDir = mkdtempSync(path.join(tmpdir(), 'jarvis-self-update-state-'));
  const canonicalDatabase = path.join(stateDir, 'live.sqlite');
  database(canonicalDatabase);
  const updater = new SelfUpdateManager({ repoRoot, stateDir: path.join(stateDir, 'updates'), canonicalDatabase });

  const first = updater.prepareCandidate({ id: 'candidate-one' });
  writeFileSync(path.join(first.worktree, 'app.mjs'), 'export const version = 2;\n');
  await updater.activateCandidate(first.id, { checks: hooks() });
  assert.equal(updater.active().candidateId, first.id);
  const copied = new DatabaseSync(path.join(first.runtimeRoot, 'vault', '.jarvis', 'jarvis.sqlite'), { readOnly: true });
  assert.equal(copied.prepare('SELECT value FROM memory').get().value, 'kept');
  copied.close();

  const second = updater.prepareCandidate({ id: 'candidate-two' });
  writeFileSync(path.join(second.worktree, 'app.mjs'), 'export const version = 3;\n');
  await updater.activateCandidate(second.id, { checks: hooks() });
  assert.deepEqual(updater.manifest().workingBuilds.map(item => item.id), [second.id, first.id]);
  assert.equal(updater.rollback().candidateId, first.id);
});

test('protected changes and failed health never replace the active pointer', async () => {
  const repoRoot = repository();
  const stateDir = mkdtempSync(path.join(tmpdir(), 'jarvis-self-update-failure-'));
  const updater = new SelfUpdateManager({ repoRoot, stateDir: path.join(stateDir, 'updates') });
  const working = updater.prepareCandidate({ id: 'working-one' });
  writeFileSync(path.join(working.worktree, 'app.mjs'), 'export const version = 2;\n');
  await updater.activateCandidate(working.id, { checks: hooks() });

  const protectedCandidate = updater.prepareCandidate({ id: 'protected-one' });
  writeFileSync(path.join(protectedCandidate.worktree, 'capability-policy.mjs'), 'export const protectedPolicy = false;\n');
  await assert.rejects(() => updater.activateCandidate(protectedCandidate.id, { checks: hooks() }), /protected update or policy files/);
  assert.equal(updater.active().candidateId, working.id);

  const migrationFailure = updater.prepareCandidate({ id: 'migration-failure' });
  writeFileSync(path.join(migrationFailure.worktree, 'app.mjs'), 'export const version = 3;\n');
  await assert.rejects(() => updater.activateCandidate(migrationFailure.id, { checks: hooks('migration') }), /Command failed/);
  assert.equal(updater.active().candidateId, working.id);

  const unhealthy = updater.prepareCandidate({ id: 'unhealthy-one' });
  writeFileSync(path.join(unhealthy.worktree, 'app.mjs'), 'export const version = 3;\n');
  await assert.rejects(() => updater.activateCandidate(unhealthy.id, { checks: hooks('health') }), /Command failed/);
  assert.equal(updater.active().candidateId, working.id);
});
