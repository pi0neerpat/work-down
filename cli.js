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
const {
  parseTaskFile, parseActivityLog, getGitInfo,
  parseSwarmFile, parseSwarmDir, loadConfig,
  writeTaskDone, writeTaskAdd, writeSwarmValidation,
  createCheckpoint, revertCheckpoint, dismissCheckpoint, listCheckpoints,
} = require('./parsers');

const HUB_DIR = path.dirname(__filename);

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
  config = loadConfig(HUB_DIR);
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
    if (a.validation === 'needs_validation') needsValidation++;
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
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm');
    const candidate = path.join(swarmDir, `${id}.md`);
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(`swarm agent "${id}" not found in any repo`);
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
  checkpoint list [--repo=name]   List checkpoints`;

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
