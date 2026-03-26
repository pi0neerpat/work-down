/**
 * Integration tests for cli.js — subprocess tests against real repo structures
 * Run: node --test cli.integration.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const srcCliPath = path.resolve(__dirname, 'cli.js');
const srcParsersPath = path.resolve(__dirname, 'parsers.js');

// ── Helpers ──────────────────────────────────────────────────

let tmpDir;
let cliPath;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-int-'));
  // Copy cli.js and parsers.js to tmp dir so HUB_DIR resolves to tmp
  cliPath = path.join(tmpDir, 'cli.js');
  fs.copyFileSync(srcCliPath, cliPath);
  fs.copyFileSync(srcParsersPath, path.join(tmpDir, 'parsers.js'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Run the CLI as a subprocess with robust stderr handling.
 * Uses spawnSync with shell: true for full control over stdout/stderr.
 */
function runCli(args) {
  const cmd = `node "${cliPath}" ${args}`;
  const result = spawnSync(cmd, {
    cwd: tmpDir,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, NODE_PATH: '' },
  });

  let stdout = null;
  if (result.stdout && result.stdout.trim()) {
    try { stdout = JSON.parse(result.stdout.trim()); } catch { stdout = result.stdout; }
  }

  let stderr = null;
  if (result.stderr && result.stderr.trim()) {
    try { stderr = JSON.parse(result.stderr.trim()); } catch { stderr = result.stderr.trim(); }
  }

  return { stdout, stderr, exitCode: result.status };
}

/**
 * Create the standard hub file structure for testing.
 * Returns the hub dir path.
 */
function createTestHub(opts = {}) {
  const hubDir = tmpDir;
  const repoName = opts.repoName || 'testrepo';
  const repoDir = path.join(hubDir, repoName);

  // Create repo directory structure
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'notes', 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'notes', 'swarm'), { recursive: true });

  // config.json
  const config = {
    repos: [
      {
        name: repoName,
        path: repoName,
        taskFile: 'todo.md',
        bugsFile: 'bugs.md',
        activityFile: 'activity-log.md',
      },
    ],
    hubRoot: '.',
  };
  if (opts.extraRepos) config.repos.push(...opts.extraRepos);
  fs.writeFileSync(path.join(hubDir, 'config.json'), JSON.stringify(config, null, 2));

  // todo.md
  const tasks = opts.tasks || [
    '## Tasks',
    '- [ ] First task',
    '- [ ] Second task',
    '- [x] Done task',
  ];
  fs.writeFileSync(path.join(repoDir, 'todo.md'), tasks.join('\n'));

  // bugs.md
  const bugs = opts.bugs || [
    '## Bugs',
    '- [ ] Bug one',
    '- [x] Fixed bug',
  ];
  fs.writeFileSync(path.join(repoDir, 'bugs.md'), bugs.join('\n'));

  // activity-log.md
  const activity = opts.activity || [
    '**Current stage:** Testing',
    '',
    '## 2026-03-26',
    '- Set up test hub',
    '- Ran first integration test',
  ];
  fs.writeFileSync(path.join(repoDir, 'activity-log.md'), activity.join('\n'));

  // Create notes/jobs dir at hub level too
  fs.mkdirSync(path.join(hubDir, 'notes', 'jobs'), { recursive: true });

  // Init git repo in the repo dir (for getGitInfo)
  execSync(`git init -b main "${repoDir}"`, { encoding: 'utf8' });
  execSync(`git -C "${repoDir}" config user.email "test@test.com"`, { encoding: 'utf8' });
  execSync(`git -C "${repoDir}" config user.name "Test"`, { encoding: 'utf8' });
  execSync(`git -C "${repoDir}" add -A && git -C "${repoDir}" commit -m "init"`, { encoding: 'utf8' });

  return { hubDir, repoDir, repoName };
}

// ── Read commands ────────────────────────────────────────────

