/**
 * Unit tests for parsers.js
 * Run: node --test parsers.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseTaskFile,
  parseActivityLog,
  parseJobFile,
  parseJobDir,
  parsePlansDir,
  parseSkillsDir,
  parseLoopRun,
  parseLoopRunDetailed,
  loadConfig,
  writeTaskDone,
  writeTaskDoneByText,
  writeTaskReopenByText,
  writeTaskAdd,
  writeTaskEdit,
  writeTaskMove,
  writeActivityEntry,
  writeJobValidation,
  writeJobKill,
  writeJobStatus,
  // Schedule
  dateToCron,
  parseCronField,
  cronMatchesDate,
  computeNextRun,
  describeCron,
  validateCron,
  loadSchedules,
  saveSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  findSchedule,
  getAdjacentSchedules,
  loadScheduleEvents,
  appendScheduleEvent,
  clearScheduleEvents,
  acquireScheduleLock,
  releaseScheduleLock,
  getActiveLocks,
} = require('./parsers');

// ── Helpers ──────────────────────────────────────────────────

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parsers-test-'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function tmp(name, content) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function createDirSymlink(targetPath, symlinkPath) {
  fs.mkdirSync(path.dirname(symlinkPath), { recursive: true });
  fs.symlinkSync(
    targetPath,
    symlinkPath,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
}

// ── parseTaskFile ────────────────────────────────────────────

describe('parseTaskFile', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('parses sections with open and done tasks', () => {
    const f = tmp('todo.md', [
      '## Setup',
      '- [ ] Install dependencies',
      '- [x] Create repo',
      '## Features',
      '- [ ] Add login page',
    ].join('\n'));

    const result = parseTaskFile(f);
    assert.equal(result.openCount, 2);
    assert.equal(result.doneCount, 1);
    assert.equal(result.sections.length, 2);
    assert.equal(result.sections[0].name, 'Setup');
    assert.equal(result.sections[0].tasks.length, 2);
    assert.equal(result.sections[0].tasks[0].done, false);
    assert.equal(result.sections[0].tasks[1].done, true);
    assert.equal(result.sections[1].name, 'Features');
  });

  it('strips bold markers and trailing annotations from task text', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] **Important task** (priority: high)',
      '- [x] Done task — **DONE 2026-03-20**',
    ].join('\n'));

    const result = parseTaskFile(f);
    assert.equal(result.allTasks[0].text, 'Important task');
    assert.equal(result.allTasks[1].text, 'Done task');
  });

  it('handles numbered lists', () => {
    const f = tmp('todo.md', [
      '## Sprint',
      '1. [ ] First task',
      '2. [x] Second task',
      '3. [ ] Third task',
    ].join('\n'));

    const result = parseTaskFile(f);
    assert.equal(result.openCount, 2);
    assert.equal(result.doneCount, 1);
  });

  it('tracks timeframe headers', () => {
    const f = tmp('todo.md', [
      '# Past',
      '## Done',
      '- [x] Old task',
      '# Present',
      '## Current',
      '- [ ] Current task',
      '# Future',
      '## Planned',
      '- [ ] Future task',
    ].join('\n'));

    const result = parseTaskFile(f);
    const past = result.allTasks.find(t => t.text === 'Old task');
    const present = result.allTasks.find(t => t.text === 'Current task');
    const future = result.allTasks.find(t => t.text === 'Future task');
    assert.equal(past.timeframe, 'past');
    assert.equal(present.timeframe, 'present');
    assert.equal(future.timeframe, 'future');
  });

  it('assigns openTaskNum only to open tasks', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] First open',
      '- [x] Done one',
      '- [ ] Second open',
    ].join('\n'));

    const result = parseTaskFile(f);
    assert.equal(result.allTasks[0].openTaskNum, 1);
    assert.equal(result.allTasks[1].openTaskNum, null);
    assert.equal(result.allTasks[2].openTaskNum, 2);
  });

  it('returns empty result for missing file', () => {
    const result = parseTaskFile('/nonexistent/todo.md');
    assert.equal(result.openCount, 0);
    assert.equal(result.doneCount, 0);
    assert.deepEqual(result.sections, []);
    assert.deepEqual(result.allTasks, []);
  });

  it('filters out empty sections', () => {
    const f = tmp('todo.md', [
      '## Empty Section',
      '## Tasks',
      '- [ ] Only task',
    ].join('\n'));

    const result = parseTaskFile(f);
    assert.equal(result.sections.length, 1);
    assert.equal(result.sections[0].name, 'Tasks');
  });

  it('strips section name annotations', () => {
    const f = tmp('todo.md', [
      '## Sprint 1 (2/5 done)',
      '- [ ] A task',
    ].join('\n'));

    const result = parseTaskFile(f);
    assert.equal(result.sections[0].name, 'Sprint 1');
  });
});

// ── parseActivityLog ─────────────────────────────────────────

describe('parseActivityLog', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('parses dated sections with bullet entries', () => {
    const f = tmp('activity.md', [
      '**Current stage:** Building',
      '## 2026-03-25',
      '- Added login page',
      '- Fixed bug in parser',
      '## 2026-03-24',
      '- Initial commit',
    ].join('\n'));

    const result = parseActivityLog(f);
    assert.equal(result.stage, 'Building');
    assert.equal(result.entries.length, 3);
    assert.equal(result.entries[0].date, '2026-03-25');
    assert.equal(result.entries[0].bullet, 'Added login page');
    assert.equal(result.entries[2].date, '2026-03-24');
  });

  it('respects limit option', () => {
    const f = tmp('activity.md', [
      '## 2026-03-25',
      '- Entry 1',
      '- Entry 2',
      '- Entry 3',
    ].join('\n'));

    const result = parseActivityLog(f, { limit: 2 });
    assert.equal(result.entries.length, 2);
  });

  it('formats dates compactly when dateFormat is compact', () => {
    const f = tmp('activity.md', [
      '## 2026-01-15',
      '- Something happened',
    ].join('\n'));

    const result = parseActivityLog(f, { dateFormat: 'compact' });
    assert.equal(result.entries[0].date, 'Jan 15');
  });

  it('strips bold and parenthetical annotations from bullets', () => {
    const f = tmp('activity.md', [
      '## 2026-03-25',
      '- **Important** update (by bot)',
    ].join('\n'));

    const result = parseActivityLog(f);
    assert.equal(result.entries[0].bullet, 'Important update');
  });

  it('returns empty result for missing file', () => {
    const result = parseActivityLog('/nonexistent/activity.md');
    assert.equal(result.stage, '');
    assert.deepEqual(result.entries, []);
  });
});

// ── parseJobFile ─────────────────────────────────────────────

describe('parseJobFile', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('parses all metadata fields', () => {
    const f = tmp('2026-03-25-test-job.md', [
      '# Job Task: Build login page',
      'Started: 2026-03-25 10:00:00',
      'Status: In progress',
      'Validation: Needs validation',
      'Repo: app',
      'OriginalPrompt: Build login page\\nwith tests',
      'Session: sess-123',
      'PreviousJob: 2026-03-24-discovery',
      'NextJob: 2026-03-26-polish',
      'SkipPermissions: true',
      'ResumeId: resume-456',
      'ResumeCommand: claude --resume',
      'Branch: job/2026-03-25-test-job',
      'WorktreePath: /tmp/worktrees/2026-03-25-test-job',
      '',
      '## Progress',
      '- Started coding',
      '- Added tests',
      '',
      '## Results',
      'Login page is ready',
      '',
      '## Validation',
      'Looks good',
    ].join('\n'));

    const result = parseJobFile(f);
    assert.equal(result.id, '2026-03-25-test-job');
    assert.equal(result.taskName, 'Build login page');
    assert.equal(result.started, '2026-03-25 10:00:00');
    assert.equal(result.status, 'in_progress');
    assert.equal(result.validation, 'needs_validation');
    assert.equal(result.repo, 'app');
    assert.equal(result.originalPrompt, 'Build login page\\nwith tests');
    assert.equal(result.session, 'sess-123');
    assert.equal(result.previousJobId, '2026-03-24-discovery');
    assert.equal(result.nextJobId, '2026-03-26-polish');
    assert.equal(result.skipPermissions, true);
    assert.equal(result.resumeId, 'resume-456');
    assert.equal(result.resumeCommand, 'claude --resume');
    assert.equal(result.branch, 'job/2026-03-25-test-job');
    assert.equal(result.worktreePath, '/tmp/worktrees/2026-03-25-test-job');
    assert.equal(result.progressCount, 2);
    assert.equal(result.lastProgress, 'Added tests');
    assert.ok(result.results.includes('Login page is ready'));
    assert.ok(result.validationNotes.includes('Looks good'));
  });

  it('returns null branch and worktreePath for legacy jobs', () => {
    const f = tmp('2026-03-25-legacy-job.md', [
      '# Job Task: Old job without worktree',
      'Started: 2026-03-25 10:00:00',
      'Status: Completed',
      'Repo: app',
    ].join('\n'));

    const result = parseJobFile(f);
    assert.equal(result.branch, null);
    assert.equal(result.worktreePath, null);
  });

  it('normalizes status values', () => {
    const cases = [
      ['Complete', 'completed'],
      ['Completed', 'completed'],
      ['In progress', 'in_progress'],
      ['In_progress', 'in_progress'],
      ['Failed', 'failed'],
      ['Killed', 'stopped'],
      ['Stopped', 'stopped'],
    ];
    for (const [raw, expected] of cases) {
      const f = tmp(`job-${raw.replace(/\s/g, '')}.md`, [
        '# Job Task: Test',
        `Status: ${raw}`,
      ].join('\n'));
      assert.equal(parseJobFile(f).status, expected, `"${raw}" should normalize to "${expected}"`);
    }
  });

  it('returns defaults for missing file', () => {
    const result = parseJobFile('/nonexistent/job.md');
    assert.equal(result.status, 'unknown');
    assert.equal(result.taskName, '');
    assert.equal(result.progressCount, 0);
  });

  it('parses legacy Swarm Task header', () => {
    const f = tmp('2026-03-25-legacy.md', [
      '# Swarm Task: Legacy task',
      'Status: Completed',
    ].join('\n'));

    const result = parseJobFile(f);
    assert.equal(result.taskName, 'Legacy task');
  });

  it('parses SkipPermissions variations', () => {
    for (const val of ['true', 'yes', '1']) {
      const f = tmp(`skip-${val}.md`, [
        '# Job Task: Test',
        'Status: In progress',
        `SkipPermissions: ${val}`,
      ].join('\n'));
      assert.equal(parseJobFile(f).skipPermissions, true);
    }

    const f = tmp('skip-false.md', [
      '# Job Task: Test',
      'Status: In progress',
      'SkipPermissions: false',
    ].join('\n'));
    assert.equal(parseJobFile(f).skipPermissions, false);
  });

  it('parses Read variations', () => {
    for (const val of ['true', 'yes', '1']) {
      const f = tmp(`read-${val}.md`, [
        '# Job Task: Test',
        'Status: Completed',
        `Read: ${val}`,
      ].join('\n'));
      assert.equal(parseJobFile(f).read, true);
    }

    const f = tmp('read-false.md', [
      '# Job Task: Test',
      'Status: Completed',
      'Read: false',
    ].join('\n'));
    assert.equal(parseJobFile(f).read, false);
  });
});

// ── parseJobDir ──────────────────────────────────────────────

describe('parseJobDir', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('parses all .md files in a directory', () => {
    const dir = path.join(tmpDir, 'jobs');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '2026-03-25-a.md'), '# Job Task: A\nStatus: Completed\n');
    fs.writeFileSync(path.join(dir, '2026-03-25-b.md'), '# Job Task: B\nStatus: In progress\n');
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a job');

    const results = parseJobDir(dir);
    assert.equal(results.length, 2);
    const names = results.map(r => r.taskName).sort();
    assert.deepEqual(names, ['A', 'B']);
  });

  it('returns empty array for missing directory', () => {
    assert.deepEqual(parseJobDir('/nonexistent/dir'), []);
  });
});

// ── parseLoopRun ─────────────────────────────────────────────

describe('parseLoopRun', () => {
  beforeEach(setup);
  afterEach(teardown);

  function writeLoopLog(lines) {
    const runDir = path.join(tmpDir, '.dispatch', 'loops', 'linear-review', '2026-04-13T16:42:09');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'loop.log'), lines.join('\n'), 'utf8');
    return runDir;
  }

  it('does not treat completion tokens in echoed prompt text as a completed loop', () => {
    const runDir = writeLoopLog([
      'LOOP_SESSION: session-123',
      'LOOP_TYPE: linear-review',
      'LOOP_AGENT: codex:gpt-5.4',
      'LOOP_STARTED: 2026-04-13 16:42:09',
      '---',
      'Starting linear review loop.',
      'Iteration 1 - 2026-04-13 16:42:09',
      'If no issues remain, print exactly:',
      '```',
      'ALL PHASES COMPLETE',
      '```',
      'End your response with exactly one line: VERDICT: PASS or VERDICT: FAIL.',
    ]);

    const result = parseLoopRun(runDir);
    assert.equal(result.iteration, 1);
    assert.equal(result.complete, false);
    assert.equal(result.lastVerdict, null);

    const detailed = parseLoopRunDetailed(runDir);
    assert.equal(detailed.iterations[0].verdict, null);
  });

  it('marks a loop complete from explicit loop completion output', () => {
    const runDir = writeLoopLog([
      'LOOP_SESSION: session-123',
      'LOOP_TYPE: linear-review',
      'LOOP_AGENT: codex:gpt-5.4',
      'LOOP_STARTED: 2026-04-13 16:42:09',
      '---',
      'Iteration 1 - 2026-04-13 16:42:09',
      'ALL PHASES COMPLETE',
      '',
      'All phases complete. Loop done.',
      'LOOP_STATUS: completed',
    ]);

    const result = parseLoopRun(runDir);
    assert.equal(result.complete, true);
    assert.equal(result.lastVerdict, 'ALL PHASES COMPLETE');

    const detailed = parseLoopRunDetailed(runDir);
    assert.equal(detailed.iterations[0].verdict, 'PASS');
  });

  it('parses noisy completion markers from tmux-prefixed lines', () => {
    const runDir = writeLoopLog([
      'LOOP_SESSION: session-123',
      'LOOP_TYPE: linear-review',
      'LOOP_AGENT: codex:gpt-5.4',
      'LOOP_STARTED: 2026-04-13 16:42:09',
      '---',
      'Iteration 1 - 2026-04-13 16:42:09',
      'dispatch % All phases complete. Loop done.',
      'dispatch % LOOP_STATUS: completed',
    ]);

    const result = parseLoopRun(runDir);
    assert.equal(result.complete, true);
    assert.equal(result.loopStatus, 'completed');

    const detailed = parseLoopRunDetailed(runDir);
    assert.equal(detailed.iterations[0].verdict, 'PASS');
  });

  it('parses phase artifacts for linear loops', () => {
    const runDir = writeLoopLog([
      'LOOP_SESSION: session-123',
      'LOOP_TYPE: linear-review',
      'LOOP_AGENT: codex:gpt-5.4',
      'LOOP_STARTED: 2026-04-13 16:42:09',
      '---',
      'Iteration 1 - 2026-04-13 16:42:09',
    ]);
    fs.writeFileSync(path.join(runDir, 'phase_iter1.txt'), 'phase output', 'utf8');

    const detailed = parseLoopRunDetailed(runDir);
    assert.equal(detailed.artifacts.length, 1);
    assert.equal(detailed.artifacts[0].type, 'phase');
    assert.equal(detailed.artifacts[0].iteration, 1);
  });

  it('falls back to status.txt when LOOP_STATUS is missing from loop.log', () => {
    const runDir = writeLoopLog([
      'LOOP_SESSION: session-123',
      'LOOP_TYPE: linear-review',
      'LOOP_AGENT: codex:gpt-5.4',
      'LOOP_STARTED: 2026-04-13 16:42:09',
      '---',
      'Iteration 1 - 2026-04-13 16:42:09',
    ]);
    fs.writeFileSync(path.join(runDir, 'status.txt'), 'completed\n', 'utf8');

    const result = parseLoopRun(runDir);
    assert.equal(result.loopStatus, 'completed');
    assert.equal(result.complete, true);
  });
});

// ── parsePlansDir ────────────────────────────────────────────

describe('parsePlansDir', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('parses plan metadata with full content by default', () => {
    const dir = path.join(tmpDir, 'plans');
    fs.mkdirSync(dir);
    const file = path.join(dir, '2026-03-30-example-plan.md');
    fs.writeFileSync(file, [
      'Dispatched: 2026-03-30',
      'Job: 2026-03-30-address-findings',
      'Status: ready',
      '',
      '# Example Plan',
      '',
      'Body content',
    ].join('\n'), 'utf8');

    const result = parsePlansDir(dir);
    assert.equal(result.length, 1);
    assert.equal(result[0].slug, '2026-03-30-example-plan');
    assert.equal(result[0].title, 'Example Plan');
    assert.equal(result[0].jobSlug, '2026-03-30-address-findings');
    assert.equal(result[0].planStatus, 'ready');
    assert.equal(result[0].dispatched, '2026-03-30');
    assert.ok(result[0].content.includes('Body content'));
  });

  it('supports includeContent=false for lightweight lookups', () => {
    const dir = path.join(tmpDir, 'plans');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '2026-03-30-lookup-plan.md'), [
      'Dispatched: 2026-03-30',
      'Job: 2026-03-30-lightweight',
      'Status: in_progress',
      '',
      '# Lightweight Plan',
      '',
      'Long body line '.repeat(2000),
    ].join('\n'), 'utf8');

    const result = parsePlansDir(dir, { includeContent: false });
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Lightweight Plan');
    assert.equal(result[0].jobSlug, '2026-03-30-lightweight');
    assert.equal(result[0].planStatus, 'in_progress');
    assert.equal('content' in result[0], false);
  });

  it('parses metadata from frontmatter blocks', () => {
    const dir = path.join(tmpDir, 'plans');
    fs.mkdirSync(dir);
    const file = path.join(dir, '2026-03-30-frontmatter-plan.md');
    fs.writeFileSync(file, [
      '---',
      'title: Frontmatter Plan',
      'planStatus: ready',
      'dispatched: 2026-03-30',
      'jobSlug: plan-job',
      'dependsOn:',
      '  - phase-1-branded-types.md',
      '---',
      '',
      '# Frontmatter Plan',
      '',
      'Body content',
    ].join('\n'), 'utf8');

    const result = parsePlansDir(dir);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Frontmatter Plan');
    assert.equal(result[0].planStatus, 'ready');
    assert.equal(result[0].dispatched, '2026-03-30');
    assert.equal(result[0].jobSlug, 'plan-job');
  });
});

// ── parseSkillsDir ───────────────────────────────────────────

describe('parseSkillsDir', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns skills with id and display name from frontmatter', () => {
    tmp('.claude/skills/alpha/SKILL.md', [
      '---',
      'name: Alpha Skill',
      '---',
      '',
      '# Alpha',
    ].join('\n'));
    tmp('.claude/skills/beta/SKILL.md', '# Beta');
    tmp('.claude/skills/gamma/SKILL.md', [
      '---',
      'name: "Gamma Skill"',
      '---',
      '',
      '# Gamma',
    ].join('\n'));
    fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 'missing-skill-file'), { recursive: true });

    const result = parseSkillsDir(tmpDir);
    assert.deepEqual(result, [
      { id: 'alpha', name: 'Alpha Skill' },
      { id: 'beta', name: 'beta' },
      { id: 'gamma', name: 'Gamma Skill' },
    ]);
  });

  it('returns empty array when no global skills directory exists', () => {
    assert.deepEqual(parseSkillsDir(tmpDir), []);
  });

  it('supports recursive skill discovery for nested global skills', () => {
    tmp('.codex/skills/.system/openai-docs/SKILL.md', [
      '---',
      'name: OpenAI Docs',
      '---',
      '',
      '# OpenAI Docs',
    ].join('\n'));
    tmp('.codex/skills/team-workflow/SKILL.md', '# Team Workflow');

    const result = parseSkillsDir(tmpDir, {
      skillsSubdir: path.join('.codex', 'skills'),
      source: 'global',
      includeSource: true,
      idPrefix: 'global:',
      recursive: true,
    });

    assert.deepEqual(result, [
      { id: 'global:.system/openai-docs', name: 'OpenAI Docs', source: 'global' },
      { id: 'global:team-workflow', name: 'team-workflow', source: 'global' },
    ]);
  });

  it('includes symlinked skill directories for local and global scans', () => {
    const localTarget = path.join(tmpDir, 'linked-local-source');
    fs.mkdirSync(localTarget, { recursive: true });
    fs.writeFileSync(path.join(localTarget, 'SKILL.md'), '# Linked local', 'utf8');
    createDirSymlink(localTarget, path.join(tmpDir, '.claude', 'skills', 'linked-local'));

    const globalTarget = path.join(tmpDir, 'linked-global-source');
    fs.mkdirSync(globalTarget, { recursive: true });
    fs.writeFileSync(path.join(globalTarget, 'SKILL.md'), [
      '---',
      'name: Linked Global',
      '---',
      '',
      '# Linked Global',
    ].join('\n'), 'utf8');
    createDirSymlink(globalTarget, path.join(tmpDir, '.codex', 'skills', '.system', 'linked-global'));

    const local = parseSkillsDir(tmpDir);
    const global = parseSkillsDir(tmpDir, {
      skillsSubdir: path.join('.codex', 'skills'),
      source: 'global',
      includeSource: true,
      idPrefix: 'global:',
      recursive: true,
    });

    assert.deepEqual(local, [
      { id: 'linked-local', name: 'linked-local' },
    ]);
    assert.deepEqual(global, [
      { id: 'global:.system/linked-global', name: 'Linked Global', source: 'global' },
    ]);
  });

  it('avoids recursive loops through symlinked directories', () => {
    tmp('.claude/skills/alpha/SKILL.md', '# Alpha');
    createDirSymlink(
      path.join(tmpDir, '.claude', 'skills'),
      path.join(tmpDir, '.claude', 'skills', 'alpha', 'loop')
    );

    const result = parseSkillsDir(tmpDir, { recursive: true });
    assert.deepEqual(result, [
      { id: 'alpha', name: 'alpha' },
    ]);
  });
});

// ── loadConfig ───────────────────────────────────────────────

describe('loadConfig', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('loads config.json and resolves repo paths', () => {
    tmp('config.json', JSON.stringify({
      dispatchRoot: '.',
      repos: [
        { name: 'app', path: '../app', taskFile: 'todo.md' },
        { name: 'api', path: '../api' },
      ],
    }));

    const config = loadConfig(tmpDir);
    assert.equal(config.repos.length, 2);
    assert.equal(config.repos[0].name, 'app');
    assert.ok(path.isAbsolute(config.repos[0].resolvedPath));
    assert.equal(config.dispatchRoot, '.');
  });

  it('prefers config.local.json over config.json', () => {
    tmp('config.json', JSON.stringify({ dispatchRoot: '.', repos: [{ name: 'a', path: './a' }] }));
    tmp('config.local.json', JSON.stringify({ dispatchRoot: '.', repos: [{ name: 'local', path: './local' }] }));

    const config = loadConfig(tmpDir);
    assert.equal(config.repos[0].name, 'local');
  });

  it('maps legacy hubRoot to dispatchRoot when dispatchRoot is absent', () => {
    tmp('config.json', JSON.stringify({
      hubRoot: '../hub',
      repos: [{ name: 'a', path: './a' }],
    }));
    const config = loadConfig(tmpDir);
    assert.equal(config.dispatchRoot, '../hub');
    assert.equal(config.hubRoot, undefined);
  });
});

// ── writeTaskDone ────────────────────────────────────────────

describe('writeTaskDone', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('marks the Nth open task as done', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] First',
      '- [x] Already done',
      '- [ ] Second',
      '- [ ] Third',
    ].join('\n'));

    const result = writeTaskDone(f, 2);
    assert.equal(result.success, true);
    assert.equal(result.text, 'Second');
    const content = read(f);
    assert.ok(content.includes('- [x] Second'));
    // First should still be open
    assert.ok(content.includes('- [ ] First'));
  });

  it('throws for out-of-range task number', () => {
    const f = tmp('todo.md', '## Tasks\n- [ ] Only task\n');

    assert.throws(() => writeTaskDone(f, 5), /open task #5 not found/);
  });
});

// ── writeTaskDoneByText ──────────────────────────────────────

describe('writeTaskDoneByText', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('matches by exact substring', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] Install dependencies',
      '- [ ] Add login page',
    ].join('\n'));

    const result = writeTaskDoneByText(f, 'login page');
    assert.equal(result.success, true);
    assert.ok(result.text.includes('login page'));
    assert.ok(read(f).includes('- [x] Add login page'));
  });

  it('matches by reverse substring (verbose needle)', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] Fix bug',
    ].join('\n'));

    const result = writeTaskDoneByText(f, 'fix bug in the parser module');
    assert.equal(result.success, true);
  });

  it('matches by word overlap', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] Add unit tests for the parser module',
    ].join('\n'));

    const result = writeTaskDoneByText(f, 'parser unit tests');
    assert.equal(result.success, true);
  });

  it('throws when no match found', () => {
    const f = tmp('todo.md', '## Tasks\n- [ ] Unrelated task\n');
    assert.throws(() => writeTaskDoneByText(f, 'xyzzy nonexistent'), /no open task matching/);
  });
});

// ── writeTaskReopenByText ────────────────────────────────────

describe('writeTaskReopenByText', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('reopens a done task matched by text', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [x] Completed task',
      '- [ ] Open task',
    ].join('\n'));

    const result = writeTaskReopenByText(f, 'completed task');
    assert.equal(result.success, true);
    assert.ok(read(f).includes('- [ ] Completed task'));
  });

  it('throws when no done task matches', () => {
    const f = tmp('todo.md', '## Tasks\n- [ ] Open only\n');
    assert.throws(() => writeTaskReopenByText(f, 'open only'), /no done task matching/);
  });
});

// ── writeTaskAdd ─────────────────────────────────────────────

describe('writeTaskAdd', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('adds a task to a named section', () => {
    const f = tmp('todo.md', [
      '## Setup',
      '- [ ] Existing task',
      '## Features',
      '- [ ] Feature one',
    ].join('\n'));

    const result = writeTaskAdd(f, 'New setup task', 'setup');
    assert.equal(result.success, true);
    assert.equal(result.section, 'Setup');
    const content = read(f);
    assert.ok(content.includes('- [ ] New setup task'));
  });

  it('adds to first section with tasks when no section specified', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] Only task',
    ].join('\n'));

    writeTaskAdd(f, 'Another task', null);
    const lines = read(f).split('\n');
    const newTaskIdx = lines.findIndex(l => l.includes('Another task'));
    assert.ok(newTaskIdx > 0);
  });

  it('uses numbered format when previous task is numbered', () => {
    const f = tmp('todo.md', [
      '## Sprint',
      '1. [ ] First',
      '2. [ ] Second',
    ].join('\n'));

    writeTaskAdd(f, 'Third', 'sprint');
    assert.ok(read(f).includes('3. [ ] Third'));
  });

  it('collapses multi-line text into single line', () => {
    const f = tmp('todo.md', '## Tasks\n- [ ] Existing\n');
    writeTaskAdd(f, 'Line one\nLine two\n  extra spaces', 'tasks');
    const content = read(f);
    assert.ok(content.includes('- [ ] Line one Line two extra spaces'));
  });

  it('throws when no task section exists', () => {
    const f = tmp('todo.md', '# Title\nNo tasks here\n');
    assert.throws(() => writeTaskAdd(f, 'New task', null), /no task section found/);
  });
});

// ── writeTaskEdit ────────────────────────────────────────────

describe('writeTaskEdit', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('replaces task text by number', () => {
    const f = tmp('todo.md', [
      '## Tasks',
      '- [ ] Old text',
      '- [ ] Keep this',
    ].join('\n'));

    const result = writeTaskEdit(f, 1, 'New text');
    assert.equal(result.oldText, 'Old text');
    assert.equal(result.newText, 'New text');
    const content = read(f);
    assert.ok(content.includes('- [ ] New text'));
    assert.ok(content.includes('- [ ] Keep this'));
  });

  it('throws for out-of-range task number', () => {
    const f = tmp('todo.md', '## Tasks\n- [ ] Only\n');
    assert.throws(() => writeTaskEdit(f, 3, 'New'), /open task #3 not found/);
  });
});

// ── writeTaskMove ────────────────────────────────────────────

describe('writeTaskMove', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('moves a task from one file to another', () => {
    const src = tmp('src-todo.md', [
      '## Tasks',
      '- [ ] Stay here',
      '- [ ] Move me',
    ].join('\n'));
    const dest = tmp('dest-todo.md', [
      '## Inbox',
      '- [ ] Existing',
    ].join('\n'));

    const result = writeTaskMove(src, 2, dest, 'inbox');
    assert.equal(result.moved, true);
    assert.equal(result.text, 'Move me');

    const srcContent = read(src);
    assert.ok(!srcContent.includes('Move me'));
    assert.ok(srcContent.includes('Stay here'));

    const destContent = read(dest);
    assert.ok(destContent.includes('Move me'));
  });
});

// ── writeActivityEntry ───────────────────────────────────────

describe('writeActivityEntry', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('appends to existing date section', () => {
    const today = new Date().toISOString().slice(0, 10);
    const f = tmp('activity.md', [
      '# Activity Log',
      '',
      `## ${today}`,
      '',
      '- First entry',
    ].join('\n'));

    const result = writeActivityEntry(f, 'Second', 'details here');
    assert.equal(result.success, true);
    const content = read(f);
    assert.ok(content.includes('- **Second** — details here'));
  });

  it('creates new date section when none exists for today', () => {
    const f = tmp('activity.md', [
      '# Activity Log',
      '',
      '## 2026-01-01',
      '',
      '- Old entry',
    ].join('\n'));

    writeActivityEntry(f, 'New entry', null);
    const content = read(f);
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(content.includes(`## ${today}`));
    assert.ok(content.includes('- **New entry**'));
  });

  it('creates file when it does not exist', () => {
    const f = path.join(tmpDir, 'new-activity.md');
    writeActivityEntry(f, 'First ever', 'bootstrapped');
    const content = read(f);
    assert.ok(content.includes('# Activity Log'));
    assert.ok(content.includes('- **First ever** — bootstrapped'));
  });

  it('formats entry without body when body is falsy', () => {
    const today = new Date().toISOString().slice(0, 10);
    const f = tmp('activity.md', `# Activity Log\n\n## ${today}\n\n- Old\n`);
    writeActivityEntry(f, 'Title only', null);
    assert.ok(read(f).includes('- **Title only**'));
    assert.ok(!read(f).includes('— null'));
  });
});

// ── writeJobValidation ───────────────────────────────────────

describe('writeJobValidation', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('updates existing Validation line', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: Completed',
      'Validation: Needs validation',
      '',
      '## Progress',
    ].join('\n'));

    const result = writeJobValidation(f, 'validated', null);
    assert.equal(result.success, true);
    assert.equal(result.validation, 'validated');
    assert.ok(read(f).includes('Validation: Validated'));
  });

  it('inserts Validation line when missing', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: Completed',
      '',
      '## Progress',
    ].join('\n'));

    writeJobValidation(f, 'rejected', 'code is broken');
    const content = read(f);
    assert.ok(content.includes('Validation: Rejected'));
    assert.ok(content.includes('code is broken'));
  });

  it('throws when no Status line exists', () => {
    const f = tmp('job.md', '# Job Task: Test\n');
    assert.throws(() => writeJobValidation(f, 'validated', null), /no Status: line/);
  });

  it('appends notes to existing Validation section', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: Completed',
      'Validation: Needs validation',
      '',
      '## Validation',
      '- Old note',
      '',
      '## Results',
    ].join('\n'));

    writeJobValidation(f, 'rejected', 'new rejection note');
    const content = read(f);
    assert.ok(content.includes('new rejection note'));
    assert.ok(content.includes('Old note'));
  });
});

// ── writeJobKill ─────────────────────────────────────────────

describe('writeJobKill', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('sets status to Stopped, marks it for review, and creates .kill marker', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: In progress',
      '',
      '## Progress',
      '- Working on it',
    ].join('\n'));

    const result = writeJobKill(f);
    assert.equal(result.success, true);

    const content = read(f);
    assert.ok(content.includes('Status: Stopped'));
    assert.ok(content.includes('Validation: Needs validation'));
    assert.ok(content.includes('## Stopped'));

    // Kill marker file should exist
    assert.ok(fs.existsSync(f + '.kill'));
  });

  it('throws when no Status line exists', () => {
    const f = tmp('job.md', '# Job Task: Test\n');
    assert.throws(() => writeJobKill(f), /no Status: line/);
  });
});

// ── writeJobStatus ───────────────────────────────────────────

describe('writeJobStatus', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('updates status line', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: In progress',
    ].join('\n'));

    const result = writeJobStatus(f, 'completed');
    assert.equal(result.success, true);
    assert.ok(read(f).includes('Status: Completed'));
  });

  it('forces validation to Needs validation on completion', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: In progress',
      'Validation: Validated',
    ].join('\n'));

    writeJobStatus(f, 'completed');
    const content = read(f);
    assert.ok(content.includes('Validation: Needs validation'));
  });

  it('inserts Validation line when completing and none exists', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: In progress',
    ].join('\n'));

    writeJobStatus(f, 'completed');
    assert.ok(read(f).includes('Validation: Needs validation'));
  });

  it('throws for invalid status', () => {
    const f = tmp('job.md', '# Job Task: Test\nStatus: In progress\n');
    assert.throws(() => writeJobStatus(f, 'banana'), /Invalid status/);
  });

  it('throws when no Status line exists', () => {
    const f = tmp('job.md', '# Job Task: Test\n');
    assert.throws(() => writeJobStatus(f), /no Status: line/);
  });

  it('does not touch validation when status is not completed', () => {
    const f = tmp('job.md', [
      '# Job Task: Test',
      'Status: In progress',
      'Validation: Validated',
    ].join('\n'));

    writeJobStatus(f, 'failed');
    assert.ok(read(f).includes('Validation: Validated'));
  });
});

// ── parseCronField ──────────────────────────────────────────

describe('parseCronField', () => {
  it('parses wildcard', () => {
    const result = parseCronField('*', 0, 59);
    assert.equal(result.size, 60);
    assert.ok(result.has(0));
    assert.ok(result.has(59));
  });

  it('parses specific value', () => {
    const result = parseCronField('5', 0, 59);
    assert.equal(result.size, 1);
    assert.ok(result.has(5));
  });

  it('parses range', () => {
    const result = parseCronField('1-5', 0, 59);
    assert.equal(result.size, 5);
    assert.ok(result.has(1));
    assert.ok(result.has(5));
    assert.ok(!result.has(0));
  });

  it('parses step values', () => {
    const result = parseCronField('*/15', 0, 59);
    assert.deepEqual([...result].sort((a, b) => a - b), [0, 15, 30, 45]);
  });

  it('parses range with step', () => {
    const result = parseCronField('1-10/3', 0, 59);
    assert.deepEqual([...result].sort((a, b) => a - b), [1, 4, 7, 10]);
  });

  it('parses comma-separated list', () => {
    const result = parseCronField('1,3,5', 0, 59);
    assert.deepEqual([...result].sort((a, b) => a - b), [1, 3, 5]);
  });

  it('ignores out-of-range values', () => {
    const result = parseCronField('99', 0, 59);
    assert.equal(result.size, 0);
  });
});

