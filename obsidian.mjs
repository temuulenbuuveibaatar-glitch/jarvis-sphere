import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// The portable default keeps JARVIS notes in the local-first vault the desktop setup creates.
const vaultRoot = path.resolve(process.env.JARVIS_OBSIDIAN_VAULT || (process.platform === 'win32' ? 'C:\\jarvis' : path.join(os.homedir(), 'jarvis')));

function notePath(value) {
  if (typeof value !== 'string' || !value || value.length > 180 || !/^[a-zA-Z0-9 _./-]+\.md$/.test(value)) throw new Error('Invalid Obsidian note path.');
  const file = path.resolve(vaultRoot, value);
  if (!file.startsWith(vaultRoot + path.sep)) throw new Error('Obsidian path is outside the vault.');
  return file;
}

function walk(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return walk(path.join(directory, entry.name), relative);
    return entry.isFile() && entry.name.endsWith('.md') ? [relative.replaceAll('\\', '/')] : [];
  });
}

export function obsidianStatus() {
  mkdirSync(vaultRoot, { recursive: true });
  return { ready: true, vault: vaultRoot, notes: walk(vaultRoot).slice(0, 100) };
}

export function readObsidianNote(relative) {
  const file = notePath(relative);
  if (!statSync(file, { throwIfNoEntry: false })) throw new Error('Obsidian note was not found.');
  return { path: relative.replaceAll('\\', '/'), text: readFileSync(file, 'utf8').slice(0, 30000) };
}

export function appendObsidianNote(relative, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Invalid Obsidian note text.');
  const file = notePath(relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${statSync(file, { throwIfNoEntry: false }) ? '\n\n' : ''}${text.trim()}\n`, { encoding: 'utf8', flag: 'a' });
  return { path: relative.replaceAll('\\', '/') };
}