describe('CLI read commands', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('status returns overview with repo data', () => {
    createTestHub();
    const { stdout, exitCode } = runCli('status');
    assert.equal(exitCode, 0);
    assert.ok(stdout.stage);
    assert.ok(Array.isArray(stdout.repos));
    assert.equal(stdout.repos.length, 1);
    assert.equal(stdout.repos[0].name, 'testrepo');
    assert.equal(stdout.repos[0].tasks.openCount, 2);
    assert.equal(stdout.repos[0].tasks.doneCount, 1);
    assert.ok(stdout.totals);
    assert.equal(stdout.totals.openTasks, 2);
    assert.ok(stdout.swarm);
  });

  it('tasks returns all repos tasks', () => {
    const secondRepoDir = path.join(tmpDir, 'repo2');
    fs.mkdirSync(secondRepoDir, { recursive: true });
    fs.mkdirSync(path.join(secondRepoDir, 'notes', 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(secondRepoDir, 'todo.md'), '## Tasks\n- [ ] Repo2 task\n');
    fs.writeFileSync(path.join(secondRepoDir, 'activity-log.md'), '');
    execSync(`git init -b main "${secondRepoDir}"`, { encoding: 'utf8' });
    execSync(`git -C "${secondRepoDir}" config user.email "test@test.com"`, { encoding: 'utf8' });
    execSync(`git -C "${secondRepoDir}" config user.name "Test"`, { encoding: 'utf8' });
    execSync(`git -C "${secondRepoDir}" add -A && git -C "${secondRepoDir}" commit -m "init"`, { encoding: 'utf8' });

    createTestHub({
      extraRepos: [{ name: 'repo2', path: 'repo2', taskFile: 'todo.md', activityFile: 'activity-log.md' }],
    });

    const { stdout, exitCode } = runCli('tasks');
    assert.equal(exitCode, 0);
    assert.equal(stdout.repos.length, 2);
    assert.ok(stdout.repos.find(r => r.name === 'testrepo'));
    assert.ok(stdout.repos.find(r => r.name === 'repo2'));
  });

  it('tasks --repo=<name> filters to one repo', () => {
    createTestHub();
    const { stdout, exitCode } = runCli('tasks --repo=testrepo');
    assert.equal(exitCode, 0);
    assert.equal(stdout.repos.length, 1);
    assert.equal(stdout.repos[0].name, 'testrepo');
    assert.equal(stdout.repos[0].openCount, 2);
  });

  it('tasks --repo=nonexistent exits with error JSON', () => {
    createTestHub();
    const { stderr, exitCode } = runCli('tasks --repo=nonexistent');
    assert.equal(exitCode, 1);
    assert.ok(stderr);
    assert.ok(typeof stderr === 'object' ? stderr.error : stderr.includes('not found'));
  });

  it('activity returns recent entries', () => {
    createTestHub();
    const { stdout, exitCode } = runCli('activity');
    assert.equal(exitCode, 0);
    assert.ok(stdout.stage);
    assert.ok(Array.isArray(stdout.repos));
    assert.ok(stdout.repos[0].entries.length > 0);
    assert.equal(stdout.repos[0].entries[0].date, '2026-03-26');
  });

  it('config returns raw config', () => {
    createTestHub();
    const { stdout, exitCode } = runCli('config');
    assert.equal(exitCode, 0);
    assert.ok(Array.isArray(stdout.repos));
    assert.equal(stdout.repos[0].name, 'testrepo');
  });
});

// ── Write commands ───────────────────────────────────────────

describe('CLI write commands', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('tasks done marks first open task', () => {
    const { repoDir } = createTestHub();
    const { stdout, exitCode } = runCli('tasks done testrepo 1');
    assert.equal(exitCode, 0);
    assert.ok(stdout.success);

    // Verify file on disk
    const content = fs.readFileSync(path.join(repoDir, 'todo.md'), 'utf8');
    assert.ok(content.includes('[x] First task'));
  });

  it('tasks add adds a new task', () => {
    const { repoDir } = createTestHub();
    const { stdout, exitCode } = runCli('tasks add testrepo "New task from CLI"');
    assert.equal(exitCode, 0);
    assert.ok(stdout.success);

    // Verify file on disk
    const content = fs.readFileSync(path.join(repoDir, 'todo.md'), 'utf8');
    assert.ok(content.includes('New task from CLI'));
  });

  it('swarm validate validates a job', () => {
    const { repoDir } = createTestHub();
    const jobContent = [
      '# Job Task: Test job',
      'Started: 2026-03-26 12:00:00',
      'Status: Completed',
      'Validation: Needs validation',
      '',
      '## Progress',
      '- [2026-03-26 12:00] Started',
      '',
      '## Results',
      'Test results here',
    ].join('\n');
    const jobPath = path.join(repoDir, 'notes', 'swarm', '2026-03-26-test-job.md');
    fs.writeFileSync(jobPath, jobContent);

    const { stdout, exitCode } = runCli('swarm validate 2026-03-26-test-job');
    assert.equal(exitCode, 0);

    const updated = fs.readFileSync(jobPath, 'utf8');
    assert.ok(updated.includes('Validation: Validated'));
  });

  it('swarm reject rejects with notes', () => {
    const { repoDir } = createTestHub();
    const jobContent = [
      '# Job Task: Test job',
      'Started: 2026-03-26 12:00:00',
      'Status: Completed',
      'Validation: Needs validation',
      '',
      '## Progress',
      '- [2026-03-26 12:00] Started',
      '',
      '## Results',
      'Test results here',
    ].join('\n');
    const jobPath = path.join(repoDir, 'notes', 'swarm', '2026-03-26-reject-test.md');
    fs.writeFileSync(jobPath, jobContent);

    const { stdout, exitCode } = runCli('swarm reject 2026-03-26-reject-test --notes="Needs more work"');
    assert.equal(exitCode, 0);

    const updated = fs.readFileSync(jobPath, 'utf8');
    assert.ok(updated.includes('Validation: Rejected'));
  });
});

