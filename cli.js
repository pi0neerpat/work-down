#!/usr/bin/env node
/**
 * hub CLI — Agent-friendly data access for the Scribular coordination hub.
 * All output is JSON to stdout. Errors go to stderr as JSON.
 *
 * Read commands:
 *   node hub/cli.js status                        Full overview
 *   node hub/cli.js tasks [--repo=name]           Open tasks across repos
 *   node hub/cli.js bugs [--repo=name]            Open bugs across repos
 *   node hub/cli.js swarm [id]                    Swarm agent status
 *   node hub/cli.js repos                         Git status for all repos
 *   node hub/cli.js activity [--limit=N]          Recent activity entries
 *   node hub/cli.js config                        Raw hub config
 *
 * Write commands:
 *   node hub/cli.js tasks done <repo> <num>       Mark open task #num as done
 *   node hub/cli.js tasks add <repo> "text"       Add a new task [--section=name]
 *   node hub/cli.js bugs done <repo> <num>        Mark open bug #num as done
 *   node hub/cli.js bugs add <repo> "text"        Add a new bug [--section=name]
 *   node hub/cli.js swarm validate <id>           Validate a swarm task [--notes="..."]
 *   node hub/cli.js swarm reject <id>             Reject a swarm task --notes="reason"
 *
 * Checkpoint commands:
 *   node hub/cli.js checkpoint create <repo>        Create checkpoint of current state
 *   node hub/cli.js checkpoint revert <repo> <id>   Revert to checkpoint (destructive)
 *   node hub/cli.js checkpoint dismiss <repo> <id>  Delete checkpoint, keep current state
 *   node hub/cli.js checkpoint list [--repo=name]   List checkpoints
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  parseTaskFile, parseActivityLog, getGitInfo,
  parseSwarmFile, parseSwarmDir, loadConfig,
  writeTaskDone, writeTaskAdd, writeSwarmValidation,
  createCheckpoint, revertCheckpoint, dismissCheckpoint, listCheckpoints,
  // Schedule
  loadSchedules, findSchedule, createSchedule, updateSchedule, deleteSchedule,
  toggleSchedule, getAdjacentSchedules, validateCron, describeCron, computeNextRun,
  loadScheduleEvents, appendScheduleEvent, clearScheduleEvents,
  acquireScheduleLock, releaseScheduleLock, getActiveLocks, scheduleLogPath,
  syncCrontab, parseJobFile, writeJobStatus, updateScheduleLastRun,
} = require('./parsers');

const DISPATCH_ROOT = path.dirname(__filename);

function fail(msg) {
  process.stderr.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// Parse args — supports subcommands like "tasks done marketing 3"
const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1] && !args[1].startsWith('--') ? args[1] : null;
const flags = {};
const positionals = [];
for (const arg of args.slice(1)) {
  const m = arg.match(/^--([^=]+)=(.+)/);
  if (m) flags[m[1]] = m[2];
  else if (arg.startsWith('--')) flags[arg.slice(2)] = true;
  else positionals.push(arg);
}
// Backward compat: first positional available as flags._positional
flags._positional = positionals[0] || null;

// Load config
let config;
try {
  config = loadConfig(DISPATCH_ROOT);
} catch {
  fail('config.local.json or config.json not found or invalid');
}

// Gather repo data (lazy — only computed when needed)
function gatherRepos() {
  return config.repos.map(repo => {
    const rp = repo.resolvedPath;
    const tasks = parseTaskFile(path.join(rp, repo.taskFile));
    const activity = parseActivityLog(path.join(rp, repo.activityFile));
    const git = getGitInfo(rp);
    return { name: repo.name, resolvedPath: rp, tasks, activity, git };
  });
}

// Gather bugs data (lazy — only computed when needed)
function gatherBugs() {
  return config.repos
    .filter(repo => repo.bugsFile)
    .map(repo => {
      const rp = repo.resolvedPath;
      const bugsPath = path.join(rp, repo.bugsFile);
      const bugs = parseTaskFile(bugsPath);
      return { name: repo.name, resolvedPath: rp, bugs };
    });
}

// Gather swarm data across all repos
function gatherSwarm() {
  const allAgents = [];
  for (const repo of config.repos) {
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm');
    const agents = parseSwarmDir(swarmDir);
    for (const agent of agents) {
      agent.repo = repo.name;
    }
    allAgents.push(...agents);
  }
  return allAgents;
}

function swarmSummary(agents) {
  let active = 0, completed = 0, failed = 0, needsValidation = 0;
  for (const a of agents) {
    if (a.status === 'in_progress') active++;
    else if (a.status === 'completed') completed++;
    else if (a.status === 'failed') failed++;
    if (a.validation === 'needs_validation' || a.status === 'stopped') needsValidation++;
  }
  return { active, completed, failed, needsValidation };
}

// ── Commands ────────────────────────────────────────────────

function cmdStatus() {
  const repos = gatherRepos();
  const agents = gatherSwarm();
  const stage = repos.find(r => r.activity.stage)?.activity.stage || '';
  const totalOpen = repos.reduce((s, r) => s + r.tasks.openCount, 0);
  const totalDone = repos.reduce((s, r) => s + r.tasks.doneCount, 0);

  out({
    stage,
    repos: repos.map(r => ({
      name: r.name,
      git: r.git,
      tasks: { openCount: r.tasks.openCount, doneCount: r.tasks.doneCount },
      lastActivity: r.activity.entries[0] || null,
    })),
    swarm: swarmSummary(agents),
    totals: { openTasks: totalOpen, doneTasks: totalDone },
  });
}

function cmdTasks() {
  const repos = gatherRepos();
  const repoFilter = flags.repo;

  const filtered = repoFilter
    ? repos.filter(r => r.name === repoFilter)
    : repos;

  if (repoFilter && filtered.length === 0) {
    fail(`repo "${repoFilter}" not found in config`);
  }

  out({
    repos: filtered.map(r => ({
      name: r.name,
      sections: r.tasks.sections,
      openCount: r.tasks.openCount,
      doneCount: r.tasks.doneCount,
    })),
  });
}

function cmdBugs() {
  const repos = gatherBugs();
  const repoFilter = flags.repo;

  const filtered = repoFilter
    ? repos.filter(r => r.name === repoFilter)
    : repos;

  if (repoFilter && filtered.length === 0) {
    fail(`repo "${repoFilter}" not found in config (or has no bugsFile)`);
  }

  out({
    repos: filtered.map(r => ({
      name: r.name,
      sections: r.bugs.sections,
      openCount: r.bugs.openCount,
      doneCount: r.bugs.doneCount,
    })),
  });
}

function cmdSwarm() {
  const agents = gatherSwarm();
  const id = flags._positional;

  if (id) {
    const agent = agents.find(a => a.id === id);
    if (!agent) fail(`swarm agent "${id}" not found`);
    out({
      id: agent.id,
      repo: agent.repo,
      taskName: agent.taskName,
      started: agent.started,
      status: agent.status,
      validation: agent.validation,
      progressEntries: agent.progressEntries,
      results: agent.results,
      validationNotes: agent.validationNotes,
    });
  } else {
    out({
      agents: agents.map(a => ({
        id: a.id,
        repo: a.repo,
        taskName: a.taskName,
        started: a.started,
        status: a.status,
        validation: a.validation,
        lastProgress: a.lastProgress,
        progressCount: a.progressCount,
        durationMinutes: a.durationMinutes,
      })),
      summary: swarmSummary(agents),
    });
  }
}

function cmdRepos() {
  const repos = gatherRepos();
  out({
    repos: repos.map(r => ({
      name: r.name,
      branch: r.git.branch,
      dirtyCount: r.git.dirtyCount,
    })),
  });
}

function cmdActivity() {
  const repos = gatherRepos();
  const limit = parseInt(flags.limit, 10) || 3;
  const stage = repos.find(r => r.activity.stage)?.activity.stage || '';

  out({
    stage,
    repos: repos.map(r => ({
      name: r.name,
      entries: r.activity.entries.slice(0, limit),
    })),
  });
}

function cmdConfig() {
  out(config);
}

// ── Write Commands ───────────────────────────────────────────

function findRepo(name) {
  const repo = config.repos.find(r => r.name === name);
  if (!repo) fail(`repo "${name}" not found in config. Available: ${config.repos.map(r => r.name).join(', ')}`);
  return repo;
}

function cmdTasksDone() {
  // hub tasks done <repo> <task-num>
  const repoName = positionals[1];
  const taskNum = parseInt(positionals[2], 10);

  if (!repoName || isNaN(taskNum)) {
    fail('usage: hub tasks done <repo> <task-num>  (task-num is the Nth open task, 1-indexed)');
  }

  const repo = findRepo(repoName);
  const filePath = path.join(repo.resolvedPath, repo.taskFile);

  try {
    const result = writeTaskDone(filePath, taskNum);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdTasksAdd() {
  // hub tasks add <repo> "task text" [--section=name]
  const repoName = positionals[1];
  const taskText = positionals[2];
  const section = flags.section || null;

  if (!repoName || !taskText) {
    fail('usage: hub tasks add <repo> "task text" [--section=name]');
  }

  const repo = findRepo(repoName);
  const filePath = path.join(repo.resolvedPath, repo.taskFile);

  try {
    const result = writeTaskAdd(filePath, taskText, section);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdBugsDone() {
  // hub bugs done <repo> <bug-num>
  const repoName = positionals[1];
  const taskNum = parseInt(positionals[2], 10);

  if (!repoName || isNaN(taskNum)) {
    fail('usage: hub bugs done <repo> <bug-num>  (bug-num is the Nth open bug, 1-indexed)');
  }

  const repo = findRepo(repoName);
  if (!repo.bugsFile) fail(`repo "${repoName}" has no bugsFile configured`);
  const filePath = path.join(repo.resolvedPath, repo.bugsFile);

  try {
    const result = writeTaskDone(filePath, taskNum);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdBugsAdd() {
  // hub bugs add <repo> "bug text" [--section=name]
  const repoName = positionals[1];
  const taskText = positionals[2];
  const section = flags.section || null;

  if (!repoName || !taskText) {
    fail('usage: hub bugs add <repo> "bug text" [--section=name]');
  }

  const repo = findRepo(repoName);
  if (!repo.bugsFile) fail(`repo "${repoName}" has no bugsFile configured`);
  const filePath = path.join(repo.resolvedPath, repo.bugsFile);

  try {
    const result = writeTaskAdd(filePath, taskText, section);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdSwarmValidate() {
  // hub swarm validate <id> [--notes="..."]
  const id = positionals[1];
  if (!id) fail('usage: hub swarm validate <id> [--notes="..."]');

  const filePath = findSwarmFile(id);
  const notes = flags.notes || null;

  try {
    const result = writeSwarmValidation(filePath, 'validated', notes);
    out(result);
  } catch (err) {
    fail(err.message);
  }
}

function cmdSwarmReject() {
  // hub swarm reject <id> --notes="reason"
  const id = positionals[1];
  if (!id) fail('usage: hub swarm reject <id> --notes="reason"');

  const notes = flags.notes || null;
  if (!notes) fail('--notes is required when rejecting (explain what needs to change)');

  const filePath = findSwarmFile(id);

  try {
    const result = writeSwarmValidation(filePath, 'rejected', notes);
    out(result);
  } catch (err) {
    fail(err.message);
  }
}

// ── Checkpoint Commands ──────────────────────────────────

function cmdCheckpointCreate() {
  const repoName = positionals[1];
  if (!repoName) fail('usage: hub checkpoint create <repo>');

  const repo = findRepo(repoName);
  try {
    const result = createCheckpoint(repo.resolvedPath);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdCheckpointRevert() {
  const repoName = positionals[1];
  const id = positionals[2];
  if (!repoName || !id) fail('usage: hub checkpoint revert <repo> <id>');

  const repo = findRepo(repoName);
  try {
    const result = revertCheckpoint(repo.resolvedPath, id);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdCheckpointDismiss() {
  const repoName = positionals[1];
  const id = positionals[2];
  if (!repoName || !id) fail('usage: hub checkpoint dismiss <repo> <id>');

  const repo = findRepo(repoName);
  try {
    const result = dismissCheckpoint(repo.resolvedPath, id);
    out({ ...result, repo: repoName });
  } catch (err) {
    fail(err.message);
  }
}

function cmdCheckpointList() {
  const repoFilter = flags.repo || positionals[1] || null;
  const repos = repoFilter
    ? [findRepo(repoFilter)]
    : config.repos;

  const result = {};
  for (const repo of repos) {
    result[repo.name] = listCheckpoints(repo.resolvedPath);
  }
  out({ checkpoints: result });
}

function findSwarmFile(id) {
  for (const repo of config.repos) {
    const swarmDir = path.resolve(repo.resolvedPath, 'notes', 'swarm');
    const candidate = path.resolve(swarmDir, `${id}.md`);
    if (!candidate.startsWith(swarmDir + path.sep)) fail('Invalid swarm id: path traversal rejected');
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(`swarm agent "${id}" not found in any repo`);
}

// ── Schedule commands ────────────────────────────────────────

function cmdScheduleList() {
  const schedules = loadSchedules(DISPATCH_ROOT);
  const activeLocks = getActiveLocks(DISPATCH_ROOT);
  out({
    schedules: schedules.map(s => ({
      ...s,
      description: describeCron(s.cron),
      running: activeLocks.some(l => l.scheduleId === s.id),
    })),
    activeCount: activeLocks.length,
    maxConcurrent: 3,
  });
}

function cmdScheduleShow() {
  const id = positionals[1] || flags.id;
  if (!id) fail('schedule id required: schedule show <id>');
  const schedule = findSchedule(DISPATCH_ROOT, id);
  if (!schedule) fail(`schedule "${id}" not found`);
  const events = loadScheduleEvents(DISPATCH_ROOT, { scheduleId: id, limit: 10 });
  const activeLocks = getActiveLocks(DISPATCH_ROOT);
  const adjacent = getAdjacentSchedules(DISPATCH_ROOT, id);
  out({
    schedule: { ...schedule, description: describeCron(schedule.cron), running: activeLocks.some(l => l.scheduleId === id) },
    recentEvents: events,
    adjacentSchedules: adjacent.map(s => ({ id: s.id, name: s.name, cron: s.cron, nextRun: s.nextRun, repo: s.repo })),
  });
}

function cmdScheduleAdd() {
  const name = flags.name;
  const repo = flags.repo;
  const cron = flags.cron;
  const type = flags.type || 'prompt';

  if (!name) fail('--name required');
  if (!repo) fail('--repo required');
  if (!cron) fail('--cron required');

  const cronError = validateCron(cron);
  if (cronError) fail(cronError);

  // Validate repo exists
  const repoConfig = config.repos.find(r => r.name === repo);
  if (!repoConfig) fail(`repo "${repo}" not found in config`);

  const validTypes = ['prompt', 'job', 'loop', 'shell'];
  if (!validTypes.includes(type)) fail(`--type must be one of: ${validTypes.join(', ')}`);
  if ((type === 'prompt' || type === 'job') && !flags.prompt) fail('--prompt required for prompt/job-type schedules');
  if (type === 'loop' && !flags['loop-type']) fail('--loop-type required for loop-type schedules');
  if (type === 'shell' && !flags.command) fail('--command required for shell-type schedules');

  const schedule = createSchedule(DISPATCH_ROOT, {
    name,
    type,
    repo,
    cron,
    prompt: flags.prompt || null,
    model: flags.model || 'claude-opus-4-6',
    loopType: flags['loop-type'] || null,
    agentSpec: flags['agent-spec'] || null,
    command: flags.command || null,
    concurrency: flags.concurrency || 'skip',
  });

  // Auto-sync crontab
  let cronSynced = false;
  try { syncCrontab(DISPATCH_ROOT); cronSynced = true; } catch { /* non-fatal */ }

  const adjacent = getAdjacentSchedules(DISPATCH_ROOT, schedule.id);
  const activeLocks = getActiveLocks(DISPATCH_ROOT);
  out({
    schedule: { ...schedule, description: describeCron(schedule.cron) },
    adjacentSchedules: adjacent.map(s => ({ id: s.id, name: s.name, cron: s.cron, nextRun: s.nextRun, repo: s.repo })),
    activeCount: activeLocks.length,
    maxConcurrent: 3,
    cronSynced,
  });
}

