/**
 * Integration tests for dashboard/server.js — Express API endpoints
 * Run: cd dashboard && node --test server.integration.test.mjs
 *
 * Phase 1: Tests pure HTTP endpoints only.
 * WebSocket/PTY sessions are out of scope (require tmux + running processes).
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

let tmpDir;
let server;
let baseUrl;

/**
 * Create a test hub filesystem structure and set HUB_DIR before importing server.
 */
function createTestHub() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-int-'));

  const repoDir = path.join(tmpDir, 'testrepo');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'notes', 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'notes', 'swarm'), { recursive: true });

  // config.json
  fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
    repos: [
      {
        name: 'testrepo',
        path: 'testrepo',
        taskFile: 'todo.md',
        bugsFile: 'bugs.md',
        activityFile: 'activity-log.md',
      },
    ],
    hubRoot: '.',
  }, null, 2));

  // todo.md
  fs.writeFileSync(path.join(repoDir, 'todo.md'), [
    '## Tasks',
    '- [ ] First task',
    '- [ ] Second task',
    '- [x] Done task',
  ].join('\n'));

  // bugs.md
  fs.writeFileSync(path.join(repoDir, 'bugs.md'), [
    '## Bugs',
    '- [ ] Bug one',
    '- [x] Fixed bug',
  ].join('\n'));

  // activity-log.md
  fs.writeFileSync(path.join(repoDir, 'activity-log.md'), [
    '**Current stage:** Testing',
    '',
    '## 2026-03-26',
    '- Set up test hub',
  ].join('\n'));

  // .hub-runtime directory
  fs.mkdirSync(path.join(tmpDir, '.hub-runtime'), { recursive: true });

  // Init git repo
  execSync(`git init -b main "${repoDir}"`, { encoding: 'utf8' });
  execSync(`git -C "${repoDir}" config user.email "test@test.com"`, { encoding: 'utf8' });
  execSync(`git -C "${repoDir}" config user.name "Test"`, { encoding: 'utf8' });
  execSync(`git -C "${repoDir}" add -A && git -C "${repoDir}" commit -m "init"`, { encoding: 'utf8' });

  return { repoDir };
}

/**
 * Create a job file in the test repo.
 */