// ── Bugs commands ────────────────────────────────────────────

describe('CLI bugs commands', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('bugs returns bug data and routes through bugsFile', () => {
    createTestHub();
    const { stdout, exitCode } = runCli('bugs');
    assert.equal(exitCode, 0);
    assert.ok(Array.isArray(stdout.repos));
    assert.equal(stdout.repos[0].name, 'testrepo');
    assert.equal(stdout.repos[0].openCount, 1);
    assert.equal(stdout.repos[0].doneCount, 1);
  });
});

// ── Checkpoint commands ──────────────────────────────────────

describe('CLI checkpoint commands', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('checkpoint create returns JSON with checkpointId', () => {
    createTestHub();
    const { stdout, exitCode } = runCli('checkpoint create testrepo');
    assert.equal(exitCode, 0);
    assert.ok(stdout.checkpointId);
    assert.ok(stdout.checkpointId.startsWith('checkpoint/'));
    assert.equal(stdout.originalBranch, 'main');
    assert.equal(stdout.repo, 'testrepo');
  });

  it('checkpoint list returns JSON array', () => {
    createTestHub();
    // Create a checkpoint first
    runCli('checkpoint create testrepo');

    const { stdout, exitCode } = runCli('checkpoint list --repo=testrepo');
    assert.equal(exitCode, 0);
    assert.ok(stdout.checkpoints);
    assert.ok(stdout.checkpoints.testrepo);
    assert.equal(stdout.checkpoints.testrepo.length, 1);
    assert.ok(stdout.checkpoints.testrepo[0].id.startsWith('checkpoint/'));
  });

  it('checkpoint dismiss returns success JSON', () => {
    createTestHub();
    const { stdout: createResult } = runCli('checkpoint create testrepo');
    const cpId = createResult.checkpointId;

    const { stdout, exitCode } = runCli(`checkpoint dismiss testrepo "${cpId}"`);
    assert.equal(exitCode, 0);
    assert.equal(stdout.checkpointId, cpId);

    // Verify checkpoint is gone
    const { stdout: listResult } = runCli('checkpoint list --repo=testrepo');
    assert.equal(listResult.checkpoints.testrepo.length, 0);
  });

  it('checkpoint revert returns success JSON', () => {
    const { repoDir } = createTestHub();
    // Add a file, create checkpoint
    fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'keep\n');
    const { stdout: createResult } = runCli('checkpoint create testrepo');
    const cpId = createResult.checkpointId;

    // Make new changes
    fs.writeFileSync(path.join(repoDir, 'discard.txt'), 'discard\n');

    const { stdout, exitCode } = runCli(`checkpoint revert testrepo "${cpId}"`);
    assert.equal(exitCode, 0);
    assert.equal(stdout.checkpointId, cpId);

    // keep.txt should still exist (was in checkpoint)
    assert.ok(fs.existsSync(path.join(repoDir, 'keep.txt')));
  });
});

// ── Error handling ───────────────────────────────────────────

describe('CLI error handling', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('no command prints usage to stderr', () => {
    createTestHub();
    const { stderr, exitCode } = runCli('');
    assert.equal(exitCode, 0);
    assert.ok(typeof stderr === 'string');
    assert.ok(stderr.includes('Usage:'));
  });

  it('unknown command prints usage to stderr with exit code 1', () => {
    createTestHub();
    const { stderr, exitCode } = runCli('nonexistent');
    assert.equal(exitCode, 1);
    assert.ok(typeof stderr === 'string');
    assert.ok(stderr.includes('Usage:'));
  });
});