function cmdScheduleEdit() {
  const id = positionals[1] || flags.id;
  if (!id) fail('schedule id required: schedule edit <id>');
  if (!findSchedule(DISPATCH_ROOT, id)) fail(`schedule "${id}" not found`);

  if (flags.cron) {
    const cronError = validateCron(flags.cron);
    if (cronError) fail(cronError);
  }
  if (flags.repo) {
    const repoConfig = config.repos.find(r => r.name === flags.repo);
    if (!repoConfig) fail(`repo "${flags.repo}" not found in config`);
  }
  if (flags.type) {
    const validTypes = ['prompt', 'job', 'loop', 'shell'];
    if (!validTypes.includes(flags.type)) fail(`--type must be one of: ${validTypes.join(', ')}`);
  }
  if (flags.concurrency) {
    const validConcurrency = ['skip', 'queue', 'parallel'];
    if (!validConcurrency.includes(flags.concurrency)) fail(`--concurrency must be one of: ${validConcurrency.join(', ')}`);
  }

  // Validate that shell-type schedules have a command
  if (flags.type === 'shell' && !flags.command) {
    const existing = findSchedule(DISPATCH_ROOT, id);
    if (!existing || !existing.command) fail('--command is required when type is shell');
  }

  const updated = updateSchedule(DISPATCH_ROOT, id, {
    name: flags.name,
    type: flags.type,
    repo: flags.repo,
    cron: flags.cron,
    prompt: flags.prompt,
    model: flags.model,
    loopType: flags['loop-type'],
    agentSpec: flags['agent-spec'],
    command: flags.command,
    concurrency: flags.concurrency,
  });

  let cronSynced = false;
  try { syncCrontab(DISPATCH_ROOT); cronSynced = true; } catch {}

  const adjacent = getAdjacentSchedules(DISPATCH_ROOT, id);
  const activeLocks = getActiveLocks(DISPATCH_ROOT);
  out({
    schedule: { ...updated, description: describeCron(updated.cron) },
    adjacentSchedules: adjacent.map(s => ({ id: s.id, name: s.name, cron: s.cron, nextRun: s.nextRun, repo: s.repo })),
    activeCount: activeLocks.length,
    maxConcurrent: 3,
    cronSynced,
  });
}