// ── cronMatchesDate ─────────────────────────────────────────

describe('cronMatchesDate', () => {
  it('matches exact minute and hour', () => {
    const d = new Date(2026, 3, 14, 9, 0); // April 14, 2026 9:00 AM (Tuesday)
    assert.ok(cronMatchesDate('0 9 * * *', d));
  });

  it('does not match wrong minute', () => {
    const d = new Date(2026, 3, 14, 9, 5);
    assert.ok(!cronMatchesDate('0 9 * * *', d));
  });

  it('matches weekday range', () => {
    const tue = new Date(2026, 3, 14, 9, 0); // Tuesday
    const sat = new Date(2026, 3, 18, 9, 0); // Saturday
    assert.ok(cronMatchesDate('0 9 * * 1-5', tue));
    assert.ok(!cronMatchesDate('0 9 * * 1-5', sat));
  });

  it('handles Sunday as 0 and 7', () => {
    const sun = new Date(2026, 3, 19, 10, 0); // Sunday
    assert.ok(cronMatchesDate('0 10 * * 0', sun));
    assert.ok(cronMatchesDate('0 10 * * 7', sun));
  });

  it('matches step pattern', () => {
    const d30 = new Date(2026, 3, 14, 9, 30);
    const d7 = new Date(2026, 3, 14, 9, 7);
    assert.ok(cronMatchesDate('*/15 * * * *', d30));
    assert.ok(!cronMatchesDate('*/15 * * * *', d7));
  });

  it('rejects invalid cron (wrong number of fields)', () => {
    assert.ok(!cronMatchesDate('0 9 * *', new Date()));
  });

  it('matches specific day of month', () => {
    const d = new Date(2026, 0, 15, 8, 0); // Jan 15
    assert.ok(cronMatchesDate('0 8 15 * *', d));
    assert.ok(!cronMatchesDate('0 8 16 * *', d));
  });
});

