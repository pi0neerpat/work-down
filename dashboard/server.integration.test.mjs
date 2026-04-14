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
import http from 'node:http';
import { execSync } from 'child_process';

let tmpDir;
let server;
let baseUrl;

/**
 * Create a test dispatch root filesystem structure and set DISPATCH_ROOT before importing server.
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
    dispatchRoot: '.',
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

  // .dispatch/runtime directory
  fs.mkdirSync(path.join(tmpDir, '.dispatch', 'runtime'), { recursive: true });

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
  process.env.DISPATCH_ROOT = tmpDir;
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
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  delete process.env.DISPATCH_ROOT;
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

/**
 * Send a raw HTTP request using node:http (bypasses fetch URL normalisation).
 * Required for path traversal tests where '..' must survive to the server.
 */
async function rawRequest(method, rawPath, body) {
  return new Promise((resolve, reject) => {
    const { port } = new URL(baseUrl);
    const opts = {
      host: '127.0.0.1',
      port: parseInt(port),
      path: rawPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Create a plan file in the test repo's plans/ directory.
 */
function createPlanFile(repoDir, slug, content) {
  const plansDir = path.join(repoDir, 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  const filePath = path.join(plansDir, `${slug}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── GET endpoints ────────────────────────────────────────────

describe('Dashboard GET endpoints', () => {
  it('GET /api/config returns repos array', async () => {
    const { status, json } = await api('GET', '/api/config');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.repos));
    assert.equal(json.repos[0].name, 'testrepo');
  });

  it('GET /api/catalog returns repos, agents, models, modelSources', async () => {
    const { status, json } = await api('GET', '/api/catalog');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.repos));
    assert.equal(json.repos[0].name, 'testrepo');
    assert.ok(json.repos[0].taskFile);
    assert.ok(Array.isArray(json.agents));
    assert.ok(json.agents.some((a) => a.id === 'claude'));
    assert.ok(json.models && typeof json.models === 'object');
    assert.ok(json.models.claude && Array.isArray(json.models.claude));
    assert.ok(json.modelSources && json.modelSources.claude);
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

  it('POST /api/jobs/init links follow-up jobs linearly', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-parent-job');

    const { status, json } = await api('POST', '/api/jobs/init', {
      repo: 'testrepo',
      taskText: 'Follow up on parent job',
      previousJobId: '2026-03-26-parent-job',
    });
    assert.equal(status, 200);
    assert.ok(json.fileName);

    const childId = json.fileName.replace(/\.md$/, '');
    const childContent = fs.readFileSync(
      path.join(repoDir, 'notes', 'jobs', `${childId}.md`),
      'utf8'
    );
    const parentContent = fs.readFileSync(
      path.join(repoDir, 'notes', 'jobs', '2026-03-26-parent-job.md'),
      'utf8'
    );

    assert.ok(childContent.includes('PreviousJob: 2026-03-26-parent-job'));
    assert.ok(parentContent.includes(`NextJob: ${childId}`));

    await api('DELETE', `/api/sessions/${encodeURIComponent(json.sessionId)}`);
    await api('DELETE', `/api/sessions/${encodeURIComponent(json.sessionId)}/purge`);
  });

  it('POST /api/jobs/init rejects branching from a job that already has a next link', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    const filePath = path.join(repoDir, 'notes', 'jobs', '2026-03-26-linear-parent.md');
    fs.writeFileSync(filePath, [
      '# Job Task: Linear parent',
      'Started: 2026-03-26 12:00:00',
      'Status: Completed',
      'Validation: Needs validation',
      'Repo: testrepo',
      'NextJob: 2026-03-26-existing-child',
      '',
      '## Progress',
      '',
      '## Results',
    ].join('\n'));

    const { status, json } = await api('POST', '/api/jobs/init', {
      repo: 'testrepo',
      taskText: 'Attempt second follow up',
      previousJobId: '2026-03-26-linear-parent',
    });
    assert.equal(status, 409);
    assert.ok(json.error);
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

  it('POST /api/jobs/:id/kill sets status to Stopped and keeps it reviewable', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-kill-test', { status: 'In progress' });

    const { status, json } = await api('POST', '/api/jobs/2026-03-26-kill-test/kill');
    assert.equal(status, 200);

    const content = fs.readFileSync(
      path.join(repoDir, 'notes', 'jobs', '2026-03-26-kill-test.md'), 'utf8'
    );
    assert.ok(content.includes('Status: Stopped'));
    assert.ok(content.includes('Validation: Needs validation'));
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

// ── Block 1: Input validation & security ─────────────────────

describe('Input validation and security', () => {
  it('GET /api/jobs/../../etc/passwd returns 400 (path traversal)', async () => {
    const result = await rawRequest('GET', '/api/jobs/../../etc/passwd');
    assert.equal(result.status, 400);
    assert.ok(result.json?.error);
  });

  it('GET /api/jobs/../../etc/passwd response is JSON not HTML', async () => {
    const result = await rawRequest('GET', '/api/jobs/../../etc/passwd');
    assert.equal(result.status, 400);
    assert.ok(result.json, 'response should be parseable JSON');
    assert.ok(!result.body.startsWith('<!'), 'response should not be HTML');
  });

  it('GET /api/jobs/:id with shell metacharacters returns 400', async () => {
    const { status } = await api('GET', '/api/jobs/test;rm-rf');
    assert.equal(status, 400);
  });

  it('POST /api/jobs/init with baseBranch containing semicolon returns 400', async () => {
    const { status, json } = await api('POST', '/api/jobs/init', {
      repo: 'testrepo',
      taskText: 'test task',
      baseBranch: 'main;rm -rf /',
    });
    assert.equal(status, 400);
    assert.ok(json.error);
  });

  it('POST /api/hooks/stop-ready with bad sessionId format returns 400', async () => {
    const { status, json } = await api('POST', '/api/hooks/stop-ready', {
      sessionId: 'bad-session-id',
      jobId: '2026-03-26-some-job',
    });
    assert.equal(status, 400);
    assert.ok(json.error);
  });

  it('POST /api/hooks/stop-ready with missing fields returns 400', async () => {
    const { status, json } = await api('POST', '/api/hooks/stop-ready', {});
    assert.equal(status, 400);
    assert.ok(json.error);
  });
});

// ── Block 2: Missing GET endpoints ───────────────────────────

describe('Missing GET endpoints', () => {
  it('GET /api/activity returns entries array', async () => {
    const { status, json } = await api('GET', '/api/activity');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.entries));
  });

  it('GET /api/activity?limit=2 respects limit', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'activity-log.md'), [
      '## 2026-03-30',
      '- Entry 1',
      '- Entry 2',
      '- Entry 3',
    ].join('\n'));

    const { status, json } = await api('GET', '/api/activity?limit=2');
    assert.equal(status, 200);
    assert.ok(json.entries.length <= 2);
  });

  it('GET /api/jobs/:id/diff returns {merged:true} for no-branch job', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createJobFile(repoDir, '2026-03-26-diff-test');
    const { status, json } = await api('GET', '/api/jobs/2026-03-26-diff-test/diff');
    assert.equal(status, 200);
    assert.equal(json.merged, true);
  });

  it('GET /api/plans returns array', async () => {
    const { status, json } = await api('GET', '/api/plans');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json));
  });

  it('GET /api/plans/:repo/:slug returns 404 for missing plan', async () => {
    const { status, json } = await api('GET', '/api/plans/testrepo/nonexistent-plan');
    assert.equal(status, 404);
    assert.ok(json.error);
  });

  it('GET /api/skills returns {local, global} arrays', async () => {
    const { status, json } = await api('GET', '/api/skills');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.local));
    assert.ok(Array.isArray(json.global));
  });

  it('GET /api/agents/models?agent=claude returns {models, source}', async () => {
    const { status, json } = await api('GET', '/api/agents/models?agent=claude');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.models));
    assert.ok(json.source);
  });

  it('GET /api/repos/:name/checkpoints returns checkpoints array', async () => {
    const { status, json } = await api('GET', '/api/repos/testrepo/checkpoints');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.checkpoints));
  });

  it('GET /api/repos/nonexistent/checkpoints returns 404', async () => {
    const { status, json } = await api('GET', '/api/repos/nonexistent/checkpoints');
    assert.equal(status, 404);
    assert.ok(json.error);
  });

  it('GET /api/schedules returns schedules array', async () => {
    const { status, json } = await api('GET', '/api/schedules');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.schedules));
  });
});

// ── Block 3: Task mutations ───────────────────────────────────

describe('Task mutations', () => {
  it('POST /api/tasks/edit updates task text', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'todo.md'), [
      '## Tasks',
      '- [ ] Original task text',
    ].join('\n'));

    const { status, json } = await api('POST', '/api/tasks/edit', {
      repo: 'testrepo',
      taskNum: 1,
      newText: 'Updated task text',
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const content = fs.readFileSync(path.join(repoDir, 'todo.md'), 'utf8');
    assert.ok(content.includes('Updated task text'));
  });

  it('POST /api/tasks/reopen-by-text reopens a done task', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'todo.md'), [
      '## Tasks',
      '- [x] Task to reopen',
      '- [ ] Open task',
    ].join('\n'));

    const { status, json } = await api('POST', '/api/tasks/reopen-by-text', {
      repo: 'testrepo',
      text: 'Task to reopen',
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const content = fs.readFileSync(path.join(repoDir, 'todo.md'), 'utf8');
    assert.ok(content.includes('[ ] Task to reopen'));
  });

  it('POST /api/tasks/move moves task to another repo', async () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const hadRepo2 = config.repos.some(r => r.name === 'repo2');

    // Set up a second repo
    const repo2Dir = path.join(tmpDir, 'repo2');
    fs.mkdirSync(repo2Dir, { recursive: true });
    fs.writeFileSync(path.join(repo2Dir, 'todo.md'), '## Tasks\n');

    if (!hadRepo2) {
      config.repos.push({ name: 'repo2', path: 'repo2', taskFile: 'todo.md', activityFile: 'activity-log.md' });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'todo.md'), '## Tasks\n- [ ] Task to move\n');

    try {
      const { status, json } = await api('POST', '/api/tasks/move', {
        fromRepo: 'testrepo',
        taskNum: 1,
        toRepo: 'repo2',
        section: 'Tasks',
      });
      assert.equal(status, 200);
      assert.ok(json.moved);

      const destContent = fs.readFileSync(path.join(repo2Dir, 'todo.md'), 'utf8');
      assert.ok(destContent.includes('Task to move'));
    } finally {
      if (!hadRepo2) {
        config.repos = config.repos.filter(r => r.name !== 'repo2');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
    }
  });
});

// ── Block 4: Bug endpoints ────────────────────────────────────

describe('Bug endpoints', () => {
  beforeEach(() => {
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.writeFileSync(path.join(repoDir, 'bugs.md'), [
      '## Bugs',
      '- [ ] Bug one',
      '- [x] Fixed bug',
    ].join('\n'));
  });

  it('POST /api/bugs/add adds a bug', async () => {
    const { status, json } = await api('POST', '/api/bugs/add', {
      repo: 'testrepo',
      text: 'New bug via API',
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const repoDir = path.join(tmpDir, 'testrepo');
    const content = fs.readFileSync(path.join(repoDir, 'bugs.md'), 'utf8');
    assert.ok(content.includes('New bug via API'));
  });

  it('POST /api/bugs/done marks bug done by number', async () => {
    const { status, json } = await api('POST', '/api/bugs/done', {
      repo: 'testrepo',
      taskNum: 1,
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const repoDir = path.join(tmpDir, 'testrepo');
    const content = fs.readFileSync(path.join(repoDir, 'bugs.md'), 'utf8');
    assert.ok(content.includes('[x] Bug one'));
  });

  it('POST /api/bugs/done-by-text marks bug done by text', async () => {
    const { status, json } = await api('POST', '/api/bugs/done-by-text', {
      repo: 'testrepo',
      text: 'Bug one',
    });
    assert.equal(status, 200);
    assert.ok(json.success);
  });

  it('POST /api/bugs/reopen-by-text reopens a bug', async () => {
    const { status, json } = await api('POST', '/api/bugs/reopen-by-text', {
      repo: 'testrepo',
      text: 'Fixed bug',
    });
    assert.equal(status, 200);
    assert.ok(json.success);

    const repoDir = path.join(tmpDir, 'testrepo');
    const content = fs.readFileSync(path.join(repoDir, 'bugs.md'), 'utf8');
    assert.ok(content.includes('[ ] Fixed bug'));
  });

  it('POST /api/bugs/edit updates bug text', async () => {
    const { status, json } = await api('POST', '/api/bugs/edit', {
      repo: 'testrepo',
      taskNum: 1,
      newText: 'Updated bug text',
    });
    assert.equal(status, 200);
    assert.ok(json.success);
  });

  it('POST /api/bugs/add to repo without bugsFile returns 400', async () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const hadNobug = config.repos.some(r => r.name === 'nobug');

    const nobugDir = path.join(tmpDir, 'nobug');
    fs.mkdirSync(nobugDir, { recursive: true });
    fs.writeFileSync(path.join(nobugDir, 'todo.md'), '## Tasks\n');

    if (!hadNobug) {
      config.repos.push({ name: 'nobug', path: 'nobug', taskFile: 'todo.md', activityFile: 'activity-log.md' });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    try {
      const { status, json } = await api('POST', '/api/bugs/add', {
        repo: 'nobug',
        text: 'Some bug',
      });
      assert.equal(status, 400);
      assert.ok(json.error);
    } finally {
      if (!hadNobug) {
        config.repos = config.repos.filter(r => r.name !== 'nobug');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
    }
  });
});

// ── Block 5: Plans endpoints ──────────────────────────────────

describe('Plans endpoints', () => {
  it('GET /api/plans/:repo/:slug returns content for existing plan', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createPlanFile(repoDir, 'test-plan', '# Test Plan\n\nSome content here.');

    const { status, json } = await api('GET', '/api/plans/testrepo/test-plan');
    assert.equal(status, 200);
    assert.equal(json.slug, 'test-plan');
    assert.ok(json.content);
    assert.ok(json.title);
  });

  it('PUT /api/plans/:repo/:slug creates plan file', async () => {
    const { status, json } = await api('PUT', '/api/plans/testrepo/new-plan', {
      content: '# New Plan\n\nPlan content.',
    });
    assert.equal(status, 200);
    assert.ok(json.ok);

    const repoDir = path.join(tmpDir, 'testrepo');
    assert.ok(fs.existsSync(path.join(repoDir, 'plans', 'new-plan.md')));
  });

  it('PUT /api/plans/:repo/:slug updates existing plan content', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createPlanFile(repoDir, 'update-plan', '# Update Plan\n\nOriginal content.');

    const { status, json } = await api('PUT', '/api/plans/testrepo/update-plan', {
      content: '# Update Plan\n\nUpdated content.',
    });
    assert.equal(status, 200);
    assert.ok(json.ok);

    const content = fs.readFileSync(path.join(repoDir, 'plans', 'update-plan.md'), 'utf8');
    assert.ok(content.includes('Updated content'));
  });

  it('POST /api/plans/:repo/:slug/status sets status: ready', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createPlanFile(repoDir, 'status-plan', '# Status Plan\n');

    const { status, json } = await api('POST', '/api/plans/testrepo/status-plan/status', {
      status: 'ready',
    });
    assert.equal(status, 200);
    assert.ok(json.ok);
  });

  it('POST /api/plans/:repo/:slug/status clears status with null', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    createPlanFile(repoDir, 'clear-status-plan', 'Status: ready\n# Clear Status Plan\n');

    const { status, json } = await api('POST', '/api/plans/testrepo/clear-status-plan/status', {
      status: null,
    });
    assert.equal(status, 200);
    assert.ok(json.ok);
  });

  it('PUT /api/plans/nonexistent/:slug returns 404', async () => {
    const { status, json } = await api('PUT', '/api/plans/nonexistent/some-plan', {
      content: '# Some Plan',
    });
    assert.equal(status, 404);
    assert.ok(json.error);
  });
});

// ── Block 6: Schedules CRUD ───────────────────────────────────

describe('Schedules CRUD', () => {
  afterEach(() => {
    const schedulesFile = path.join(tmpDir, 'schedules.json');
    if (fs.existsSync(schedulesFile)) fs.unlinkSync(schedulesFile);
  });

  it('POST /api/schedules creates a schedule', async () => {
    const { status, json } = await api('POST', '/api/schedules', {
      name: 'Test Schedule',
      repo: 'testrepo',
      cron: '0 9 * * 1',
      prompt: 'Run weekly check',
    });
    assert.equal(status, 200);
    const sched = json.schedule;
    assert.ok(sched.id);
    assert.equal(sched.name, 'Test Schedule');
    assert.ok(sched.enabled);
  });

  it('POST /api/schedules missing fields returns 400', async () => {
    const { status, json } = await api('POST', '/api/schedules', {
      name: 'Incomplete Schedule',
    });
    assert.equal(status, 400);
    assert.ok(json.error);
  });

  it('PUT /api/schedules/:id updates schedule fields', async () => {
    const createResp = await api('POST', '/api/schedules', {
      name: 'Update Test',
      repo: 'testrepo',
      cron: '0 9 * * 1',
      prompt: 'Initial prompt',
    });
    assert.equal(createResp.status, 200);
    const scheduleId = createResp.json.schedule.id;

    const { status, json } = await api('PUT', `/api/schedules/${scheduleId}`, {
      name: 'Updated Name',
    });
    assert.equal(status, 200);
    assert.equal(json.name, 'Updated Name');
  });

  it('PUT /api/schedules/nonexistent returns 404', async () => {
    const { status, json } = await api('PUT', '/api/schedules/sched-nonexistent', {
      name: 'Foo',
    });
    assert.equal(status, 404);
    assert.ok(json.error);
  });

  it('POST /api/schedules/:id/toggle flips enabled', async () => {
    const createResp = await api('POST', '/api/schedules', {
      name: 'Toggle Test',
      repo: 'testrepo',
      cron: '0 9 * * 1',
      prompt: 'Check something',
    });
    assert.equal(createResp.status, 200);
    const scheduleId = createResp.json.schedule.id;
    const originalEnabled = createResp.json.schedule.enabled;

    const { status, json } = await api('POST', `/api/schedules/${scheduleId}/toggle`);
    assert.equal(status, 200);
    assert.equal(json.enabled, !originalEnabled);
  });

  it('DELETE /api/schedules/:id removes schedule', async () => {
    const createResp = await api('POST', '/api/schedules', {
      name: 'Delete Test',
      repo: 'testrepo',
      cron: '0 9 * * 1',
      prompt: 'Some prompt',
    });
    assert.equal(createResp.status, 200);
    const scheduleId = createResp.json.schedule.id;

    const { status, json } = await api('DELETE', `/api/schedules/${scheduleId}`);
    assert.equal(status, 200);
    assert.ok(json.ok);
  });

  it('DELETE /api/schedules/nonexistent returns 404', async () => {
    const { status, json } = await api('DELETE', '/api/schedules/sched-nonexistent');
    assert.equal(status, 404);
    assert.ok(json.error);
  });
});

// ── Block 7: Checkpoint endpoints (non-destructive) ───────────

describe('Checkpoint endpoints', () => {
  it('POST /api/repos/nonexistent/checkpoint returns 404', async () => {
    const { status, json } = await api('POST', '/api/repos/nonexistent/checkpoint');
    assert.equal(status, 404);
    assert.ok(json.error);
  });

  it('POST /api/repos/:name/checkpoint creates a checkpoint branch', async () => {
    const { status, json } = await api('POST', '/api/repos/testrepo/checkpoint');
    assert.equal(status, 200);
    assert.ok(json.checkpointId);
    assert.ok(json.checkpointId.startsWith('checkpoint/'));
  });

  it('GET /api/repos/:name/checkpoints returns the new checkpoint', async () => {
    const { status, json } = await api('GET', '/api/repos/testrepo/checkpoints');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.checkpoints));
    assert.ok(json.checkpoints.length >= 1);
  });

  it('DELETE /api/repos/:name/checkpoint/:id removes it', async () => {
    const listResp = await api('GET', '/api/repos/testrepo/checkpoints');
    assert.equal(listResp.status, 200);
    const checkpoints = listResp.json.checkpoints;
    assert.ok(checkpoints.length > 0, 'need at least one checkpoint to delete');

    const fullId = checkpoints[0].id; // e.g. 'checkpoint/20260330-143022'
    const idPart = fullId.replace('checkpoint/', '');

    const { status, json } = await api('DELETE', `/api/repos/testrepo/checkpoint/${idPart}`);
    assert.equal(status, 200);
    assert.ok(json.checkpointId);
  });
});

// ── Block 8: Hook endpoint ────────────────────────────────────

describe('Hooks', () => {
  // Must be valid UUID format: session-[a-f0-9-]{36}
  const validSessionId = 'session-a5e8e5f2-7c30-4853-81e1-6c3e5bf3b4a6';

  it('POST /api/hooks/stop-ready marks job awaiting_validation', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    // Recreate notes/jobs/ in case the checkpoint git checkout removed it
    fs.mkdirSync(path.join(repoDir, 'notes', 'jobs'), { recursive: true });
    const jobId = '2026-03-26-hook-stop-test';
    const content = [
      `# Job Task: Hook stop test`,
      `Started: 2026-03-26 12:00:00`,
      `Status: In progress`,
      `Repo: testrepo`,
      `Session: ${validSessionId}`,
      '',
      '## Progress',
      '## Results',
    ].join('\n');
    fs.writeFileSync(path.join(repoDir, 'notes', 'jobs', `${jobId}.md`), content);

    const { status, json } = await api('POST', '/api/hooks/stop-ready', {
      sessionId: validSessionId,
      jobId,
    });
    assert.equal(status, 200);
    assert.ok(json.ok);
    assert.equal(json.validation, 'needs_validation');
  });

  it('POST /api/hooks/stop-ready on already-completed job returns ok', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    const jobId = '2026-03-26-hook-stop-test';

    // Job from previous test is now completed/needs_validation — call again
    const { status, json } = await api('POST', '/api/hooks/stop-ready', {
      sessionId: validSessionId,
      jobId,
    });
    assert.equal(status, 200);
    assert.ok(json.ok);
  });

  it('POST /api/hooks/stop-ready with non-matching sessionId returns 409', async () => {
    const repoDir = path.join(tmpDir, 'testrepo');
    fs.mkdirSync(path.join(repoDir, 'notes', 'jobs'), { recursive: true });
    const jobId = '2026-03-26-hook-mismatch-test';
    const content = [
      `# Job Task: Hook mismatch test`,
      `Started: 2026-03-26 12:00:00`,
      `Status: In progress`,
      `Repo: testrepo`,
      `Session: ${validSessionId}`,
      '',
      '## Progress',
      '## Results',
    ].join('\n');
    fs.writeFileSync(path.join(repoDir, 'notes', 'jobs', `${jobId}.md`), content);

    // Different valid UUID session that doesn't match the job's session
    const wrongSession = 'session-c7f0a5b2-9e41-4b23-8c61-2a3b4d5e6f70';
    const { status, json } = await api('POST', '/api/hooks/stop-ready', {
      sessionId: wrongSession,
      jobId,
    });
    assert.equal(status, 409);
    assert.ok(json.error);
  });
});
