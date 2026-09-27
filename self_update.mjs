import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assessCommand, minimalChildEnv, redactSecrets } from './capability-policy.mjs';

export const REQUIRED_UPDATE_CHECKS = ['unit', 'security', 'browser', 'package', 'migration', 'startup', 'health'];

const protectedCandidatePaths = [
  /^capability-policy(?:\.test)?\.mjs$/i,
  /^self[_-]update(?:\.test)?\.mjs$/i,
  /^scripts\/self-update-/i,
];

function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function run(command, args, options = {}) {
  if (!command || typeof command !== 'string' || !Array.isArray(args)) throw new Error('Update hooks require a command and argument array.');
  const policy = assessCommand([command, ...args]);
  if (!policy.allowed) throw new Error(`Update command blocked: ${policy.reason}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || minimalChildEnv(process.env),
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: options.timeoutMs || 15 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = redactSecrets(`${result.stdout || ''}\n${result.stderr || ''}`).trim().slice(-4000);
    const label = redactSecrets(`${command} ${args.join(' ')}`);
    throw new Error(`Command failed (${result.status}): ${label}${output ? `\n${output}` : ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim().slice(-4000);
}

function git(cwd, ...args) {
  return run('git', args, { cwd, timeoutMs: 60_000 });
}

function cleanId(value = randomUUID()) {
  const id = String(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{5,63}$/.test(id)) throw new Error('Candidate id must be 6-64 lowercase letters, numbers, or hyphens.');
  return id;
}

function candidateChanges(candidate) {
  const tracked = git(candidate.worktree, 'diff', '--name-only', candidate.baseCommit, '--');
  const untracked = git(candidate.worktree, 'ls-files', '--others', '--exclude-standard');
  return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).map(value => value.trim().replaceAll('\\', '/')).filter(Boolean))];
}

export function assertCandidatePolicyIntact(candidate) {
  const blocked = candidateChanges(candidate).filter(file => protectedCandidatePaths.some(pattern => pattern.test(file)));
  if (blocked.length) throw new Error(`Candidate changed protected update or policy files: ${blocked.join(', ')}`);
  return true;
}

export class SelfUpdateManager {
  constructor({ repoRoot = process.cwd(), stateDir, canonicalDatabase } = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.stateDir = path.resolve(stateDir || path.join(os.homedir(), '.jarvis', 'updates'));
    this.canonicalDatabase = canonicalDatabase ? path.resolve(canonicalDatabase) : null;
    if (this.stateDir === this.repoRoot || this.stateDir.startsWith(`${this.repoRoot}${path.sep}`)) {
      throw new Error('Self-update state must live outside the source repository.');
    }
    this.manifestFile = path.join(this.stateDir, 'manifest.json');
    this.activeFile = path.join(this.stateDir, 'active-build.json');
    mkdirSync(this.stateDir, { recursive: true });
  }

  manifest() {
    return readJson(this.manifestFile, { schemaVersion: 1, candidates: [], workingBuilds: [], activeCandidateId: null });
  }

  active() {
    return readJson(this.activeFile, null);
  }