// ── computeNextRun ──────────────────────────────────────────

describe('computeNextRun', () => {
  it('finds next run for daily schedule', () => {
    const after = new Date(2026, 3, 14, 10, 0); // Tue 10:00 AM
    const next = computeNextRun('0 9 * * *', after);
    assert.ok(next);
    assert.equal(next.getHours(), 9);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getDate(), 15); // Next day
  });

  it('finds next weekday run skipping weekend', () => {
    const friday = new Date(2026, 3, 17, 10, 0); // Friday 10:00 AM
    const next = computeNextRun('0 9 * * 1-5', friday);
    assert.ok(next);
    assert.equal(next.getDay(), 1); // Monday
    assert.equal(next.getDate(), 20);
  });

  it('returns null when no match in window', () => {
    // Feb 30 never exists
    const result = computeNextRun('0 0 30 2 *', new Date(2026, 0, 1), 400);
    assert.equal(result, null);
  });

  it('starts from next minute, not current', () => {
    const now = new Date(2026, 3, 14, 9, 0, 30); // 9:00:30
    const next = computeNextRun('* * * * *', now);
    assert.ok(next);
    assert.equal(next.getMinutes(), 1);
  });
});

// ── describeCron ────────────────────────────────────────────

describe('describeCron', () => {
  it('describes daily schedule', () => {
    assert.equal(describeCron('0 9 * * *'), 'Daily at 9 AM');
  });

  it('describes weekday schedule', () => {
    assert.equal(describeCron('0 9 * * 1-5'), 'Weekdays at 9 AM');
  });

  it('describes step pattern', () => {
    assert.equal(describeCron('*/15 * * * *'), 'Every 15 minutes');
  });

  it('describes weekend schedule', () => {
    assert.equal(describeCron('0 10 * * 0,6'), 'Weekends at 10 AM');
  });

  it('falls back to raw expression for complex patterns', () => {
    const expr = '0 9 1,15 * *';
    assert.equal(describeCron(expr), expr);
  });
});

