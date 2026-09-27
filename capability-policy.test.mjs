import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessCommand, assessPath, minimalChildEnv, redactSecrets } from './capability-policy.mjs';

test('Windows policy allows user applications and blocks OS, boot, credentials, and devices', async () => {
  const env = { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Temuulen', APPDATA: 'C:\\Users\\Temuulen\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\Temuulen\\AppData\\Local' };
  assert.equal((await assessPath('C:\\Users\\Temuulen\\Projects\\app', { platform: 'win32', env })).allowed, true);
  assert.equal((await assessPath('C:\\Program Files\\Git\\bin\\git.exe', { platform: 'win32', env })).allowed, true);
  for (const target of ['C:\\Windows\\System32\\config\\SAM', 'C:\\EFI\\boot', 'C:\\System Volume Information', 'C:\\bootmgr', '\\\\.\\PhysicalDrive0', 'C:\\Users\\Temuulen\\.ssh\\id_ed25519', 'C:\\Users\\Temuulen\\AppData\\Roaming\\Microsoft\\Credentials\\item']) {
    assert.equal((await assessPath(target, { platform: 'win32', env })).allowed, false, target);
  }
});

test('macOS policy allows apps and user projects while protecting system and credentials', async () => {
  const options = { platform: 'darwin', home: '/Users/temuulen', cwd: '/Users/temuulen' };
  for (const target of ['/Applications/Xcode.app', '/Users/temuulen/Projects/app', '/usr/local/bin/node', '/Volumes/Work/app']) assert.equal((await assessPath(target, options)).allowed, true, target);
  for (const target of ['/System/Library/CoreServices', '/usr/bin/sudo', '/private/preboot', '/dev/rdisk1', '/Users/temuulen/Library/Keychains/login.keychain-db', '/Users/temuulen/.ssh/id_ed25519']) assert.equal((await assessPath(target, options)).allowed, false, target);
});

test('canonical resolution rejects a junction or symlink into a protected directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jarvis-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const protectedDir = path.join(root, 'protected'), link = path.join(root, 'ordinary-link');
  await mkdir(protectedDir);
  try { await symlink(protectedDir, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Creating links is disabled on this machine.'); throw error; }
  const result = await assessPath(path.join(link, 'new-file.txt'), { extraProtectedPaths: [protectedDir] });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /protected/i);
});

test('command policy blocks elevation, security controls, raw disks, and encoded shells', () => {
  const deniedWindows = [
    ['runas.exe', '/user:Administrator', 'cmd'],
    ['powershell.exe', '-EncodedCommand', 'YwBhAGwAYwA='],
    ['powershell', '-Command', 'Set-MpPreference -DisableRealtimeMonitoring $true'],
    ['netsh', 'advfirewall', 'set', 'allprofiles', 'state', 'off'],
    ['diskpart.exe'],
    ['cmd.exe', '/c', 'type', 'C:\\Windows\\System32\\config\\SAM'],
    ['powershell.exe', '-Command', 'Get-Content $env:SystemRoot\\System32\\config\\SYSTEM'],
    ['tool.exe', '\\\\.\\PhysicalDrive0']
  ];
  for (const command of deniedWindows) assert.equal(assessCommand(command, { platform: 'win32' }).allowed, false, command.join(' '));
  assert.equal(assessCommand(['git', '-C', 'C:\\Users\\Temuulen\\app', 'status'], { platform: 'win32' }).allowed, true);
  for (const command of [['sudo', 'rm', '-rf', '/tmp/x'], ['osascript', '-e', 'do shell script "x" with administrator privileges'], ['diskutil', 'eraseDisk', 'APFS', 'Empty', '/dev/disk2']]) assert.equal(assessCommand(command, { platform: 'darwin' }).allowed, false, command.join(' '));
  assert.equal(assessCommand(['swift', 'build'], { platform: 'darwin' }).allowed, true);
});

test('child environment is useful but excludes credentials', () => {
  const result = minimalChildEnv({ PATH: 'bin', HOME: '/home/me', OPENAI_API_KEY: 'secret', JARVIS_SLACK_TOKEN: 'secret', LANG: 'en_US.UTF-8' }, { PYTHONUTF8: '1' });
  assert.deepEqual(result, { PATH: 'bin', HOME: '/home/me', LANG: 'en_US.UTF-8', PYTHONUTF8: '1' });
  assert.throws(() => minimalChildEnv({}, { SERVICE_TOKEN: 'secret' }), /credential broker/);
});

test('redaction covers configured secrets, provider keys, authorization, webhooks, and objects', () => {
  const source = {
    message: 'Authorization: Bearer abc.def.ghi sk-test_1234567890 xoxb-1234567890-secret https://hooks.slack.com/services/A/B/C known-value',
    apiKey: 'visible-by-default',
    nested: ['password=hunter2', Buffer.from('client_secret=unsafe')]
  };
  const redacted = redactSecrets(source, { secrets: ['known-value'] });
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.ok(!redacted.message.includes('known-value'));
  assert.ok(!redacted.message.includes('sk-test'));
  assert.ok(!redacted.message.includes('xoxb-'));
  assert.ok(!redacted.message.includes('hooks.slack.com'));
  assert.equal(redacted.nested[0], 'password=[REDACTED]');
  assert.equal(redacted.nested[1].toString(), 'client_secret=[REDACTED]');
});

test('unattended Hermes jobs retain its non-interactive dangerous-command floor', async () => {
  const source = await readFile(new URL('./agent_runner.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]--yolo['"]/);
  assert.match(source, /assessCommand/);
});
