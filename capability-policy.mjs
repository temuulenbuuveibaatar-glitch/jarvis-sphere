import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_FILE = fileURLToPath(import.meta.url);
const SAFE_ENV_KEYS = new Set([
  'ALLUSERSPROFILE', 'APPDATA', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432', 'COMPUTERNAME', 'COMSPEC', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LOCALAPPDATA', 'LOGNAME', 'NUMBER_OF_PROCESSORS',
  'OS', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'PROGRAMW6432', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP',
  'TMPDIR', 'USER', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR', 'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR'
]);
const SECRET_KEY = /(?:API|AUTH|BOT|CLIENT|CREDENTIAL|KEY|OAUTH|PASSWORD|PRIVATE|SECRET|SESSION|SIGNING|TOKEN|WEBHOOK)/i;

function pathApi(platform) { return platform === 'win32' ? path.win32 : path.posix; }
function expandPath(value, platform, env, home) {
  let result = String(value || '').trim();
  if (platform === 'win32') result = result.replace(/%([^%]+)%/g, (match, name) => env[name] ?? env[name.toUpperCase()] ?? match);
  else result = result.replace(/^~(?=\/|$)/, home);
  return result;
}
function normalized(candidate, { platform, cwd, env, home }) {
  const api = pathApi(platform);
  const expanded = expandPath(candidate, platform, env, home);
  if (!expanded || expanded.includes('\0')) throw new TypeError('Path must be a non-empty string without null bytes.');
  return api.normalize(api.resolve(cwd, expanded));
}
function comparable(value, platform) {
  const normalizedValue = pathApi(platform).normalize(value);
  return platform === 'win32' ? normalizedValue.toLowerCase() : normalizedValue;
}
function within(candidate, parent, platform) {
  const api = pathApi(platform), child = comparable(candidate, platform), root = comparable(parent, platform);
  const relative = api.relative(root, child);
  return relative === '' || (!relative.startsWith('..' + api.sep) && relative !== '..' && !api.isAbsolute(relative));
}
function windowsProtected(candidate, env) {
  const value = comparable(candidate, 'win32');
  if (/^(?:\\\\[.?]\\|\\device\\)/i.test(value)) return 'Raw device namespaces are protected.';
  const root = path.win32.parse(value).root;
  const relative = value.slice(root.length).replaceAll('/', '\\');
  const first = relative.split('\\')[0];
  if (['efi', 'recovery', 'system volume information', '$recycle.bin'].includes(first)) return 'Boot and volume metadata are protected.';
  if (!relative.includes('\\') && /^(?:bootmgr|bootnxt|bootstat\.dat|bootsect\.bak|ntldr|ntdetect\.com|hiberfil\.sys|pagefile\.sys|swapfile\.sys)$/i.test(relative)) return 'Boot and operating-system files are protected.';
  const windows = comparable(env.SystemRoot || env.SYSTEMROOT || env.WINDIR || 'C:\\Windows', 'win32');
  if (within(value, windows, 'win32')) return 'The Windows operating-system directory is protected.';
  const homes = [env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA].filter(Boolean);
  const credentialSuffixes = [
    ['.ssh'], ['.gnupg'], ['.aws'], ['.azure'], ['.kube'],
    ['Microsoft', 'Credentials'], ['Microsoft', 'Vault'], ['Microsoft', 'Protect']
  ];
  for (const base of homes) for (const suffix of credentialSuffixes) {
    const protectedPath = path.win32.join(base, ...suffix);
    if (within(value, protectedPath, 'win32')) return 'Credential stores are protected.';
  }
  return '';
}
function macProtected(candidate, home) {
  const value = path.posix.normalize(candidate);
  for (const root of ['/System', '/bin', '/sbin', '/private/preboot', '/private/var/db/SystemPolicyConfiguration', '/Library/Keychains', '/Library/Application Support/com.apple.TCC']) {
    if (within(value, root, 'darwin')) return 'Core macOS, recovery, or security data is protected.';
  }
  if (within(value, '/usr', 'darwin') && !within(value, '/usr/local', 'darwin')) return 'Protected macOS system tools are inaccessible.';
  if (/^\/dev\/(?:r?disk|mem|kmem)(?:\d|$)/.test(value)) return 'Raw disk and memory devices are protected.';
  for (const root of ['Library/Keychains', 'Library/Application Support/com.apple.TCC', '.ssh', '.gnupg', '.aws', '.azure', '.kube']) {
    if (within(value, path.posix.join(home, root), 'darwin')) return 'Credential stores are protected.';
  }
  return '';
}
function protectedReason(candidate, options) {
  const { platform, env, home, extraProtectedPaths } = options;
  const nativeReason = platform === 'win32' ? windowsProtected(candidate, env) : macProtected(candidate, home);
  if (nativeReason) return nativeReason;
  for (const root of extraProtectedPaths) if (within(candidate, normalized(root, options), platform)) return 'This path is protected by JARVIS policy.';
  if (platform === process.platform && within(candidate, POLICY_FILE, platform)) return 'The capability policy cannot modify itself.';
  return '';
}