// ── validateCron ────────────────────────────────────────────

describe('validateCron', () => {
  it('returns null for valid expression', () => {
    assert.equal(validateCron('0 9 * * 1-5'), null);
    assert.equal(validateCron('*/15 * * * *'), null);
    assert.equal(validateCron('0 0 1 1 *'), null);
  });

  it('rejects wrong number of fields', () => {
    assert.ok(validateCron('0 9 * *'));
    assert.ok(validateCron('0 9 * * * *'));
  });

  it('rejects empty input', () => {
    assert.ok(validateCron(''));
    assert.ok(validateCron(null));
  });
});

// ── dateToCron ──────────────────────────────────────────────

describe('dateToCron', () => {
  it('converts a Date to a one-shot cron expression', () => {
    const d = new Date(2026, 3, 13, 22, 30); // April 13, 2026 at 10:30 PM
    assert.equal(dateToCron(d), '30 22 13 4 *');
  });

  it('handles midnight', () => {
    const d = new Date(2026, 0, 1, 0, 0); // Jan 1, 2026 at midnight
    assert.equal(dateToCron(d), '0 0 1 1 *');
  });
});

// ── Schedule CRUD (recurring field) ─────────────────────────

describe('Schedule recurring field', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('defaults recurring to false', () => {
    const sched = createSchedule(tmpDir, {
      name: 'One-shot', repo: 'app', cron: '30 22 13 4 *', prompt: 'Do it once',
    });
    assert.equal(sched.recurring, false);
  });

  it('respects recurring: true', () => {
    const sched = createSchedule(tmpDir, {
      name: 'Recurring', repo: 'app', cron: '0 9 * * 1-5', prompt: 'Do it daily',
      recurring: true,
    });
    assert.equal(sched.recurring, true);
  });
});