function cmdScheduleDelete() {
  const id = positionals[1] || flags.id;
  if (!id) fail('schedule id required: schedule delete <id>');
  if (!deleteSchedule(DISPATCH_ROOT, id)) fail(`schedule "${id}" not found`);

  let cronSynced = false;
  try { syncCrontab(DISPATCH_ROOT); cronSynced = true; } catch {}
  out({ deleted: id, cronSynced });
}

function cmdScheduleEnable() {
  const id = positionals[1] || flags.id;
  if (!id) fail('schedule id required');
  const schedule = findSchedule(DISPATCH_ROOT, id);
  if (!schedule) fail(`schedule "${id}" not found`);
  if (schedule.enabled) { out({ schedule, message: 'already enabled' }); return; }
  const updated = toggleSchedule(DISPATCH_ROOT, id);
  let cronSynced = false;
  try { syncCrontab(DISPATCH_ROOT); cronSynced = true; } catch {}
  out({ schedule: updated, cronSynced });
}

function cmdScheduleDisable() {
  const id = positionals[1] || flags.id;
  if (!id) fail('schedule id required');
  const schedule = findSchedule(DISPATCH_ROOT, id);
  if (!schedule) fail(`schedule "${id}" not found`);
  if (!schedule.enabled) { out({ schedule, message: 'already disabled' }); return; }
  const updated = toggleSchedule(DISPATCH_ROOT, id);
  let cronSynced = false;
  try { syncCrontab(DISPATCH_ROOT); cronSynced = true; } catch {}
  out({ schedule: updated, cronSynced });
}