async function canonicalPath(candidate, platform) {
  if (platform !== process.platform) return candidate;
  const api = pathApi(platform), tail = [];
  let current = candidate;
  while (true) {
    try {
      const resolved = await realpath(current);
      return api.join(resolved, ...tail.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = api.dirname(current);
      if (parent === current) return candidate;
      tail.push(api.basename(current));
      current = parent;
    }
  }
}

export async function assessPath(candidate, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || (platform === process.platform ? os.homedir() : platform === 'win32' ? env.USERPROFILE || 'C:\\Users\\User' : '/Users/user');
  const cwd = options.cwd || (platform === process.platform ? process.cwd() : home);
  const settings = { platform, env, home, cwd, extraProtectedPaths: options.extraProtectedPaths || [] };
  let requestedPath;
  try { requestedPath = normalized(candidate, settings); }
  catch (error) { return { allowed: false, reason: error.message, requestedPath: '', canonicalPath: '' }; }
  const lexicalReason = protectedReason(requestedPath, settings);
  if (lexicalReason) return { allowed: false, reason: lexicalReason, requestedPath, canonicalPath: requestedPath };
  let resolved;
  try { resolved = await canonicalPath(requestedPath, platform); }
  catch (error) { return { allowed: false, reason: `Path could not be resolved safely: ${error.message}`, requestedPath, canonicalPath: '' }; }
  const canonicalReason = protectedReason(resolved, settings);
  return { allowed: !canonicalReason, reason: canonicalReason, requestedPath, canonicalPath: resolved };
}

function commandText(command) { return command.map(value => String(value)).join(' ').toLowerCase(); }
export function assessCommand(command, options = {}) {
  const platform = options.platform || process.platform;
  if (!Array.isArray(command) || !command.length || command.length > 128 || command.some(part => typeof part !== 'string' || !part || part.length > 8192 || part.includes('\0'))) return { allowed: false, reason: 'Commands must be a bounded executable-and-arguments array.' };
  const executable = pathApi(platform).basename(command[0]).toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, '');
  const text = commandText(command);
  const argumentsText = command.slice(1).map(value => String(value).toLowerCase()).join(' ');
  const elevation = platform === 'win32'
    ? executable === 'runas' || /(?:start-process\b[^\r\n]*\s-verb\s+runas|shell(?:execute)?\([^)]*runas|elevate(?:\.exe)?\b)/i.test(text)
    : ['sudo', 'doas', 'pkexec'].includes(executable) || (executable === 'osascript' && /administrator privileges/i.test(text));
  if (elevation) return { allowed: false, reason: 'Privilege elevation and permission bypass are prohibited.' };
  if (/\\\\[.?]\\physicaldrive|\\device\\harddisk|\/dev\/(?:r?disk\d*|mem|kmem)\b/i.test(text)) return { allowed: false, reason: 'Raw disk, volume, and memory access is prohibited.' };
  if (platform === 'win32') {
    if (/(?:[a-z]:\\windows(?:\\|\b)|%windir%|%systemroot%|\$env:(?:windir|systemroot)|\\(?:efi|recovery|system volume information)(?:\\|\b)|\\(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube)(?:\\|\b))/i.test(argumentsText)) return { allowed: false, reason: 'Commands cannot access protected operating-system or credential paths.' };
    if (['diskpart', 'bcdedit', 'bootsect', 'reagentc', 'manage-bde', 'pnputil', 'devcon'].includes(executable)) return { allowed: false, reason: 'Boot, disk, driver, and recovery controls are protected.' };
    if (executable === 'powershell' || executable === 'pwsh') {
      if (/\s-(?:enc|encodedcommand)\b/i.test(' ' + text)) return { allowed: false, reason: 'Encoded shell commands are not accepted.' };
      if (/\b(?:set|add|remove)-(?:mppreference|netfirewall|localuser|localgroupmember)\b|\bdisable-windowsoptionalfeature\b/i.test(text)) return { allowed: false, reason: 'Security and account controls are protected.' };
    }
    if (executable === 'netsh' && /\badvfirewall\b/i.test(text)) return { allowed: false, reason: 'Firewall controls are protected.' };
    if (executable === 'reg' && /\b(?:add|delete|import|load|restore|save|unload)\b[\s\S]*\b(?:hklm|hkey_local_machine)\\(?:sam|security|system)\b/i.test(text)) return { allowed: false, reason: 'Protected registry hives cannot be modified.' };
  } else {
    if (/(?:^|\s)(?:\/system|\/bin|\/sbin|\/private\/preboot|\/library\/keychains)(?:\/|\s|$)|(?:^|\s)~?\/(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube)(?:\/|\s|$)/i.test(argumentsText)) return { allowed: false, reason: 'Commands cannot access protected operating-system or credential paths.' };
    if (executable === 'csrutil' || executable === 'spctl' || executable === 'kmutil' || executable === 'kextload' || executable === 'kextunload') return { allowed: false, reason: 'macOS security and kernel controls are protected.' };
    if (executable === 'diskutil' && /\b(?:erase(?:disk|volume)?|partition(?:disk)?|apfs\s+(?:delete|resize)|secureerase)\b/i.test(text)) return { allowed: false, reason: 'Disk erase and partition operations are prohibited.' };
    if (executable === 'security' && /\b(?:delete-keychain|delete-generic-password|delete-internet-password|set-keychain-settings)\b/i.test(text)) return { allowed: false, reason: 'Credential stores are protected.' };
  }
  return { allowed: true, reason: '' };
}