// ── Schedule CRUD ───────────────────────────────────────────

describe('Schedule CRUD', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates and loads a schedule', () => {
    const sched = createSchedule(tmpDir, {
      name: 'Test', repo: 'app', cron: '0 9 * * *', prompt: 'Do stuff',
    });
    assert.ok(sched.id.startsWith('sched-'));
    assert.equal(sched.name, 'Test');
    assert.equal(sched.type, 'prompt');
    assert.equal(sched.enabled, true);
    assert.ok(sched.nextRun);

    const loaded = loadSchedules(tmpDir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, sched.id);
    assert.ok(loaded[0].nextRun); // computed on load
  });

  it('updates a schedule', () => {
    const sched = createSchedule(tmpDir, {
      name: 'Old name', repo: 'app', cron: '0 9 * * *', prompt: 'Do stuff',
    });
    const updated = updateSchedule(tmpDir, sched.id, { name: 'New name' });
    assert.equal(updated.name, 'New name');
    assert.equal(updated.cron, '0 9 * * *'); // unchanged
  });

  it('deletes a schedule', () => {
    const sched = createSchedule(tmpDir, {
      name: 'Delete me', repo: 'app', cron: '0 9 * * *', prompt: 'test',
    });
    assert.equal(deleteSchedule(tmpDir, sched.id), true);
    assert.equal(loadSchedules(tmpDir).length, 0);
    assert.equal(deleteSchedule(tmpDir, 'nonexistent'), false);
  });

  it('toggles a schedule', () => {
    const sched = createSchedule(tmpDir, {
      name: 'Toggle me', repo: 'app', cron: '0 9 * * *', prompt: 'test',
    });
    assert.equal(sched.enabled, true);
    const toggled = toggleSchedule(tmpDir, sched.id);
    assert.equal(toggled.enabled, false);
    assert.equal(toggled.nextRun, null); // disabled → no nextRun
    const toggled2 = toggleSchedule(tmpDir, sched.id);
    assert.equal(toggled2.enabled, true);
    assert.ok(toggled2.nextRun);
  });

  it('creates loop-type schedule', () => {
    const sched = createSchedule(tmpDir, {
      name: 'Loop', repo: 'app', cron: '0 2 * * *', type: 'loop',
      loopType: 'linear-implementation', agentSpec: 'claude:claude-opus-4-6',
    });
    assert.equal(sched.type, 'loop');
    assert.equal(sched.loopType, 'linear-implementation');
    assert.equal(sched.agentSpec, 'claude:claude-opus-4-6');
  });

  it('finds adjacent schedules', () => {
    const s1 = createSchedule(tmpDir, {
      name: 'A', repo: 'app', cron: '0 9 * * *', prompt: 'a',
    });
    const s2 = createSchedule(tmpDir, {
      name: 'B', repo: 'app', cron: '0 10 * * *', prompt: 'b',
    });
    // C runs at midnight — not adjacent to 9am
    createSchedule(tmpDir, {
      name: 'C', repo: 'app', cron: '0 0 * * *', prompt: 'c',
    });
    const adjacent = getAdjacentSchedules(tmpDir, s1.id, 2);
    assert.equal(adjacent.length, 1);
    assert.equal(adjacent[0].id, s2.id);
  });

  it('returns empty when no schedules file exists', () => {
    assert.deepEqual(loadSchedules(tmpDir), []);
  });
});