function createJobFile(repoDir, jobId, opts = {}) {
  const status = opts.status || 'Completed';
  const validation = opts.validation || 'Needs validation';
  const content = [
    `# Job Task: Test job`,
    `Started: 2026-03-26 12:00:00`,
    `Status: ${status}`,
    `Validation: ${validation}`,
    `Repo: testrepo`,
    `Session: session-test-123`,
    '',
    '## Progress',
    '- [2026-03-26 12:00] Started',
    '',
    '## Results',
    'Test results here',
  ].join('\n');
  const filePath = path.join(repoDir, 'notes', 'jobs', `${jobId}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ── Setup & Teardown ─────────────────────────────────────────

before(async () => {
  const { repoDir } = createTestHub();

  // Set env vars before importing server
  process.env.HUB_DIR = tmpDir;
  process.env.TESTING = '1';

  const mod = await import('./server.js');
  const app = mod.app;

  // Start on random port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  delete process.env.HUB_DIR;
  delete process.env.TESTING;
});

// ── Helper ───────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json();
  return { status: res.status, json };
}

// ── GET endpoints ────────────────────────────────────────────

describe('Dashboard GET endpoints', () => {
  it('GET /api/config returns repos array', async () => {
    const { status, json } = await api('GET', '/api/config');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.repos));
    assert.equal(json.repos[0].name, 'testrepo');
  });

  it('GET /api/overview returns stage, repos, totals', async () => {
    const { status, json } = await api('GET', '/api/overview');
    assert.equal(status, 200);
    assert.ok('stage' in json);
    assert.ok(Array.isArray(json.repos));
    assert.ok('totals' in json);
    assert.equal(json.repos[0].name, 'testrepo');
  });

  it('GET /api/jobs returns jobs array and summary', async () => {
    const { status, json } = await api('GET', '/api/jobs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.jobs));
    assert.ok('summary' in json);
  });

  it('GET /api/jobs/:id returns 200 for a valid job', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-get-test');

    const { status, json } = await api('GET', '/api/jobs/2026-03-26-get-test');
    assert.equal(status, 200);
    assert.equal(json.id, '2026-03-26-get-test');
    assert.ok(json.taskName);
  });

  it('GET /api/jobs/:id returns 404 for missing job', async () => {
    const { status, json } = await api('GET', '/api/jobs/nonexistent-job');
    assert.equal(status, 404);
    assert.ok(json.error);
  });
});

// ── POST write endpoints ─────────────────────────────────────

describe('Dashboard POST write endpoints', () => {
  it('POST /api/tasks/done marks task done', async () => {
    // Reset the todo.md before this test
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'todo.md'), [
      '## Tasks',
      '- [ ] API test task 1',
      '- [ ] API test task 2',
    ].join('\n'));

    const { status, json } = await api('POST', '/api/tasks/done', {
      repo: 'testrepo',
      taskNum: 1,
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const content = fs.readFileSync(path.join(repoDir, 'todo.md'), 'utf8');
    assert.ok(content.includes('[x] API test task 1'));
  });

  it('POST /api/tasks/add adds a new task', async () => {
    const { status, json } = await api('POST', '/api/tasks/add', {
      repo: 'testrepo',
      text: 'New task via API',
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const repoDir = path.join(tmpDir, 'testrepo');
    const content = fs.readFileSync(path.join(repoDir, 'todo.md'), 'utf8');
    assert.ok(content.includes('New task via API'));
  });

  it('POST /api/tasks/done-by-text matches by text', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'todo.md'), [
      '## Tasks',
      '- [ ] Unique task for text match',
      '- [ ] Another task',
    ].join('\n'));

    const { status, json } = await api('POST', '/api/tasks/done-by-text', {
      repo: 'testrepo',
      text: 'Unique task for text match',
    });
    assert.equal(status, 200);
    assert.ok(json.success);
  });

  it('POST /api/jobs/:id/validate sets validation to Validated', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-validate-test');

    const { status, json } = await api('POST', '/api/jobs/2026-03-26-validate-test/validate', {
      notes: 'Looks good',
    });
    assert.equal(status, 200);

    const content = fs.readFileSync(
      path.join(repoDir, 'notes', 'jobs', '2026-03-26-validate-test.md'), 'utf8'
    );
    assert.ok(content.includes('Validation: Validated'));
  });

  it('POST /api/jobs/:id/kill sets status to Killed', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-kill-test', { status: 'In progress' });

    const { status, json } = await api('POST', '/api/jobs/2026-03-26-kill-test/kill');
    assert.equal(status, 200);

    const content = fs.readFileSync(
      path.join(repoDir, 'notes', 'jobs', '2026-03-26-kill-test.md'), 'utf8'
    );
    assert.ok(content.includes('Status: Killed'));
  });
});

// ── Critical write paths (from validation feedback) ──────────

describe('Dashboard critical write paths', () => {
  it('POST /api/jobs/:id/reject rejects with notes', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-reject-api-test');

    const { status, json } = await api('POST', '/api/jobs/2026-03-26-reject-api-test/reject', {
      notes: 'Needs more tests',
    });
    assert.equal(status, 200);

    const content = fs.readFileSync(
      path.join(repoDir, 'notes', 'jobs', '2026-03-26-reject-api-test.md'), 'utf8'
    );
    assert.ok(content.includes('Validation: Rejected'));
  });

  it('POST /api/jobs/:id/reject returns 400 without notes', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-reject-no-notes');

    const { status, json } = await api('POST', '/api/jobs/2026-03-26-reject-no-notes/reject', {});
    assert.equal(status, 400);
    assert.ok(json.error);
  });

  it('DELETE /api/jobs/:id deletes the job file', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    const filePath = createJobFile(repoDir, '2026-03-26-delete-test');
    assert.ok(fs.existsSync(filePath));

    const { status, json } = await api('DELETE', '/api/jobs/2026-03-26-delete-test');
    assert.equal(status, 200);
    assert.ok(json.ok);

    assert.ok(!fs.existsSync(filePath));
  });
});

// ── Error handling ───────────────────────────────────────────

describe('Dashboard error handling', () => {
  it('POST /api/tasks/done with missing body returns 400', async () => {
    const { status, json } = await api('POST', '/api/tasks/done', {});
    assert.equal(status, 400);
    assert.ok(json.error);
  });

  it('POST /api/tasks/done to nonexistent repo returns 404', async () => {
    const { status, json } = await api('POST', '/api/tasks/done', {
      repo: 'nonexistent',
      taskNum: 1,
    });
    assert.equal(status, 404);
    assert.ok(json.error);
  });
});
