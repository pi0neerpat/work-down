/**
 * Integration tests for parsers.js — git-dependent functions
 * Run: node --test parsers.integration.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
  getGitInfo,
  createCheckpoint,
  revertCheckpoint,
  dismissCheckpoint,
  listCheckpoints,
  parseJobFile,
} = require('./parsers');

// ── Helpers ──────────────────────────────────────────────────

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parsers-int-'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function initGitRepo(dir) {
  execSync(`git init -b main "${dir}"`, { encoding: 'utf8' });
  execSync(`git -C "${dir}" config user.email "test@test.com"`, { encoding: 'utf8' });
  execSync(`git -C "${dir}" config user.name "Test"`, { encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  execSync(`git -C "${dir}" add -A && git -C "${dir}" commit -m "init"`, { encoding: 'utf8' });
}

// ── getGitInfo ───────────────────────────────────────────────

describe('getGitInfo', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns branch and dirty count for a clean repo', () => {
    initGitRepo(tmpDir);
    const info = getGitInfo(tmpDir);
    assert.equal(info.branch, 'main');
    assert.equal(info.dirtyCount, 0);
    assert.ok(Array.isArray(info.branches));
    assert.ok(info.branches.includes('main'));
  });

  it('returns dirty count for modified + untracked files', () => {
    initGitRepo(tmpDir);
    // Modify tracked file
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Modified\n');
    // Add untracked file
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'hello\n');
    const info = getGitInfo(tmpDir);
    assert.equal(info.dirtyCount, 2);
  });

  it('returns defaults for non-git directory', () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
    try {
      const info = getGitInfo(plainDir);
      assert.equal(info.branch, '?');
      assert.equal(info.dirtyCount, 0);
      assert.deepEqual(info.branches, []);
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});

// ── createCheckpoint ─────────────────────────────────────────

describe('createCheckpoint', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates a checkpoint branch from current state', () => {
    initGitRepo(tmpDir);
    const result = createCheckpoint(tmpDir);

    assert.ok(result.checkpointId.startsWith('checkpoint/'));
    assert.equal(result.originalBranch, 'main');

    // Verify the checkpoint branch exists in git
    const branches = execSync(`git -C "${tmpDir}" branch --list "checkpoint/*"`, { encoding: 'utf8' }).trim();
    assert.ok(branches.includes(result.checkpointId));

    // Verify we're back on main
    const current = execSync(`git -C "${tmpDir}" branch --show-current`, { encoding: 'utf8' }).trim();
    assert.equal(current, 'main');
  });

  it('captures uncommitted changes with exact filesStashed count', () => {
    initGitRepo(tmpDir);
    // Add exactly one untracked file
    fs.writeFileSync(path.join(tmpDir, 'extra.txt'), 'extra\n');
    const result = createCheckpoint(tmpDir);
    // README.md was already committed; only extra.txt is new
    assert.equal(result.filesStashed, 1);

    // Verify we're back on main
    const current = execSync(`git -C "${tmpDir}" branch --show-current`, { encoding: 'utf8' }).trim();
    assert.equal(current, 'main');
  });

  it('throws when already on a checkpoint branch', () => {
    initGitRepo(tmpDir);
    execSync(`git -C "${tmpDir}" checkout -b checkpoint/test-branch`, { encoding: 'utf8' });
    assert.throws(() => createCheckpoint(tmpDir), /already on a checkpoint branch/);
  });
});

// ── revertCheckpoint ─────────────────────────────────────────

describe('revertCheckpoint', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('reverts to checkpoint state', () => {
    initGitRepo(tmpDir);
    // Create a file, checkpoint it
    fs.writeFileSync(path.join(tmpDir, 'keep.txt'), 'keep me\n');
    const cp = createCheckpoint(tmpDir);

    // Make new changes after checkpoint
    fs.writeFileSync(path.join(tmpDir, 'discard.txt'), 'throw away\n');

    // Revert to checkpoint
    const result = revertCheckpoint(tmpDir, cp.checkpointId);
    assert.equal(result.checkpointId, cp.checkpointId);

    // keep.txt should exist (was in checkpoint)
    assert.ok(fs.existsSync(path.join(tmpDir, 'keep.txt')));

    // Checkpoint branch should be deleted
    const branches = execSync(`git -C "${tmpDir}" branch --list "checkpoint/*"`, { encoding: 'utf8' }).trim();
    assert.equal(branches, '');
  });

  it('throws for nonexistent checkpoint', () => {
    initGitRepo(tmpDir);
    assert.throws(() => revertCheckpoint(tmpDir, 'checkpoint/fake-id'), /not found/);
  });
});

// ── dismissCheckpoint ────────────────────────────────────────

describe('dismissCheckpoint', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('deletes the checkpoint branch without changing working directory', () => {
    initGitRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'work.txt'), 'in progress\n');
    const cp = createCheckpoint(tmpDir);

    // Add more work after checkpoint
    fs.writeFileSync(path.join(tmpDir, 'more.txt'), 'more work\n');

    const result = dismissCheckpoint(tmpDir, cp.checkpointId);
    assert.equal(result.checkpointId, cp.checkpointId);

    // Checkpoint branch should be gone
    const branches = execSync(`git -C "${tmpDir}" branch --list "checkpoint/*"`, { encoding: 'utf8' }).trim();
    assert.equal(branches, '');

    // Working directory unchanged — more.txt still exists
    assert.ok(fs.existsSync(path.join(tmpDir, 'more.txt')));
  });

  it('throws for nonexistent checkpoint', () => {
    initGitRepo(tmpDir);
    assert.throws(() => dismissCheckpoint(tmpDir, 'checkpoint/fake-id'), /not found/);
  });
});

// ── listCheckpoints ──────────────────────────────────────────

describe('listCheckpoints', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('lists all checkpoint branches', () => {
    initGitRepo(tmpDir);
    // Create two checkpoints with distinct files so they're separate commits
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a\n');
    createCheckpoint(tmpDir);

    // Wait 1 second to ensure different timestamp in branch name
    execSync('sleep 1');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b\n');
    createCheckpoint(tmpDir);

    const list = listCheckpoints(tmpDir);
    assert.equal(list.length, 2);

    for (const cp of list) {
      assert.ok(cp.id.startsWith('checkpoint/'));
      assert.ok(cp.created); // ISO date string
      assert.equal(typeof cp.filesStashed, 'number');
      assert.equal(cp.originalBranch, 'main');
    }
  });

  it('returns empty array when no checkpoints exist', () => {
    initGitRepo(tmpDir);
    const list = listCheckpoints(tmpDir);
    assert.deepEqual(list, []);
  });
});

// ── normalizeStatus (via parseJobFile) ───────────────────────

describe('normalizeStatus via parseJobFile', () => {
  beforeEach(setup);
  afterEach(teardown);

  function makeJob(status) {
    const content = [
      `# Job Task: Test job`,
      `Started: 2026-03-26 12:00:00`,
      `Status: ${status}`,
      ``,
      `## Progress`,
      `- [2026-03-26 12:00] Started`,
      ``,
      `## Results`,
    ].join('\n');
    const p = path.join(tmpDir, 'test-job.md');
    fs.writeFileSync(p, content);
    return p;
  }

  it('normalizes all known status strings through parseJobFile', () => {
    // Test each status variant
    const cases = [
      ['Complete', 'completed'],
      ['Completed', 'completed'],
      ['In progress', 'in_progress'],
      ['Failed', 'failed'],
      ['Killed', 'killed'],
    ];
    for (const [input, expected] of cases) {
      const p = makeJob(input);
      const result = parseJobFile(p);
      assert.equal(result.status, expected, `normalizeStatus('${input}') should be '${expected}'`);
    }
  });
});
