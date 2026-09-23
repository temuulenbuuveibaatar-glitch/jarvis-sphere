import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('registered project job stays in its folder and writes a daily report', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const vault = mkdtempSync(path.join(tmpdir(), 'jarvis-runner-vault-'));
  const project = mkdtempSync(path.join(tmpdir(), 'jarvis-runner-project-'));
  const proof = path.join(project, 'job-proof.txt');
  const script = `import { addProject, listJobs } from './agent.mjs'; import { runProjectJob } from './agent_runner.mjs'; const project=addProject(process.env.PROJECT,{taskCommand:'node -e "require(\\\'node:fs\\\').writeFileSync(\\\'job-proof.txt\\\',\\\'ok\\\')"'}); await runProjectJob(project.id); const job=listJobs(1)[0]; if(job.status!=='succeeded') throw new Error(job.result);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: root, encoding: 'utf8', env: { ...process.env, JARVIS_OBSIDIAN_VAULT: vault, PROJECT: project } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(proof, 'utf8'), 'ok');
  assert.equal(existsSync(path.join(vault, '01 Daily', `${new Date().toISOString().slice(0, 10)}.md`)), true);
  writeFileSync(path.join(project, 'outside.txt'), 'unchanged');
});
