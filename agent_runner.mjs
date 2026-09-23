import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { appendObsidianNote } from './obsidian.mjs';
import { communicationStatus, sendChannelMessage } from './communications.mjs';
import { agentSetting, dueProjects, getProject, getJob, markProjectRun, queueProjectJob, recordNotification, setAgentSetting, updateJob } from './agent.mjs';

const hermes = process.env.JARVIS_HERMES_COMMAND || 'C:\\Hermes\\bin\\hermes.exe';
let active = false;

function args(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map(part => part.replace(/^"|"$/g, '')) || [];
  if (!parts.length || parts.length > 20 || parts.some(part => !part || part.length > 512)) throw new Error('Task commands must be a short command with arguments.');
  return parts;
}
function run(executable, values, cwd, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, values, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [], errors = []; let bytes = 0;
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    const collect = target => chunk => { bytes += chunk.length; if (bytes <= 128000) target.push(chunk); };
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors)); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); const text = Buffer.concat([...output, ...errors]).toString('utf8').trim(); code === 0 ? resolve(text) : reject(new Error(text.slice(-4000) || `${path.basename(executable)} exited (${code}).`)); });
    child.stdin.end(input);
  });
}
function reportPath() { return `01 Daily/${new Date().toISOString().slice(0, 10)}.md`; }
async function notify(job, event, text) {
  const status = communicationStatus();
  await Promise.all(['slack', 'discord'].map(async channel => {
    if (!status[channel]) return recordNotification(job.id, channel, event, 'failed', 'Webhook is not configured.');
    try {
      let failure;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await sendChannelMessage(channel, text); recordNotification(job.id, channel, event, 'sent', attempt ? 'Delivered after retry.' : 'Delivered.'); return; }
        catch (error) { failure = error; }
      }
      throw failure;
    }
    catch (error) { recordNotification(job.id, channel, event, 'failed', error.message || 'Delivery failed.'); }
  }));
}
function deploymentUrl(text) { return String(text || '').match(/https:\/\/[^\s)]+/i)?.[0] || ''; }
function prompt(project, job) {
  return `You are JARVIS, a local project agent. Work only in the current registered project directory. Complete this task: ${job.instruction || 'Inspect the project and report its current state.'}\nUse the project instructions. You may edit files, run tests, commit, push, and use the saved deployment command only when needed to complete this task. Do not access unrelated folders, credentials, devices, or networks. End with a concise record of files changed, tests run, commit/push/deploy results, and any blocker.`;
}
export async function runProjectJob(projectId, instruction = '') {
  if (active) throw new Error('JARVIS is already running a project job.');
  if (agentSetting('kill_switch', '0') === '1') throw new Error('Agent automation is paused by the kill switch.');
  const project = getProject(projectId);
  if (!project || !project.enabled || !existsSync(project.path)) throw new Error('Registered project is unavailable or paused.');
  active = true;
  let job = queueProjectJob(project.id, instruction);
  try {
    job = updateJob(job.id, 'running');
    await notify(job, 'start', `JARVIS started: ${project.name}\n${job.instruction || 'Registered project task'}`);
    const records = [];
    if (job.instruction) {
      if (!existsSync(hermes)) throw new Error('Hermes Agent is not installed at the configured local path.');
      records.push(`Agent:\n${await run(hermes, ['chat', '--query-file', '-', '--oneshot', '--quiet', '--in', project.path, '--yolo', '--run-budget', '900'], project.path, prompt(project, job))}`);
    }
    if (project.taskCommand) { const [command, ...values] = args(project.taskCommand); records.push(`Task command:\n${await run(command, values, project.path)}`); }
    if (project.deployCommand) { const [command, ...values] = args(project.deployCommand); records.push(`Deploy:\n${await run(command, values, project.path)}`); }
    const result = records.join('\n\n').slice(-12000) || 'Job completed without a configured command.';
    const url = deploymentUrl(result); job = updateJob(job.id, 'succeeded', result, url); markProjectRun(project.id, result);
    appendObsidianNote(reportPath(), `## ${new Date().toLocaleTimeString()} — ${project.name}\n\nStatus: succeeded\n\n${result}\n${url ? `\nDeployment: ${url}` : ''}`);
    await notify(job, 'success', `JARVIS completed: ${project.name}${url ? `\nDeployment: ${url}` : ''}\n${result.slice(-900)}`);
    return job;
  } catch (error) {
    const result = String(error.message || 'Project job failed.').slice(-12000); job = updateJob(job.id, 'failed', result); markProjectRun(project.id, result);
    appendObsidianNote(reportPath(), `## ${new Date().toLocaleTimeString()} — ${project.name}\n\nStatus: failed\n\n${result}`);
    await notify(job, 'failure', `JARVIS failed: ${project.name}\n${result.slice(-1200)}`);
    throw error;
  } finally { active = false; }
}
export async function runDueProjectJobs() {
  if (active || agentSetting('kill_switch', '0') === '1') return [];
  const jobs = [];
  for (const project of dueProjects()) { try { jobs.push(await runProjectJob(project.id)); } catch {} }
  return jobs;
}
export function automationState() { return { active, killSwitch: agentSetting('kill_switch', '0') === '1' }; }
export function setAutomationPaused(value) { return setKillSwitch(value); }