// ── Schedule events ─────────────────────────────────────────

describe('Schedule events', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('appends and loads events', () => {
    appendScheduleEvent(tmpDir, {
      scheduleId: 's1', scheduleName: 'Test', type: 'completed',
      startedAt: '2026-04-13T09:00:00', finishedAt: '2026-04-13T09:05:00',
    });
    appendScheduleEvent(tmpDir, {
      scheduleId: 's2', scheduleName: 'Other', type: 'failed',
      startedAt: '2026-04-13T10:00:00', finishedAt: '2026-04-13T10:01:00',
    });

    const all = loadScheduleEvents(tmpDir);
    assert.equal(all.length, 2);

    const s1Only = loadScheduleEvents(tmpDir, { scheduleId: 's1' });
    assert.equal(s1Only.length, 1);
    assert.equal(s1Only[0].type, 'completed');

    const failedOnly = loadScheduleEvents(tmpDir, { type: 'failed' });
    assert.equal(failedOnly.length, 1);
  });

  it('clears events for a specific schedule', () => {
    appendScheduleEvent(tmpDir, { scheduleId: 's1', type: 'completed', startedAt: '2026-04-13T09:00:00' });
    appendScheduleEvent(tmpDir, { scheduleId: 's2', type: 'completed', startedAt: '2026-04-13T10:00:00' });
    clearScheduleEvents(tmpDir, 's1');
    const remaining = loadScheduleEvents(tmpDir);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].scheduleId, 's2');
  });

  it('clears all events', () => {
    appendScheduleEvent(tmpDir, { scheduleId: 's1', type: 'completed', startedAt: '2026-04-13T09:00:00' });
    appendScheduleEvent(tmpDir, { scheduleId: 's2', type: 'failed', startedAt: '2026-04-13T10:00:00' });
    clearScheduleEvents(tmpDir);
    assert.equal(loadScheduleEvents(tmpDir).length, 0);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      appendScheduleEvent(tmpDir, { scheduleId: 's1', type: 'completed', startedAt: `2026-04-${13 + i}T09:00:00` });
    }
    const limited = loadScheduleEvents(tmpDir, { limit: 3 });
    assert.equal(limited.length, 3);
  });
});