export function minimalChildEnv(source = process.env, additions = {}) {
  const result = {};
  for (const [key, value] of Object.entries(source)) if (SAFE_ENV_KEYS.has(key.toUpperCase()) && value !== undefined) result[key] = String(value);
  for (const [key, value] of Object.entries(additions)) {
    if (SECRET_KEY.test(key)) throw new Error(`Secret-like environment variable ${key} must use the credential broker.`);
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || value === undefined) throw new Error(`Invalid child environment variable ${key}.`);
    result[key] = String(value);
  }
  return result;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function redactString(input, secrets) {
  let output = String(input);
  for (const secret of [...new Set(secrets.map(String).filter(value => value.length >= 4))].sort((a, b) => b.length - a.length)) output = output.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  return output
    .replace(/\b(?:xox[a-z]-[a-z0-9-]{10,}|sk-[a-z0-9_-]{12,})\b/gi, '[REDACTED]')
    .replace(/https:\/\/(?:hooks\.slack\.com\/services|(?:canary\.)?discord(?:app)?\.com\/api\/webhooks)\/[^\s"']+/gi, '[REDACTED]')
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer|bot)\s+[^\s,"']+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|auth[_-]?token|bot[_-]?token|client[_-]?secret|password|private[_-]?key|secret|session[_-]?token|webhook[_-]?url)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]');
}

export function redactSecrets(value, options = {}) {
  const secrets = options.secrets || [];
  const seen = new WeakMap();
  const visit = current => {
    if (typeof current === 'string') return redactString(current, secrets);
    if (Buffer.isBuffer(current)) return Buffer.from(redactString(current.toString('utf8'), secrets));
    if (!current || typeof current !== 'object') return current;
    if (seen.has(current)) return seen.get(current);
    const copy = Array.isArray(current) ? [] : {};
    seen.set(current, copy);
    for (const [key, item] of Object.entries(current)) copy[key] = SECRET_KEY.test(key) ? '[REDACTED]' : visit(item);
    return copy;
  };
  return visit(value);
}