  #saveCandidate(candidate) {
    const manifest = this.manifest();
    manifest.candidates = [candidate, ...manifest.candidates.filter(item => item.id !== candidate.id)].slice(0, 50);
    atomicJson(this.manifestFile, manifest);
  }

  #candidate(id) {
    const candidate = this.manifest().candidates.find(item => item.id === id);
    if (!candidate) throw new Error(`Unknown update candidate: ${id}`);
    return candidate;
  }

  prepareCandidate({ id, baseRef = 'HEAD' } = {}) {
    const candidateId = cleanId(id);
    const baseCommit = git(this.repoRoot, 'rev-parse', `${baseRef}^{commit}`);
    const branch = `codex/self-update-${candidateId}`;
    const worktree = path.join(this.stateDir, 'worktrees', candidateId);
    if (existsSync(worktree)) throw new Error(`Candidate worktree already exists: ${worktree}`);
    mkdirSync(path.dirname(worktree), { recursive: true });
    git(this.repoRoot, 'worktree', 'add', '-b', branch, worktree, baseCommit);
    const runtimeRoot = path.join(this.stateDir, 'runtime', candidateId);
    const candidate = {
      id: candidateId,
      branch,
      baseCommit,
      worktree,
      buildPath: worktree,
      runtimeRoot,
      status: 'prepared',
      createdAt: new Date().toISOString(),
      checks: {},
    };
    this.#saveCandidate(candidate);
    return candidate;
  }

  async #runtime(candidate) {
    const vault = path.join(candidate.runtimeRoot, 'vault');
    const data = path.join(vault, '.jarvis');
    const database = path.join(data, 'jarvis.sqlite');
    rmSync(candidate.runtimeRoot, { recursive: true, force: true });
    mkdirSync(data, { recursive: true });
    if (this.canonicalDatabase && existsSync(this.canonicalDatabase)) {
      const source = new DatabaseSync(this.canonicalDatabase, { readOnly: true });
      try { await backup(source, database); }
      finally { source.close(); }
    }
    return {
      vault,
      data,
      database,
      env: minimalChildEnv(process.env, {
        JARVIS_OBSIDIAN_VAULT: vault,
        JARVIS_DATA_DIR: data,
        JARVIS_UPDATE_CANDIDATE: candidate.id,
        JARVIS_UPDATE_DRY_RUN: '1',
      }),
    };
  }

  async activateCandidate(id, { checks, buildPath } = {}) {
    let candidate = this.#candidate(cleanId(id));
    if (!checks || REQUIRED_UPDATE_CHECKS.some(name => !checks[name])) {
      throw new Error(`All update checks are required: ${REQUIRED_UPDATE_CHECKS.join(', ')}`);
    }
    const resolvedBuildPath = path.resolve(buildPath || candidate.buildPath);
    const allowedBuildRoots = [path.resolve(candidate.worktree), path.join(this.stateDir, 'builds', candidate.id)];
    if (!existsSync(resolvedBuildPath) || !allowedBuildRoots.some(root => resolvedBuildPath === root || resolvedBuildPath.startsWith(`${root}${path.sep}`))) {
      throw new Error('Candidate build must exist inside its worktree or candidate build directory.');
    }
    const previous = this.active();
    try {
      assertCandidatePolicyIntact(candidate);
      const runtime = await this.#runtime(candidate);
      candidate = { ...candidate, status: 'verifying', runtime: { vault: runtime.vault, database: runtime.database } };
      this.#saveCandidate(candidate);
      for (const name of REQUIRED_UPDATE_CHECKS.filter(name => name !== 'health')) {
        const hook = checks[name];
        const started = Date.now();
        run(hook.command, hook.args || [], {
          cwd: candidate.worktree,
          env: { ...runtime.env, ...minimalChildEnv({}, hook.env || {}) },
          timeoutMs: hook.timeoutMs,
        });
        candidate.checks[name] = { ok: true, durationMs: Date.now() - started };
        assertCandidatePolicyIntact(candidate);
      }

      const pointer = {
        schemaVersion: 1,
        candidateId: candidate.id,
        buildPath: resolvedBuildPath,
        activatedAt: new Date().toISOString(),
        previousCandidateId: previous?.candidateId || null,
      };
      atomicJson(this.activeFile, pointer);
      try {
        const health = checks.health;
        const started = Date.now();
        run(health.command, health.args || [], {
          cwd: candidate.worktree,
          env: { ...runtime.env, ...minimalChildEnv({}, { JARVIS_ACTIVE_BUILD: pointer.buildPath, ...(health.env || {}) }) },
          timeoutMs: health.timeoutMs,
        });
        candidate.checks.health = { ok: true, durationMs: Date.now() - started };
        assertCandidatePolicyIntact(candidate);
      } catch (error) {
        if (previous) atomicJson(this.activeFile, previous);
        else rmSync(this.activeFile, { force: true });
        throw error;
      }

      candidate = { ...candidate, status: 'working', buildPath: pointer.buildPath, verifiedAt: new Date().toISOString() };
      const manifest = this.manifest();
      manifest.candidates = [candidate, ...manifest.candidates.filter(item => item.id !== candidate.id)].slice(0, 50);
      manifest.workingBuilds = [
        { id: candidate.id, buildPath: candidate.buildPath, verifiedAt: candidate.verifiedAt },
        ...manifest.workingBuilds.filter(item => item.id !== candidate.id),
      ].slice(0, 2);
      manifest.activeCandidateId = candidate.id;
      atomicJson(this.manifestFile, manifest);
      return pointer;
    } catch (error) {
      candidate = { ...candidate, status: 'failed', error: String(error.message || error).slice(0, 1000), failedAt: new Date().toISOString() };
      this.#saveCandidate(candidate);
      throw error;
    }
  }

  rollback() {
    const active = this.active();
    const manifest = this.manifest();
    const target = manifest.workingBuilds.find(item => item.id !== active?.candidateId);
    if (!target) throw new Error('No previous verified build is available.');
    const pointer = {
      schemaVersion: 1,
      candidateId: target.id,
      buildPath: target.buildPath,
      activatedAt: new Date().toISOString(),
      previousCandidateId: active?.candidateId || null,
      rollback: true,
    };
    atomicJson(this.activeFile, pointer);
    manifest.activeCandidateId = target.id;
    manifest.workingBuilds = [target, ...manifest.workingBuilds.filter(item => item.id !== target.id)].slice(0, 2);
    atomicJson(this.manifestFile, manifest);
    return pointer;
  }
}