// ── Schedule locks ──────────────────────────────────────────

describe('Schedule locks', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('acquires and releases lock', () => {
    const lock = acquireScheduleLock(tmpDir, 'sched-1', 'job-1');
    assert.ok(lock);
    assert.equal(lock.scheduleId, 'sched-1');
    assert.equal(lock.pid, process.pid);

    const locks = getActiveLocks(tmpDir);
    assert.equal(locks.length, 1);

    releaseScheduleLock(tmpDir, 'sched-1');
    assert.equal(getActiveLocks(tmpDir).length, 0);
  });

  it('returns null when lock already held by this process', () => {
    acquireScheduleLock(tmpDir, 'sched-1', 'job-1');
    const second = acquireScheduleLock(tmpDir, 'sched-1', 'job-2');
    assert.equal(second, null); // lock already held
    releaseScheduleLock(tmpDir, 'sched-1');
  });

  it('cleans up stale locks (dead PID)', () => {
    const dir = path.join(tmpDir, '.dispatch', 'runtime', 'schedule-locks');
    fs.mkdirSync(dir, { recursive: true });
    // Write a lock with a PID that definitely doesn't exist
    fs.writeFileSync(path.join(dir, 'sched-stale.lock'), JSON.stringify({
      pid: 999999999, startedAt: '2026-04-13T00:00:00', scheduleId: 'sched-stale',
    }), 'utf8');
    const locks = getActiveLocks(tmpDir);
    assert.equal(locks.length, 0); // stale lock ignored
  });
});
