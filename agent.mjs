import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { db } from './store.mjs';

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
function configValue(value, length = 4000) { return String(value || '').trim().slice(0, length); }
function projectRow(row) { return { ...row, enabled: Boolean(row.enabled), scheduleMinutes: Number(row.schedule_minutes || 0), taskCommand: row.task_command || '', deployCommand: row.deploy_command || '', lastSummary: row.last_summary || '', lastResult: row.last_result || '', lastRunAt: row.last_run_at || null, nextRunAt: row.next_run_at || null, updatedAt: row.updated_at }; }

export function addProject(value, config = {}) {
  const folder = safeProjectPath(value), details = projectSummary(folder);
  const instruction = configValue(config.instruction), schedule = Math.max(0, Math.min(10080, Number(config.scheduleMinutes) || 0));
  const taskCommand = configValue(config.taskCommand), deployCommand = configValue(config.deployCommand);
  db.prepare(`INSERT INTO agent_projects(path,name,instruction,schedule_minutes,task_command,deploy_command,last_summary,next_run_at) VALUES(?,?,?,?,?,?,?,CASE WHEN ? > 0 THEN datetime('now', '+' || ? || ' minutes') ELSE NULL END) ON CONFLICT(path) DO UPDATE SET enabled=1,name=excluded.name,instruction=CASE WHEN excluded.instruction<>'' THEN excluded.instruction ELSE agent_projects.instruction END,schedule_minutes=excluded.schedule_minutes,task_command=excluded.task_command,deploy_command=excluded.deploy_command,last_summary=excluded.last_summary,next_run_at=excluded.next_run_at,updated_at=CURRENT_TIMESTAMP`).run(folder, details.name, instruction, schedule, taskCommand, deployCommand, details.summary, schedule, schedule);
  return getProject(db.prepare('SELECT id FROM agent_projects WHERE path=?').get(folder).id);
}
export function listProjects() { return db.prepare('SELECT * FROM agent_projects ORDER BY updated_at DESC LIMIT 100').all().map(projectRow); }
export function getProject(id) { const row = db.prepare('SELECT * FROM agent_projects WHERE id=?').get(Number(id)); return row ? projectRow(row) : null; }
export function updateProject(id, config = {}) {
  const existing = getProject(id); if (!existing) throw new Error('Project was not found.');
  const schedule = Object.hasOwn(config, 'scheduleMinutes') ? Math.max(0, Math.min(10080, Number(config.scheduleMinutes) || 0)) : existing.scheduleMinutes;
  const instruction = Object.hasOwn(config, 'instruction') ? configValue(config.instruction) : existing.instruction;
  const taskCommand = Object.hasOwn(config, 'taskCommand') ? configValue(config.taskCommand) : existing.taskCommand;
  const deployCommand = Object.hasOwn(config, 'deployCommand') ? configValue(config.deployCommand) : existing.deployCommand;
  const enabled = Object.hasOwn(config, 'enabled') ? (config.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
  db.prepare(`UPDATE agent_projects SET instruction=?,schedule_minutes=?,task_command=?,deploy_command=?,enabled=?,next_run_at=CASE WHEN ? > 0 AND ?=1 THEN datetime('now', '+' || ? || ' minutes') ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(instruction, schedule, taskCommand, deployCommand, enabled, schedule, enabled, schedule, Number(id));
  return getProject(id);
}
export function scanProjects() {
  const rows = db.prepare('SELECT id,path,name,last_summary FROM agent_projects WHERE enabled=1 ORDER BY id').all();
  return rows.map(row => { const details = projectSummary(row.path), changed = details.summary !== row.last_summary; db.prepare('UPDATE agent_projects SET name=?,last_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(details.name, details.summary, row.id); return { ...row, ...details, changed }; });
}
export function removeProject(id) { return db.prepare('DELETE FROM agent_projects WHERE id=?').run(Number(id)).changes === 1; }
export function dueProjects() { return db.prepare("SELECT * FROM agent_projects WHERE enabled=1 AND schedule_minutes>0 AND next_run_at IS NOT NULL AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at LIMIT 8").all().map(projectRow); }
export function markProjectRun(id, result = '') { const project = getProject(id); if (!project) return null; db.prepare("UPDATE agent_projects SET last_run_at=CURRENT_TIMESTAMP,last_result=?,next_run_at=CASE WHEN schedule_minutes>0 THEN datetime('now', '+' || schedule_minutes || ' minutes') ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(configValue(result, 12000), Number(id)); return getProject(id); }
export function setKillSwitch(enabled) { setAgentSetting('kill_switch', enabled ? '1' : '0'); return Boolean(enabled); }
export function queueProjectJob(projectId, instruction = '') { const project = getProject(projectId); if (!project) throw new Error('Project was not found.'); const result = db.prepare('INSERT INTO agent_jobs(project_id,instruction) VALUES(?,?)').run(project.id, configValue(instruction || project.instruction)); return getJob(Number(result.lastInsertRowid)); }
export function getJob(id) { return db.prepare(`SELECT j.id,j.project_id AS projectId,j.status,j.instruction,j.started_at AS startedAt,j.finished_at AS finishedAt,j.result,j.deployment_url AS deploymentUrl,j.created_at AS createdAt,p.name AS projectName,p.path AS projectPath FROM agent_jobs j JOIN agent_projects p ON p.id=j.project_id WHERE j.id=?`).get(Number(id)) || null; }
export function listJobs(limit = 100) { return db.prepare(`SELECT j.id,j.project_id AS projectId,j.status,j.instruction,j.started_at AS startedAt,j.finished_at AS finishedAt,j.result,j.deployment_url AS deploymentUrl,j.created_at AS createdAt,p.name AS projectName,p.path AS projectPath FROM agent_jobs j JOIN agent_projects p ON p.id=j.project_id ORDER BY j.id DESC LIMIT ?`).all(Math.max(1, Math.min(Number(limit) || 100, 500))); }
export function updateJob(id, status, result = '', deploymentUrl = '') { if (!['queued','running','succeeded','failed','cancelled'].includes(status)) throw new Error('Invalid job status.'); db.prepare(`UPDATE agent_jobs SET status=?,result=?,deployment_url=?,started_at=CASE WHEN ?='running' THEN CURRENT_TIMESTAMP ELSE started_at END,finished_at=CASE WHEN ? IN ('succeeded','failed','cancelled') THEN CURRENT_TIMESTAMP ELSE finished_at END WHERE id=?`).run(status, configValue(result, 12000), configValue(deploymentUrl, 2000), status, status, Number(id)); return getJob(id); }
export function recordNotification(jobId, channel, event, status = 'pending', detail = '') { if (!['slack','discord'].includes(channel) || !['pending','sent','failed'].includes(status)) throw new Error('Invalid notification.'); return Number(db.prepare('INSERT INTO notifications(job_id,channel,event,status,detail) VALUES(?,?,?,?,?)').run(Number(jobId) || null, channel, configValue(event, 80), status, configValue(detail, 2000)).lastInsertRowid); }
export function notifications(limit = 100) { return db.prepare('SELECT id,job_id AS jobId,channel,event,status,detail,created_at AS createdAt FROM notifications ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(Number(limit) || 100, 500))); }
export function setAgentSetting(key, value) { db.prepare('INSERT INTO agent_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP').run(configValue(key, 80), configValue(value, 4000)); }
export function agentSetting(key, fallback = '') { return db.prepare('SELECT value FROM agent_settings WHERE key=?').get(configValue(key, 80))?.value ?? fallback; }
export function agentStatus() { return { killSwitch: agentSetting('kill_switch', '0') === '1', projectCount: Number(db.prepare('SELECT COUNT(*) AS count FROM agent_projects').get().count), queuedJobs: Number(db.prepare("SELECT COUNT(*) AS count FROM agent_jobs WHERE status IN ('queued','running')").get().count) }; }