function cmdScheduleActive() {
  const locks = getActiveLocks(DISPATCH_ROOT);
  const schedules = loadSchedules(DISPATCH_ROOT);
  const active = locks.map(lock => {
    const sched = schedules.find(s => s.id === lock.scheduleId);
    return { ...lock, name: sched?.name || 'unknown', repo: sched?.repo || 'unknown', cron: sched?.cron || '' };
  });
  out({ active, count: active.length, maxConcurrent: 3 });
}

function cmdScheduleEvents() {
  const limit = flags.limit ? parseInt(flags.limit, 10) : 20;
  const scheduleId = flags['schedule-id'] || null;
  const type = flags.type || null;
  const events = loadScheduleEvents(DISPATCH_ROOT, { scheduleId, type, limit });
  out({ events });
}

function cmdScheduleClearEvents() {
  const id = positionals[1] || flags.id || null;
  clearScheduleEvents(DISPATCH_ROOT, id);
  out({ cleared: id || 'all' });
}

function cmdScheduleSync() {
  try {
    const result = syncCrontab(DISPATCH_ROOT);
    out(result);
  } catch (err) {
    fail(`crontab sync failed: ${err.message}`);
  }
}

function cmdScheduleRun() {
  const id = positionals[1] || flags.id;
  if (!id) fail('schedule id required: schedule run <id>');

  const schedule = findSchedule(DISPATCH_ROOT, id);
  if (!schedule) fail(`schedule "${id}" not found`);

  const repoConfig = config.repos.find(r => r.name === schedule.repo);
  if (!repoConfig) fail(`repo "${schedule.repo}" not found in config`);

  // Check global concurrency limit
  const activeLocks = getActiveLocks(DISPATCH_ROOT);
  const maxConcurrent = 3;
  if (activeLocks.length >= maxConcurrent) {
    const event = appendScheduleEvent(DISPATCH_ROOT, {
      scheduleId: id, scheduleName: schedule.name, repo: schedule.repo,
      type: 'skipped', at: new Date().toISOString(),
      reason: `max concurrent (${activeLocks.length}/${maxConcurrent}) reached`,
    });
    out({ skipped: true, reason: event.reason });
    return;
  }

  // Acquire per-schedule lock (all concurrency modes require a lock today)
  const lock = acquireScheduleLock(DISPATCH_ROOT, id, null);
  if (!lock) {
    const reason = schedule.concurrency === 'skip' ? 'previous run still active' : 'failed to acquire lock';
    appendScheduleEvent(DISPATCH_ROOT, {
      scheduleId: id, scheduleName: schedule.name, repo: schedule.repo,
      type: 'skipped', at: new Date().toISOString(), reason,
    });
    out({ skipped: true, reason });
    return;
  }

  // Log run start
  const startedAt = new Date().toISOString();
  const logPath = scheduleLogPath(DISPATCH_ROOT, id);
  const runHeader = `\n${'═'.repeat(60)}\nRUN ${startedAt}\nSchedule: ${schedule.name} (${id})\nType: ${schedule.type} | Repo: ${schedule.repo}\n${'─'.repeat(60)}\n`;

  let exitCode = 0;
  let errorMsg = null;
  let jobId = null;
  let jobFilePath = null;
  const repoCwd = repoConfig.resolvedPath;

  try {
    fs.appendFileSync(logPath, runHeader, 'utf8');

    appendScheduleEvent(DISPATCH_ROOT, {
      scheduleId: id, scheduleName: schedule.name, repo: schedule.repo,
      type: 'started', startedAt,
    });
    if (schedule.type === 'job') {
      // Dispatch job — create tracked job file, run claude --print with dispatch prompt
      const slug = schedule.name
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'scheduled-job';
      const date = new Date().toISOString().slice(0, 10);
      const jobsDir = path.join(repoCwd, 'notes', 'jobs');
      fs.mkdirSync(jobsDir, { recursive: true });

      // Allocate unique job file name
      let seq = 0;
      let fileName;
      while (seq < 1000) {
        const suffix = seq === 0 ? '' : `-${seq + 1}`;
        fileName = `${date}-${slug}${suffix}.md`;
        jobFilePath = path.join(jobsDir, fileName);
        if (!fs.existsSync(jobFilePath)) break;
        seq++;
      }
      if (seq >= 1000) fail('Failed to allocate unique job file name after 1000 attempts');
      jobId = fileName.replace(/\.md$/, '');

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const singleLine = v => String(v || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

      // Write job file
      const jobLines = [
        `# Job Task: ${singleLine(schedule.prompt)}`,
        `Started: ${timestamp}`,
        'Status: In progress',
        `Repo: ${schedule.repo}`,
        `SkipPermissions: true`,
      ];
      if (schedule.model) jobLines.push(`Model: ${schedule.model}`);
      try {
        const headSha = execFileSync('git', ['-C', repoCwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        jobLines.push(`StartCommit: ${headSha}`);
      } catch { /* no git */ }
      jobLines.push('', '## Progress', `- [${timestamp}] Scheduled dispatch (${schedule.name})`, '', '## Results', '');
      fs.writeFileSync(jobFilePath, jobLines.join('\n'), 'utf8');

      fs.appendFileSync(logPath, `Job file: ${jobFilePath}\nJob ID: ${jobId}\n`, 'utf8');

      // Build dispatch prompt
      const jobRelPath = `notes/jobs/${fileName}`;
      if (!schedule.prompt) fail('Schedule has no prompt configured — cannot dispatch a job without a prompt.');
      const dispatchPrompt = schedule.prompt
        + '\n\nUse a strictly linear approach. Do not run tasks in parallel and do not delegate to sub-agents.'
        + `\n\nWrite progress to the existing file just created: ${jobRelPath}`;

      // Run claude --print
      const claudeArgs = ['--print', '--dangerously-skip-permissions', '-p', dispatchPrompt];
      if (schedule.model) { claudeArgs.push('--model', schedule.model); }
      const output = execFileSync('claude', claudeArgs, {
        cwd: repoCwd, encoding: 'utf8', timeout: 2 * 60 * 60 * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoCwd },
      });
      fs.appendFileSync(logPath, output, 'utf8');

      // Update job file status on success
      try { writeJobStatus(jobFilePath, 'completed'); } catch { /* best effort */ }

    } else if (schedule.type === 'loop') {
      // Launch loop script
      const loopType = schedule.loopType || 'linear-implementation';
      const loopsDir = path.resolve(DISPATCH_ROOT, 'loops');
      const scriptPath = path.resolve(loopsDir, `${loopType}.sh`);
      if (!scriptPath.startsWith(loopsDir + path.sep)) fail('Invalid loop type: path traversal rejected');
      if (!fs.existsSync(scriptPath)) fail(`loop script not found: ${scriptPath}`);
      const loopArgs = ['--repo', repoCwd];
      if (schedule.agentSpec) { loopArgs.push('--agent', schedule.agentSpec); }
      const output = execFileSync('bash', [scriptPath, ...loopArgs], {
        cwd: DISPATCH_ROOT, encoding: 'utf8', timeout: 4 * 60 * 60 * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      fs.appendFileSync(logPath, output, 'utf8');
    } else if (schedule.type === 'shell') {
      // Run arbitrary shell command
      if (!schedule.command) fail('Schedule has no command configured — cannot run a shell schedule without a command.');
      const output = execFileSync('bash', ['-c', schedule.command], {
        cwd: repoCwd, encoding: 'utf8', timeout: 60 * 60 * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      fs.appendFileSync(logPath, output, 'utf8');
    } else {
      // Prompt type — claude --print (no job tracking)
      if (!schedule.prompt) fail('Schedule has no prompt configured — cannot run a prompt schedule without a prompt.');
      const claudeArgs = ['--print', '--dangerously-skip-permissions', '-p', schedule.prompt];
      if (schedule.model) { claudeArgs.push('--model', schedule.model); }
      const output = execFileSync('claude', claudeArgs, {
        cwd: repoCwd, encoding: 'utf8', timeout: 2 * 60 * 60 * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoCwd },
      });
      fs.appendFileSync(logPath, output, 'utf8');
    }
  } catch (err) {
    exitCode = err.status || 1;
    errorMsg = err.message || 'unknown error';
    const stderr = err.stderr ? String(err.stderr).slice(0, 2000) : '';
    const stdout = err.stdout ? String(err.stdout) : '';
    fs.appendFileSync(logPath, stdout + (stderr ? `\nSTDERR:\n${stderr}` : ''), 'utf8');
    // Mark job file as failed if it was created
    if (jobFilePath && fs.existsSync(jobFilePath)) {
      try { writeJobStatus(jobFilePath, 'failed'); } catch { /* best effort */ }
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
  const status = exitCode === 0 ? 'completed' : 'failed';

  fs.appendFileSync(logPath, `\n${'─'.repeat(60)}\nExit code: ${exitCode} | Duration: ${durationStr}${errorMsg ? ' | ERROR' : ''}\n${'═'.repeat(60)}\n`, 'utf8');

  // Update schedule lastRun
  updateScheduleLastRun(DISPATCH_ROOT, id, finishedAt, status, jobId);

  // Record event
  appendScheduleEvent(DISPATCH_ROOT, {
    scheduleId: id, scheduleName: schedule.name, repo: schedule.repo,
    type: status, startedAt, finishedAt, durationMs, exitCode,
    ...(jobId ? { jobId } : {}),
    ...(errorMsg ? { error: errorMsg.slice(0, 500) } : {}),
  });

  // Release lock (always, even if post-run bookkeeping fails)
  try {
    // Auto-disable one-shot (non-recurring) schedules after execution
    const updatedSched = findSchedule(DISPATCH_ROOT, id);
    if (updatedSched && !updatedSched.recurring) {
      toggleSchedule(DISPATCH_ROOT, id); // disables it
      try { syncCrontab(DISPATCH_ROOT); } catch { /* best effort */ }
    }
  } finally {
    releaseScheduleLock(DISPATCH_ROOT, id);
  }

  out({ id, status, exitCode, durationMs, startedAt, finishedAt, logPath, ...(jobId ? { jobId, jobFilePath } : {}) });
}

// ── Router ──────────────────────────────────────────────────

const USAGE = `Usage: hub <command>

Read commands:
  status                        Full overview (stage, repos, tasks, git, swarm)
  tasks [--repo=name]           Open tasks across repos
  bugs [--repo=name]            Open bugs across repos
  swarm [id]                    Swarm agent status
  repos                         Git status for all repos
  activity [--limit=N]          Recent activity entries
  config                        Raw hub config

Write commands:
  tasks done <repo> <num>       Mark open task #num as done
  tasks add <repo> "text"       Add a new task [--section=name]
  bugs done <repo> <num>        Mark open bug #num as done
  bugs add <repo> "text"        Add a new bug [--section=name]
  swarm validate <id>           Mark swarm task as validated [--notes="..."]
  swarm reject <id>             Mark swarm task as rejected --notes="reason"

Checkpoint commands:
  checkpoint create <repo>        Create checkpoint of current state
  checkpoint revert <repo> <id>   Revert to checkpoint (destructive)
  checkpoint dismiss <repo> <id>  Delete checkpoint, keep current state
  checkpoint list [--repo=name]   List checkpoints

Schedule commands:
  schedule [list]                 List all schedules with next-run times
  schedule show <id>              Show schedule details + recent events
  schedule add --name=... --repo=... --cron=... --prompt=...
                                  Create a prompt schedule (no job tracking)
  schedule add --name=... --repo=... --cron=... --type=job --prompt=...
                                  Create a dispatch job schedule (tracked in notes/jobs/)
  schedule add --name=... --repo=... --cron=... --type=loop --loop-type=...
                                  Create a loop schedule
  schedule add --name=... --repo=... --cron=... --type=shell --command=...
                                  Create a shell schedule
  schedule edit <id> [--fields]   Edit schedule fields
  schedule delete <id>            Delete a schedule
  schedule enable <id>            Enable a schedule
  schedule disable <id>           Disable a schedule
  schedule run <id>               Manually trigger a schedule now
  schedule sync                   Sync schedules.json → system crontab
  schedule active                 Show currently running scheduled jobs
  schedule events [--limit=N]     Show recent schedule events
  schedule clear-events [<id>]    Clear events for a schedule (or all)`;

// Route: handle subcommands for tasks and swarm
function route() {
  if (!command) {
    process.stderr.write(USAGE + '\n');
    process.exit(0);
  }

  // tasks done / tasks add
  if (command === 'tasks' && subcommand === 'done') return cmdTasksDone();
  if (command === 'tasks' && subcommand === 'add') return cmdTasksAdd();

  // bugs done / bugs add
  if (command === 'bugs' && subcommand === 'done') return cmdBugsDone();
  if (command === 'bugs' && subcommand === 'add') return cmdBugsAdd();

  // swarm validate / swarm reject
  if (command === 'swarm' && subcommand === 'validate') return cmdSwarmValidate();
  if (command === 'swarm' && subcommand === 'reject') return cmdSwarmReject();

  // checkpoint create / revert / dismiss / list
  if (command === 'checkpoint' && subcommand === 'create') return cmdCheckpointCreate();
  if (command === 'checkpoint' && subcommand === 'revert') return cmdCheckpointRevert();
  if (command === 'checkpoint' && subcommand === 'dismiss') return cmdCheckpointDismiss();
  if (command === 'checkpoint' && (subcommand === 'list' || !subcommand)) return cmdCheckpointList();

  // schedule subcommands
  if (command === 'schedule' && subcommand === 'show') return cmdScheduleShow();
  if (command === 'schedule' && subcommand === 'add') return cmdScheduleAdd();
  if (command === 'schedule' && subcommand === 'edit') return cmdScheduleEdit();
  if (command === 'schedule' && subcommand === 'delete') return cmdScheduleDelete();
  if (command === 'schedule' && subcommand === 'enable') return cmdScheduleEnable();
  if (command === 'schedule' && subcommand === 'disable') return cmdScheduleDisable();
  if (command === 'schedule' && subcommand === 'run') return cmdScheduleRun();
  if (command === 'schedule' && subcommand === 'sync') return cmdScheduleSync();
  if (command === 'schedule' && subcommand === 'active') return cmdScheduleActive();
  if (command === 'schedule' && subcommand === 'events') return cmdScheduleEvents();
  if (command === 'schedule' && subcommand === 'clear-events') return cmdScheduleClearEvents();
  if (command === 'schedule' && (!subcommand || subcommand === 'list')) return cmdScheduleList();

  // Read commands
  const readCommands = {
    status: cmdStatus,
    tasks: cmdTasks,
    bugs: cmdBugs,
    swarm: cmdSwarm,
    repos: cmdRepos,
    activity: cmdActivity,
    config: cmdConfig,
  };

  if (readCommands[command]) return readCommands[command]();

  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

route();
