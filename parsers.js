/**
 * Shared parsing module for the Scribular coordination hub.
 * Used by cli.js (JSON output) and terminal.js (ANSI output).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseTaskFile(filePath) {
  const sections = [];
  const allTasks = [];
  let currentSection = null;
  let currentTimeframe = 'present';
  let openCount = 0, doneCount = 0;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      // Detect top-level timeframe headers: # Past, # Present, # Future
      const timeframeMatch = line.match(/^#\s+(Past|Present|Future)\s*$/i);
      if (timeframeMatch) {
        currentTimeframe = timeframeMatch[1].toLowerCase();
        continue;
      }
      const sectionMatch = line.match(/^##\s+(.+)/);
      if (sectionMatch) {
        currentSection = { name: sectionMatch[1].replace(/\s*\(.*\)$/, ''), tasks: [] };
        sections.push(currentSection);
        continue;
      }
      const taskMatch = line.match(/^(?:\d+\.\s+|[-*]\s+)\[([ x])\]\s+(.+)/);
      if (taskMatch) {
        const done = taskMatch[1] === 'x';
        const text = taskMatch[2]
          .replace(/\s*—\s*\*\*DONE.*\*\*/, '')
          .replace(/\s*\(.*?\)\s*$/, '')
          .replace(/\*\*/g, '');
        const sectionName = currentSection?.name || '';
        if (done) {
          doneCount++;
          if (currentSection) currentSection.tasks.push({ text, done: true });
        } else {
          openCount++;
          if (currentSection) currentSection.tasks.push({ text, done: false });
        }
        // openTaskNum: 1-based index among open tasks (matches writeTaskEdit numbering)
        allTasks.push({ text, done, section: sectionName, timeframe: currentTimeframe, openTaskNum: done ? null : openCount });
      }
    }
  } catch { /* file missing */ }
  return { sections: sections.filter(s => s.tasks.length > 0), openCount, doneCount, allTasks };
}

function formatActivityDate(dateStr, dateFormat) {
  if (dateFormat !== 'compact') return dateStr;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = Math.max(1, Math.min(12, parseInt(m[2], 10))) - 1;
  const day = parseInt(m[3], 10);
  return `${months[monthIndex]} ${day}`;
}

function parseActivityLog(filePath, options = {}) {
  const dateFormat = options.dateFormat || 'iso';
  const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : Infinity;
  let stage = '';
  let currentDate = '';
  const entries = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      if (entries.length >= limit) break;
      const stageMatch = line.match(/\*\*Current stage:\*\*\s*(.+)/);
      if (stageMatch) { stage = stageMatch[1]; continue; }
      const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (dateMatch) { currentDate = formatActivityDate(dateMatch[1], dateFormat); continue; }
      if (currentDate) {
        const bulletMatch = line.match(/^- (.+)/);
        if (bulletMatch) {
          entries.push({
            date: currentDate,
            bullet: bulletMatch[1].replace(/\*\*/g, '').replace(/\s*\(.*?\)/, ''),
          });
        }
      }
    }
  } catch { /* file missing */ }
  return { stage, entries };
}

function getGitInfo(repoPath) {
  const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
  try {
    const branch = execFileSync('git', ['-C', repoPath, 'branch', '--show-current'], opts).trim();
    const porcelain = execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], opts).trim();
    const dirtyCount = porcelain ? porcelain.split('\n').length : 0;
    let branches = [];
    try {
      const raw = execFileSync('git', ['-C', repoPath, 'branch', '--format=%(refname:short)'], opts).trim();
      if (raw) branches = raw.split('\n').filter(Boolean);
    } catch { /* ignore */ }
    return { branch, dirtyCount, branches };
  } catch {
    return { branch: '?', dirtyCount: 0, branches: [] };
  }
}

function normalizeStatus(raw) {
  if (!raw) return 'unknown';
  const lower = raw.trim().toLowerCase();
  if (lower === 'complete' || lower === 'completed') return 'completed';
  if (lower === 'in progress' || lower === 'in_progress') return 'in_progress';
  if (lower === 'failed') return 'failed';
  if (lower === 'killed' || lower === 'stopped') return 'stopped';
  return lower;
}

const ANSI_CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

function sanitizeLoopLogLine(value) {
  return String(value || '')
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(CONTROL_RE, '')
    .trim();
}

const LOOP_DONE_RE = /(?:^|[\s>])All phases complete\. Loop done\.\s*$/;
const LOOP_ISSUES_DONE_RE = /(?:^|[\s>])All issues resolved\. Loop done\.\s*$/;
const LOOP_VERIFIED_PASS_RE = /(?:^|[\s>])VERIFIED:\s*PASS\s*$/;
const LOOP_VERDICT_PASS_RE = /(?:^|[\s>])VERDICT:\s*PASS\s*$/;
const LOOP_VERDICT_FAIL_RE = /(?:^|[\s>])VERDICT:\s*FAIL\s*$/;

function parseJobFile(filePath) {
  const id = path.basename(filePath, '.md');
  let taskName = '', started = '', status = 'unknown', validation = 'none', agentId = null, skills = [];
  let originalTask = '', session = null, repo = null;
  let originalPrompt = '';
  let previousJobId = null, nextJobId = null;
  let planSlug = null;
  let agent = 'claude';
  let read = false;
  let skipPermissions = null;
  let resumeId = null, resumeCommand = null;
  let ai = null;
  let branch = null, worktreePath = null, startCommit = null, baseBranch = null;
  let type = null, loopType = null;
  const progressEntries = [];
  let results = null;
  let validationNotes = null;
  let rawContent = '';

  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
    const lines = rawContent.split('\n');
    let currentSection = null;
    let resultLines = [];
    let validationLines = [];

    for (const line of lines) {
      // Header metadata
      const taskMatch = line.match(/^#\s+(?:Swarm|Job)\s+Task:\s*(.+)/);
      if (taskMatch) { taskName = taskMatch[1].trim(); continue; }

      const startedMatch = line.match(/^Started:\s*(.+)/);
      if (startedMatch) { started = startedMatch[1].trim(); continue; }

      const statusMatch = line.match(/^Status:\s*(.+)/);
      if (statusMatch) { status = normalizeStatus(statusMatch[1]); continue; }

      const validationMatch = line.match(/^Validation:\s*(.+)/);
      if (validationMatch) { validation = validationMatch[1].trim().toLowerCase().replace(/\s+/g, '_'); continue; }

      const agentIdMatch = line.match(/^AgentId:\s*(.+)/);
      if (agentIdMatch) { agentId = agentIdMatch[1].trim(); continue; }

      const skillsMatch = line.match(/^Skills:\s*(.+)/);
      if (skillsMatch) { skills = skillsMatch[1].split(',').map(s => s.trim()).filter(Boolean); continue; }

      const originalTaskMatch = line.match(/^OriginalTask:\s*(.+)/);
      if (originalTaskMatch) { originalTask = originalTaskMatch[1].trim(); continue; }

      const originalPromptMatch = line.match(/^OriginalPrompt:\s*(.+)/);
      if (originalPromptMatch) { originalPrompt = originalPromptMatch[1].trim(); continue; }

      const sessionMatch = line.match(/^Session:\s*(.+)/);
      if (sessionMatch) { session = sessionMatch[1].trim(); continue; }

      const previousJobMatch = line.match(/^PreviousJob:\s*(.+)/);
      if (previousJobMatch) { previousJobId = previousJobMatch[1].trim(); continue; }

      const nextJobMatch = line.match(/^NextJob:\s*(.+)/);
      if (nextJobMatch) { nextJobId = nextJobMatch[1].trim(); continue; }

      const agentMatch = line.match(/^Agent:\s*(.+)/);
      if (agentMatch) { agent = agentMatch[1].trim().toLowerCase() || 'claude'; continue; }

      const readMatch = line.match(/^Read:\s*(.+)/);
      if (readMatch) {
        const raw = readMatch[1].trim().toLowerCase();
        read = raw === 'true' || raw === 'yes' || raw === '1';
        continue;
      }

      const skipPermissionsMatch = line.match(/^SkipPermissions:\s*(.+)/);
      if (skipPermissionsMatch) {
        const raw = skipPermissionsMatch[1].trim().toLowerCase();
        skipPermissions = raw === 'true' || raw === 'yes' || raw === '1';
        continue;
      }

      const resumeIdMatch = line.match(/^ResumeId:\s*(.+)/);
      if (resumeIdMatch) { resumeId = resumeIdMatch[1].trim(); continue; }

      const resumeCommandMatch = line.match(/^ResumeCommand:\s*(.+)/);
      if (resumeCommandMatch) { resumeCommand = resumeCommandMatch[1].trim(); continue; }

      const repoMatch = line.match(/^Repo:\s*(.+)/);
      if (repoMatch) { repo = repoMatch[1].trim(); continue; }

      const planMatch = line.match(/^Plan:\s*(.+)/);
      if (planMatch) { planSlug = planMatch[1].trim(); continue; }

      const branchMatch = line.match(/^Branch:\s*(.+)/);
      if (branchMatch) { branch = branchMatch[1].trim(); continue; }

      const worktreePathMatch = line.match(/^WorktreePath:\s*(.+)/);
      if (worktreePathMatch) { worktreePath = worktreePathMatch[1].trim(); continue; }

      const startCommitMatch = line.match(/^StartCommit:\s*(.+)/);
      if (startCommitMatch) { startCommit = startCommitMatch[1].trim(); continue; }

      const baseBranchMatch = line.match(/^BaseBranch:\s*(.+)/);
      if (baseBranchMatch) { baseBranch = baseBranchMatch[1].trim(); continue; }

      const typeMatch = line.match(/^Type:\s*(.+)/);
      if (typeMatch) { type = typeMatch[1].trim().toLowerCase(); continue; }

      const loopTypeMatch = line.match(/^LoopType:\s*(.+)/);
      if (loopTypeMatch) { loopType = loopTypeMatch[1].trim(); continue; }

      // Section detection
      const sectionMatch = line.match(/^##\s+(.+)/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim().toLowerCase();
        continue;
      }

      // Collect content per section
      if (currentSection === 'progress') {
        const bullet = line.match(/^[-*]\s+(.+)/);
        if (bullet) progressEntries.push(bullet[1]);
      } else if (currentSection === 'results' || currentSection === 'results summary') {
        resultLines.push(line);
      } else if (currentSection === 'validation') {
        validationLines.push(line);
      }
    }

    if (resultLines.length > 0) results = resultLines.join('\n');
    if (validationLines.length > 0) validationNotes = validationLines.join('\n');
  } catch { /* file missing or unreadable */ }

  const lastProgress = progressEntries.length > 0 ? progressEntries[progressEntries.length - 1] : null;
  const progressCount = progressEntries.length;

  let durationMinutes = null;
  if (started) {
    const normalized = started.includes('T') ? started : started.replace(' ', 'T');
    const startDate = new Date(normalized);
    if (!isNaN(startDate.getTime())) {
      durationMinutes = Math.round((Date.now() - startDate.getTime()) / 60000);
    }
  }

  const resultsSummary = results ? results.split('\n')[0] : null;

  return {
    id, taskName, started, status, validation, agentId, skills,
    agent,
    read,
    originalTask, originalPrompt, session, previousJobId, nextJobId, skipPermissions, resumeId, resumeCommand, repo, planSlug,
    branch, worktreePath, startCommit, baseBranch,
    type, loopType,
    lastProgress, progressCount, durationMinutes, resultsSummary,
    progressEntries, results, validationNotes, rawContent,
  };
}

function parseJobDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    return files.map(f => parseJobFile(path.join(dirPath, f)));
  } catch {
    return [];
  }
}

function parseLoopRun(runDir) {
  let session = null, loopType = null, agent = null, started = null;
  let iteration = 0, lastVerdict = null, complete = false, loopStatus = null;
  try {
    const logPath = path.join(runDir, 'loop.log');
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    let pastHeader = false;
    for (const line of lines) {
      // Parse structured header (before --- separator)
      if (!pastHeader) {
        if (line.trim() === '---') { pastHeader = true; continue; }
        const hm = line.match(/^LOOP_SESSION:\s*(.+)/);
        if (hm) { session = hm[1].trim(); continue; }
        const tm = line.match(/^LOOP_TYPE:\s*(.+)/);
        if (tm) { loopType = tm[1].trim(); continue; }
        const am = line.match(/^LOOP_AGENT:\s*(.+)/);
        if (am) { agent = am[1].trim(); continue; }
        const sm = line.match(/^LOOP_STARTED:\s*(.+)/);
        if (sm) { started = sm[1].trim(); continue; }
        continue;
      }
      // Parse body
      const normalized = sanitizeLoopLogLine(line);
      const iterMatchSafe = normalized.match(/\bIteration\s+(\d+)\b/i);
      if (iterMatchSafe) iteration = parseInt(iterMatchSafe[1], 10);
      if (LOOP_DONE_RE.test(normalized)) { lastVerdict = 'ALL PHASES COMPLETE'; complete = true; }
      else if (LOOP_ISSUES_DONE_RE.test(normalized)) { lastVerdict = 'ALL ISSUES RESOLVED'; complete = true; }
      else if (LOOP_VERIFIED_PASS_RE.test(normalized)) lastVerdict = 'VERIFIED: PASS';
      else if (LOOP_VERDICT_PASS_RE.test(normalized)) lastVerdict = 'VERDICT: PASS';
      else if (LOOP_VERDICT_FAIL_RE.test(normalized)) lastVerdict = 'VERDICT: FAIL';
      const statusMatch = normalized.match(/LOOP_STATUS:\s*([a-z_]+)/i);
      if (statusMatch) {
        const rawStatus = statusMatch[1].trim().toLowerCase();
        if (rawStatus.startsWith('completed')) {
          loopStatus = 'completed';
          complete = true;
        } else if (rawStatus.startsWith('failed')) {
          loopStatus = 'failed';
        } else {
          loopStatus = rawStatus;
        }
      }
    }
  } catch { /* log missing */ }
  if (!loopStatus) {
    try {
      const statusPath = path.join(runDir, 'status.txt');
      if (fs.existsSync(statusPath)) {
        const raw = fs.readFileSync(statusPath, 'utf8').trim().toLowerCase();
        if (raw === 'completed' || raw === 'failed') loopStatus = raw;
      }
    } catch { /* ignore */ }
  }
  if (loopStatus === 'completed') complete = true;
  return { session, loopType, agent, started, iteration, lastVerdict, complete, loopStatus, runDir };
}

function parseAllLoopRuns(typeDir) {
  const runs = [];
  try {
    const subdirs = fs.readdirSync(typeDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}T/.test(d))
      .sort()
      .reverse();
    for (const d of subdirs) {
      runs.push(parseLoopRun(path.join(typeDir, d)));
    }
  } catch { /* dir missing */ }
  return runs;
}

function parseLoopState(loopDir) {
  let iteration = 0, lastVerdict = null, complete = false, runDir = null;
  try {
    const subdirs = fs.readdirSync(loopDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}T/.test(d))
      .sort()
      .reverse();
    if (subdirs.length === 0) return { iteration, lastVerdict, complete, runDir };
    runDir = path.join(loopDir, subdirs[0]);
    const run = parseLoopRun(runDir);
    return { iteration: run.iteration, lastVerdict: run.lastVerdict, complete: run.complete, runDir };
  } catch { /* dir or log missing */ }
  return { iteration, lastVerdict, complete, runDir };
}

function parseLoopRunDetailed(runDir) {
  const run = parseLoopRun(runDir);
  const iterations = [];
  const warnings = [];
  const addWarning = (context, err) => {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`${context}: ${message}`);
  };
  // Parse iteration info from loop.log body
  try {
    const logPath = path.join(runDir, 'loop.log');
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    let pastHeader = false;
    let currentIter = null;
    for (const line of lines) {
      if (!pastHeader) {
        if (line.trim() === '---') pastHeader = true;
        continue;
      }
      const normalized = sanitizeLoopLogLine(line);
      const iterMatch = normalized.match(/Iteration\s+(\d+)\s*[-–—]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i);
      if (iterMatch) {
        currentIter = { number: parseInt(iterMatch[1], 10), timestamp: iterMatch[2], verdict: null };
        iterations.push(currentIter);
        continue;
      }
      // Also match iteration lines without timestamps
      const iterMatchSimple = normalized.match(/\bIteration\s+(\d+)\b/i);
      if (iterMatchSimple && !iterMatch) {
        const num = parseInt(iterMatchSimple[1], 10);
        if (!currentIter || currentIter.number !== num) {
          currentIter = { number: num, timestamp: null, verdict: null };
          iterations.push(currentIter);
        }
      }
      if (currentIter) {
        if (LOOP_VERDICT_PASS_RE.test(normalized) || LOOP_VERIFIED_PASS_RE.test(normalized)) currentIter.verdict = 'PASS';
        else if (LOOP_VERDICT_FAIL_RE.test(normalized)) currentIter.verdict = 'FAIL';
        else if (LOOP_DONE_RE.test(normalized)) currentIter.verdict = 'PASS';
        else if (LOOP_ISSUES_DONE_RE.test(normalized)) currentIter.verdict = 'PASS';
        else if (/LOOP_STATUS:\s*completed\b/i.test(normalized)) currentIter.verdict = 'PASS';
      }
    }
  } catch (err) {
    addWarning('failed to parse loop.log', err);
  }

  // Scan for artifact files
  const artifacts = [];
  try {
    const files = fs.readdirSync(runDir).filter(f => f.endsWith('.txt')).sort();
    for (const file of files) {
      let type = 'unknown', iteration = null;
      const reviewMatch = file.match(/^review_iter(\d+)/);
      const synthMatch = file.match(/^synthesis_iter(\d+)/);
      const verifyMatch = file.match(/^verification_iter(\d+)/);
      const phaseMatch = file.match(/^phase_iter(\d+)/);
      if (reviewMatch) { type = 'review'; iteration = parseInt(reviewMatch[1], 10); }
      else if (synthMatch) { type = 'synthesis'; iteration = parseInt(synthMatch[1], 10); }
      else if (verifyMatch) { type = 'verification'; iteration = parseInt(verifyMatch[1], 10); }
      else if (phaseMatch) { type = 'phase'; iteration = parseInt(phaseMatch[1], 10); }

      let content = '';
      try {
        content = fs.readFileSync(path.join(runDir, file), 'utf8');
      } catch (err) {
        addWarning(`failed to read artifact "${file}"`, err);
      }
      artifacts.push({ name: file, type, iteration, content });
    }
  } catch (err) {
    addWarning('failed to scan artifact directory', err);
  }

  // Read prompt
  let prompt = '';
  try {
    const candidatePromptPaths = [
      path.join(runDir, '..', 'prompt.md'),
      path.join(runDir, 'prompt.md'),
      path.join(path.dirname(path.dirname(runDir)), 'prompt.md'),
    ];
    for (const promptPath of candidatePromptPaths) {
      if (!fs.existsSync(promptPath)) continue;
      prompt = fs.readFileSync(promptPath, 'utf8');
      break;
    }
  } catch (err) {
    addWarning('failed to read prompt.md', err);
  }

  return { ...run, iterations, artifacts, prompt, warnings };
}

function loadConfig(dispatchRootDir) {
  const localConfigPath = path.join(dispatchRootDir, 'config.local.json');
  const configPath = fs.existsSync(localConfigPath) ? localConfigPath : path.join(dispatchRootDir, 'config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { hubRoot, dispatchRoot: rawDispatchRoot, ...rawRest } = raw;
  const dispatchRoot =
    rawDispatchRoot !== undefined && rawDispatchRoot !== null ? rawDispatchRoot : hubRoot;
  return {
    ...rawRest,
    ...(dispatchRoot !== undefined && dispatchRoot !== null ? { dispatchRoot } : {}),
    repos: raw.repos.map(repo => ({
      ...repo,
      resolvedPath: path.resolve(dispatchRootDir, repo.path),
    })),
  };
}

// ── Write operations ─────────────────────────────────────────

/**
 * Mark a task as done in a todo.md file.
 * taskNum is 1-indexed: the Nth open task in the file (across all sections).
 * Returns { success, task } or throws on error.
 */
function writeTaskDone(filePath, taskNum) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let openIndex = 0;
  let targetLine = -1;
  let taskText = '';

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)/);
    if (m) {
      openIndex++;
      if (openIndex === taskNum) {
        targetLine = i;
        taskText = m[2].replace(/\*\*/g, '');
        // Replace [ ] with [x] — preserve the rest of the line
        lines[i] = lines[i].replace('[ ]', '[x]');
        break;
      }
    }
  }

  if (targetLine === -1) {
    throw new Error(`open task #${taskNum} not found (${openIndex} open tasks exist)`);
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { success: true, taskNum, text: taskText };
}

/**
 * Add a new task to a todo.md file.
 * If section is provided, adds under the matching ## section header.
 * If section is null, adds under the first ## section that contains tasks.
 * Returns { success, section, text }.
 */
function collapseToSingleLine(text) {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function writeTaskAdd(filePath, text, section) {
  text = collapseToSingleLine(text);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let insertIndex = -1;
  let matchedSection = '';

  if (section) {
    // Find the named section and insert at the end of its task block
    let inSection = false;
    let lastTaskInSection = -1;
    for (let i = 0; i < lines.length; i++) {
      const sectionMatch = lines[i].match(/^##\s+(.+)/);
      if (sectionMatch) {
        if (inSection) {
          // We've left the target section — insert after last task
          break;
        }
        const sectionName = sectionMatch[1].replace(/\s*\(.*\)$/, '').trim().toLowerCase();
        if (sectionName.includes(section.toLowerCase())) {
          inSection = true;
          matchedSection = sectionMatch[1];
          lastTaskInSection = i; // fallback: insert right after header
          continue;
        }
      }
      if (inSection) {
        const taskMatch = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[[ x]\]/);
        if (taskMatch) {
          lastTaskInSection = i;
        }
      }
    }
    if (lastTaskInSection >= 0) {
      insertIndex = lastTaskInSection + 1;
    }
  }

  if (insertIndex === -1) {
    // Fallback: find first section with tasks, insert after last task in it
    let inSection = false;
    let lastTaskLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const sectionMatch = lines[i].match(/^##\s+(.+)/);
      if (sectionMatch) {
        if (inSection && lastTaskLine >= 0) break;
        inSection = true;
        matchedSection = matchedSection || sectionMatch[1];
        continue;
      }
      if (inSection) {
        const taskMatch = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[[ x]\]/);
        if (taskMatch) {
          lastTaskLine = i;
          if (!matchedSection) {
            matchedSection = 'first section';
          }
        }
      }
    }
    if (lastTaskLine >= 0) {
      insertIndex = lastTaskLine + 1;
      // Use the section of the last task we found
      for (let i = lastTaskLine; i >= 0; i--) {
        const sm = lines[i].match(/^##\s+(.+)/);
        if (sm) { matchedSection = sm[1]; break; }
      }
    }
  }

  if (insertIndex === -1) {
    // Final fallback: find any task line in the file (handles files without ## sections,
    // e.g. tasks directly under a # heading or at top level)
    let lastTaskLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const taskMatch = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[[ x]\]/);
      if (taskMatch) {
        lastTaskLine = i;
      }
    }
    if (lastTaskLine >= 0) {
      // Skip past any indented sub-tasks beneath the last top-level task
      let j = lastTaskLine + 1;
      while (j < lines.length && /^\s+([-*]\s+|\d+\.\s+)\[[ x]\]/.test(lines[j])) {
        j++;
      }
      insertIndex = j;
      for (let i = lastTaskLine; i >= 0; i--) {
        const hm = lines[i].match(/^#+\s+(.+)/);
        if (hm) { matchedSection = hm[1]; break; }
      }
      if (!matchedSection) matchedSection = '(top level)';
    }
  }

  if (insertIndex === -1) {
    throw new Error('no task section found in file');
  }

  // Determine format: use numbered list if the surrounding tasks are numbered, else bullet
  const prevLine = lines[insertIndex - 1] || '';
  const numMatch = prevLine.match(/^(\d+)\./);
  let newLine;
  if (numMatch) {
    const nextNum = parseInt(numMatch[1], 10) + 1;
    newLine = `${nextNum}. [ ] ${text}`;
  } else {
    newLine = `- [ ] ${text}`;
  }

  lines.splice(insertIndex, 0, newLine);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { success: true, section: matchedSection, text };
}

/**
 * Set validation status on a swarm file.
 * newValidation: 'validated' | 'rejected' | 'needs_validation'
 * notes: optional string — appended to ## Validation Notes section
 */
function writeJobValidation(filePath, newValidation, notes) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let validationLineIndex = -1;
  let statusLineIndex = -1;
  let hasValidationSection = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^Validation:\s/)) {
      validationLineIndex = i;
    }
    if (lines[i].match(/^Status:\s/)) {
      statusLineIndex = i;
    }
    if (lines[i].match(/^##\s+Validation/i)) {
      hasValidationSection = true;
    }
  }

  // Format the display value
  const displayValidation = newValidation.replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/^Needs Validation$/, 'Needs validation');

  // Normalize for consistency
  const displayMap = {
    validated: 'Validated',
    rejected: 'Rejected',
    needs_validation: 'Needs validation',
  };
  const displayValue = displayMap[newValidation] || displayValidation;

  if (validationLineIndex >= 0) {
    // Replace existing Validation: line
    lines[validationLineIndex] = `Validation: ${displayValue}`;
  } else if (statusLineIndex >= 0) {
    // Insert Validation: line right after Status: line
    lines.splice(statusLineIndex + 1, 0, `Validation: ${displayValue}`);
  } else {
    throw new Error('swarm file has no Status: line — cannot add validation');
  }

  // If rejecting with notes, add/update ## Validation Notes section
  if (notes) {
    const today = new Date().toISOString().split('T')[0];
    const noteBlock = `\n## Validation Notes\n- [${today}] ${notes}`;

    if (hasValidationSection) {
      // Find the section and append
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^##\s+Validation/i)) {
          // Find the end of this section (next ## or EOF)
          let insertAt = lines.length;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].match(/^##\s/)) {
              insertAt = j;
              break;
            }
          }
          lines.splice(insertAt, 0, `- [${today}] ${notes}`);
          break;
        }
      }
    } else {
      // Append new section at end of file
      lines.push(noteBlock);
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  const parsed = parseJobFile(filePath);
  return { success: true, id: parsed.id, validation: newValidation, taskName: parsed.taskName };
}

/**
 * Stop a swarm agent by marking its file as Stopped and writing a .kill marker.
 * Returns { success, id, agentId }.
 */
function writeJobKill(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let statusLineIndex = -1;
  let validationLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (statusLineIndex === -1 && lines[i].match(/^Status:\s/)) {
      statusLineIndex = i;
      continue;
    }
    if (validationLineIndex === -1 && lines[i].match(/^Validation:\s/)) {
      validationLineIndex = i;
    }
  }

  if (statusLineIndex === -1) {
    throw new Error('swarm file has no Status: line');
  }

  // Change Status to Stopped so the work can still be reviewed/followed up.
  lines[statusLineIndex] = 'Status: Stopped';

  // Ensure stopped work is surfaced for review unless it has already been reviewed.
  if (validationLineIndex !== -1) {
    const currentVal = lines[validationLineIndex].replace(/^Validation:\s*/, '').trim().toLowerCase().replace(/\s+/g, '_');
    if (currentVal !== 'validated' && currentVal !== 'rejected' && currentVal !== 'needs_validation') {
      lines[validationLineIndex] = 'Validation: Needs validation';
    }
  } else {
    lines.splice(statusLineIndex + 1, 0, 'Validation: Needs validation');
  }

  // Append a ## Stopped section with timestamp.
  const killTimestamp = new Date().toISOString();
  lines.push('');
  lines.push('## Stopped');
  lines.push(`Stopped at: ${killTimestamp}`);

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  // Write .kill marker file
  const killMarkerPath = filePath + '.kill';
  fs.writeFileSync(killMarkerPath, killTimestamp, 'utf8');

  // Parse the file to get id and agentId
  const parsed = parseJobFile(filePath);
  return { success: true, id: parsed.id, agentId: parsed.agentId };
}

/**
 * Move an open task from one todo.md file to another.
 * taskNum is 1-indexed: the Nth open task in the source file.
 * Removes the task line from sourceFile and adds it to destFile via writeTaskAdd.
 * Returns { moved, text, from, to }.
 */
function writeTaskMove(sourceFile, taskNum, destFile, section) {
  const content = fs.readFileSync(sourceFile, 'utf8');
  const lines = content.split('\n');
  let openIndex = 0;
  let targetLine = -1;
  let taskText = '';

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)/);
    if (m) {
      openIndex++;
      if (openIndex === taskNum) {
        targetLine = i;
        taskText = m[2].replace(/\*\*/g, '');
        break;
      }
    }
  }

  if (targetLine === -1) {
    throw new Error(`open task #${taskNum} not found (${openIndex} open tasks exist)`);
  }

  // Remove the task line from the source file
  lines.splice(targetLine, 1);
  fs.writeFileSync(sourceFile, lines.join('\n'), 'utf8');

  // Add the task to the destination file
  writeTaskAdd(destFile, taskText, section || null);

  return { moved: true, text: taskText, from: sourceFile, to: destFile };
}

/**
 * Update the Status: line in a swarm file.
 * Returns { success, id, status }.
 */
function writeJobStatus(filePath, newStatus) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let statusLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^Status:\s/)) {
      statusLineIndex = i;
      break;
    }
  }

  if (statusLineIndex === -1) {
    throw new Error('swarm file has no Status: line');
  }

  const displayMap = {
    completed: 'Completed',
    in_progress: 'In progress',
    failed: 'Failed',
    stopped: 'Stopped',
    killed: 'Stopped',
  };
  const validStatuses = Object.keys(displayMap);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
  }
  const displayValue = displayMap[newStatus];
  lines[statusLineIndex] = `Status: ${displayValue}`;

  // When completing, and when explicitly stopping a job, surface it for review.
  // This prevents agents from self-validating by writing Validation: Validated
  // directly to the swarm file before the PTY exits.
  if (newStatus === 'completed' || newStatus === 'stopped' || newStatus === 'killed') {
    let validationLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^Validation:\s/)) {
        validationLineIndex = i;
        break;
      }
    }
    if (validationLineIndex !== -1) {
      const currentVal = lines[validationLineIndex].replace(/^Validation:\s*/, '').trim().toLowerCase().replace(/\s+/g, '_');
      const shouldForceReview = newStatus === 'completed' || (currentVal !== 'validated' && currentVal !== 'rejected');
      if (shouldForceReview && currentVal !== 'needs_validation') {
        lines[validationLineIndex] = 'Validation: Needs validation';
      }
    } else {
      // No Validation line exists — insert one after Status
      lines.splice(statusLineIndex + 1, 0, 'Validation: Needs validation');
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  const parsed = parseJobFile(filePath);
  return { success: true, id: parsed.id, status: parsed.status };
}

/**
 * Write plain text output to the ## Results section of a job file.
 * No-ops if the section already has content.
 */
function writeJobResults(filePath, text) {
  const content = fs.readFileSync(filePath, 'utf8');
  const marker = '\n## Results\n';
  const idx = content.indexOf(marker);
  if (idx === -1) return;
  const insertAt = idx + marker.length;
  const nextSection = content.indexOf('\n## ', insertAt);
  const existing = content.slice(insertAt, nextSection !== -1 ? nextSection : undefined).trim();
  if (existing) return; // already has content
  const before = content.slice(0, insertAt);
  const after = nextSection !== -1 ? content.slice(nextSection) : '';
  fs.writeFileSync(filePath, `${before}\n${text}\n${after}`, 'utf8');
}

// ── Checkpoint operations ────────────────────────────────

/**
 * Create a checkpoint branch capturing the repo's full working directory state.
 * Returns { checkpointId, originalBranch, filesStashed }.
 */
function createCheckpoint(repoPath) {
  const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();

  const originalBranch = git('branch', '--show-current');
  if (originalBranch.startsWith('checkpoint/')) {
    throw new Error('already on a checkpoint branch');
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})/, '$1-$2');
  const checkpointId = `checkpoint/${timestamp}`;

  // Count files that will be captured
  git('checkout', '-b', checkpointId);
  git('add', '-A');
  const porcelain = git('status', '--porcelain');
  const filesStashed = porcelain ? porcelain.split('\n').length : 0;

  git('commit', '--allow-empty', '-m', `Checkpoint: ${timestamp}\n\nOriginal branch: ${originalBranch}\nFiles captured: ${filesStashed}`);
  git('checkout', originalBranch);

  return { checkpointId, originalBranch, filesStashed };
}

/**
 * Revert to a checkpoint: discard current changes and restore checkpoint state.
 * Returns { checkpointId, filesRestored, filesDiscarded }.
 */
function revertCheckpoint(repoPath, checkpointId) {
  const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();

  // Ensure full branch name
  const branchName = checkpointId.startsWith('checkpoint/') ? checkpointId : `checkpoint/${checkpointId}`;

  const exists = git('branch', '--list', branchName);
  if (!exists) {
    throw new Error(`checkpoint branch "${branchName}" not found`);
  }

  // Count files being discarded
  const currentPorcelain = git('status', '--porcelain');
  const filesDiscarded = currentPorcelain ? currentPorcelain.split('\n').length : 0;

  // Discard all current changes
  git('checkout', '--', '.');
  try { git('clean', '-fd'); } catch { /* no untracked files */ }

  // Restore checkpoint files
  git('checkout', branchName, '--', '.');
  const restoredPorcelain = git('status', '--porcelain');
  const filesRestored = restoredPorcelain ? restoredPorcelain.split('\n').length : 0;

  // Delete the checkpoint branch
  git('branch', '-D', branchName);

  return { checkpointId: branchName, filesRestored, filesDiscarded };
}

/**
 * Dismiss a checkpoint: delete the branch, keep current working directory as-is.
 * Returns { checkpointId }.
 */
function dismissCheckpoint(repoPath, checkpointId) {
  const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();

  const branchName = checkpointId.startsWith('checkpoint/') ? checkpointId : `checkpoint/${checkpointId}`;

  const exists = git('branch', '--list', branchName);
  if (!exists) {
    throw new Error(`checkpoint branch "${branchName}" not found`);
  }

  git('branch', '-D', branchName);
  return { checkpointId: branchName };
}

/**
 * List all checkpoint branches for a repo.
 * Returns array of { id, created, filesStashed, originalBranch }.
 */
function listCheckpoints(repoPath) {
  const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();

  const raw = git('branch', '--list', 'checkpoint/*');
  if (!raw) return [];

  const branches = raw.split('\n').map(b => b.trim().replace(/^\* /, ''));
  const checkpoints = [];

  for (const branch of branches) {
    try {
      const msg = git('log', '-1', '--format=%B', branch);
      const originalMatch = msg.match(/Original branch:\s*(.+)/);
      const filesMatch = msg.match(/Files captured:\s*(\d+)/);
      const dateStr = git('log', '-1', '--format=%aI', branch);

      checkpoints.push({
        id: branch,
        created: dateStr,
        filesStashed: filesMatch ? parseInt(filesMatch[1], 10) : 0,
        originalBranch: originalMatch ? originalMatch[1].trim() : 'unknown',
      });
    } catch { /* skip malformed checkpoint branches */ }
  }

  return checkpoints;
}

/**
 * Mark a task as done by matching its text content.
 * Tries three strategies in order:
 *   1. Exact substring: task text contains the search string
 *   2. Reverse substring: search string contains the task text
 *   3. Word overlap: ≥50% of needle words appear in task text
 * Returns { success, text } or throws on error.
 */
function writeTaskDoneByText(filePath, searchText) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const needle = searchText.toLowerCase().replace(/\*\*/g, '');

  // Tokenise into significant words (3+ chars, skip stopwords, strip trailing s/ing/ed)
  const STOP = new Set(['the','and','for','that','with','this','from','are','was',
    'not','but','can','you','all','will','have','when','than','then','into','each',
    'just','also','more','only','some','they','been','has','its','our','their']);
  function stem(w) {
    // Minimal suffix stripping: plurals, -ing, -ed, -er
    return w.replace(/ing$/, '').replace(/ed$/, '').replace(/er$/, '').replace(/s$/, '');
  }
  function words(str) {
    return str.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .map(stem);
  }

  const needleWords = new Set(words(needle));

  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)/);
    if (!m) continue;
    const taskText = m[2].replace(/\*\*/g, '').replace(/\s*\(.*?\)\s*$/, '');
    const lower = taskText.toLowerCase();

    // Strategy 1: task text contains needle
    if (lower.includes(needle)) {
      candidates.push({ i, taskText, score: 1.0 });
      continue;
    }
    // Strategy 2: needle contains task text (needle is more verbose)
    if (needle.includes(lower)) {
      candidates.push({ i, taskText, score: 0.9 });
      continue;
    }
    // Strategy 3: word overlap (dispatched text was paraphrased)
    if (needleWords.size > 0) {
      const taskWords = words(lower);
      const matches = taskWords.filter(w => needleWords.has(w)).length;
      const score = matches / needleWords.size;
      if (score >= 0.5) {
        candidates.push({ i, taskText, score });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(`no open task matching "${searchText}" found`);
  }

  // Pick highest-scoring candidate (first in file on ties)
  candidates.sort((a, b) => b.score - a.score);
  const { i, taskText } = candidates[0];
  lines[i] = lines[i].replace('[ ]', '[x]');
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { success: true, text: taskText };
}

/**
 * Reopen a done task in a todo.md file by matching text.
 * Finds the best-matching [x] task and replaces it with [ ].
 * Returns { success: true, text } or throws on error.
 */
function writeTaskReopenByText(filePath, searchText) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const needle = searchText.toLowerCase().replace(/\*\*/g, '');

  const STOP = new Set(['the','and','for','that','with','this','from','are','was',
    'not','but','can','you','all','will','have','when','than','then','into','each',
    'just','also','more','only','some','they','been','has','its','our','their']);
  function stem(w) {
    return w.replace(/ing$/, '').replace(/ed$/, '').replace(/er$/, '').replace(/s$/, '');
  }
  function words(str) {
    return str.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .map(stem);
  }

  const needleWords = new Set(words(needle));
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[x\]\s+(.+)/);
    if (!m) continue;
    const taskText = m[2].replace(/\*\*/g, '').replace(/\s*\(.*?\)\s*$/, '');
    const lower = taskText.toLowerCase();
    if (lower.includes(needle)) { candidates.push({ i, taskText, score: 1.0 }); continue; }
    if (needle.includes(lower)) { candidates.push({ i, taskText, score: 0.9 }); continue; }
    if (needleWords.size > 0) {
      const taskWords = words(lower);
      const matches = taskWords.filter(w => needleWords.has(w)).length;
      const score = matches / needleWords.size;
      if (score >= 0.5) candidates.push({ i, taskText, score });
    }
  }

  if (candidates.length === 0) throw new Error(`no done task matching "${searchText}" found`);
  candidates.sort((a, b) => b.score - a.score);
  const { i, taskText } = candidates[0];
  lines[i] = lines[i].replace('[x]', '[ ]');
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { success: true, text: taskText };
}

/**
 * Edit the text of an open task in a todo.md file.
 * taskNum is 1-indexed: the Nth open task in the file (across all sections).
 * Returns { success, taskNum, oldText, newText } or throws on error.
 */
function writeTaskEdit(filePath, taskNum, newText) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let openIndex = 0;
  let targetLine = -1;
  let oldText = '';

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)/);
    if (m) {
      openIndex++;
      if (openIndex === taskNum) {
        targetLine = i;
        oldText = m[2].replace(/\*\*/g, '');
        // Replace the text portion, keeping the prefix (bullet/number + checkbox)
        const prefix = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[ \]\s+/)[0];
        lines[i] = prefix + newText;
        break;
      }
    }
  }

  if (targetLine === -1) {
    throw new Error(`open task #${taskNum} not found (${openIndex} open tasks exist)`);
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { success: true, taskNum, oldText, newText };
}

/**
 * Append an entry to an activity-log.md file.
 * If a section for today already exists, appends to it.
 * Otherwise inserts a new dated section at the top (before the first existing date section).
 * Returns { success, date }.
 */
function writeActivityEntry(filePath, title, body) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = body ? `- **${title}** — ${body}` : `- **${title}**`;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    // File missing — create minimal structure
    fs.writeFileSync(
      filePath,
      `# Activity Log\n\n**Current stage:** Getting started\n\n## ${today}\n\n${entry}\n`,
      'utf8'
    );
    return { success: true, date: today };
  }

  const lines = content.split('\n');
  const todayHeader = `## ${today}`;
  const todayIdx = lines.indexOf(todayHeader);

  if (todayIdx !== -1) {
    // Append to today's existing section — find last bullet in it
    let lastBulletIdx = todayIdx;
    for (let i = todayIdx + 1; i < lines.length; i++) {
      if (lines[i].match(/^## /)) break;
      if (lines[i].startsWith('- ')) lastBulletIdx = i;
    }
    lines.splice(lastBulletIdx + 1, 0, entry);
  } else {
    // Insert new section before the first date header (or at end)
    let insertAt = lines.findIndex(l => l.match(/^## \d{4}-\d{2}-\d{2}/));
    if (insertAt === -1) insertAt = lines.length;
    // Trim trailing blank lines at the insertion boundary
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
    lines.splice(insertAt, 0, '', `## ${today}`, '', entry, '', '---');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { success: true, date: today };
}

function readFilePreview(filePath, maxBytes = 64 * 1024) {
  let fd = null
  try {
    fd = fs.openSync(filePath, 'r')
  } catch {
    return null
  }
  try {
    const buffer = Buffer.alloc(maxBytes)
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } catch {
    return null
  } finally {
    try { fs.closeSync(fd) } catch {}
  }
}

const FRONTMATTER_BLOCK_REGEX = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n*/

function unquoteFrontmatterValue(value) {
  if (value == null) return value
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseFrontmatterValue(value) {
  const trimmed = String(value || '').trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(item => unquoteFrontmatterValue(item))
  }
  return unquoteFrontmatterValue(trimmed)
}

function extractFrontmatter(content) {
  const match = content.match(FRONTMATTER_BLOCK_REGEX)
  if (!match) return null
  const body = match[1]
  const data = {}
  const order = []
  let currentKey = null
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) {
      const key = kv[1]
      if (!order.includes(key)) order.push(key)
      currentKey = key
      const value = kv[2]
      if (value === '') {
        data[key] = []
      } else {
        data[key] = parseFrontmatterValue(value)
      }
      continue
    }
    const listItem = line.match(/^-\s+(.+)$/)
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(parseFrontmatterValue(listItem[1]))
    }
  }
  return {
    data,
    order,
    raw: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }
}

function buildFrontmatter(data, order = []) {
  const PRIORITY_KEYS = ['title', 'planStatus', 'status', 'dispatched', 'jobSlug', 'lastUpdated', 'dependsOn', 'parentPlan', 'stackDecisions']
  const included = new Set()
  const keys = []
  for (const key of PRIORITY_KEYS) {
    if (key in data) {
      keys.push(key)
      included.add(key)
    }
  }
  for (const key of order) {
    if (included.has(key) || !(key in data)) continue
    keys.push(key)
    included.add(key)
  }
  const remaining = Object.keys(data).filter(key => !included.has(key)).sort()
  keys.push(...remaining)
  if (keys.length === 0) return ''
  const lines = []
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) {
        lines.push(`  - ${item}`)
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

function updateFrontmatter(content, patch = {}) {
  const block = extractFrontmatter(content)
  const data = block ? { ...block.data } : {}
  const order = block ? [...block.order] : []
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') {
      delete data[key]
      continue
    }
    if (!order.includes(key)) order.push(key)
    data[key] = value
  }
  const hasData = Object.keys(data).length > 0
  if (!hasData) {
    if (block) return content.slice(block.end)
    return content.replace(/^\n+/, '')
  }
  const blockText = buildFrontmatter(data, order)
  if (block) {
    const rest = content.slice(block.end).replace(/^\n+/, '\n')
    return `${blockText}${rest}`
  }
  const remainder = content.replace(/^\n+/, '')
  return `${blockText}${remainder}`
}

function parsePlanHeader(text) {
  let dispatched = null
  let jobSlug = null
  let planStatus = null
  let title = null
  const frontmatter = extractFrontmatter(text)
  if (frontmatter) {
    if (frontmatter.data.title) title = frontmatter.data.title
    if (frontmatter.data.planStatus) planStatus = frontmatter.data.planStatus
    else if (frontmatter.data.status) planStatus = frontmatter.data.status
    if (frontmatter.data.dispatched) dispatched = frontmatter.data.dispatched
    if (frontmatter.data.jobSlug) jobSlug = frontmatter.data.jobSlug
    else if (frontmatter.data.job) jobSlug = frontmatter.data.job
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('# ') && !title) {
      title = line.slice(2).trim()
      break
    }
    const dm = line.match(/^Dispatched:\s*(.+)/)
    if (dm && !dispatched) dispatched = dm[1].trim()
    const jm = line.match(/^Job:\s*(.+)/)
    if (jm && !jobSlug) jobSlug = jm[1].trim()
    const sm = line.match(/^Status:\s*(.+)/)
    if (sm && !planStatus) planStatus = sm[1].trim()
  }
  return { dispatched, jobSlug, planStatus, title }
}

function parsePlansDir(dirPath, { includeContent = true } = {}) {
  const plans = []
  try {
    if (!fs.existsSync(dirPath)) return plans
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md'))
      .sort((a, b) => b.localeCompare(a))
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      let stat
      try { stat = fs.statSync(filePath) } catch { continue }
      let content = ''
      if (includeContent) {
        try { content = fs.readFileSync(filePath, 'utf8') } catch { continue }
      }
      const preview = includeContent ? content : readFilePreview(filePath)
      if (preview == null) continue
      const slug = file.replace(/\.md$/, '')
      const header = parsePlanHeader(preview)
      const title = header.title
        ? header.title
        : slug.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
      const plan = {
        slug,
        title,
        lastModified: stat.mtime.toISOString(),
        dispatched: header.dispatched,
        jobSlug: header.jobSlug,
        planStatus: header.planStatus,
      }
      if (includeContent) plan.content = content
      plans.push(plan)
    }
  } catch { /* dir unreadable */ }
  return plans
}

function parseSkillsDir(rootPath, {
  skillsSubdir = path.join('.claude', 'skills'),
  source = null,
  includeSource = false,
  idPrefix = '',
  recursive = false,
} = {}) {
  const skillsDir = path.isAbsolute(skillsSubdir)
    ? skillsSubdir
    : path.join(rootPath, skillsSubdir)
  const skills = []
  const seenIds = new Set()
  const visitedDirs = new Set()

  function parseSkillName(skillFilePath, fallbackName) {
    let name = fallbackName
    try {
      const content = fs.readFileSync(skillFilePath, 'utf8')
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (frontmatterMatch) {
        const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/im)
        if (nameMatch) {
          let parsedName = nameMatch[1].trim()
          if (
            parsedName.length >= 2 &&
            ((parsedName.startsWith('"') && parsedName.endsWith('"')) ||
              (parsedName.startsWith("'") && parsedName.endsWith("'")))
          ) {
            parsedName = parsedName.slice(1, -1).trim()
          }
          if (parsedName) name = parsedName
        }
      }
    } catch {
      // Keep directory name as fallback.
    }
    return name
  }

  function addSkill(relativeId, skillFilePath) {
    const normalizedRelativeId = String(relativeId || '').trim()
    if (!normalizedRelativeId) return
    const skillId = `${idPrefix}${normalizedRelativeId}`
    if (seenIds.has(skillId)) return
    seenIds.add(skillId)

    const fallbackName = path.basename(normalizedRelativeId)
    const name = parseSkillName(skillFilePath, fallbackName)
    const skill = { id: skillId, name }
    if (includeSource && source) skill.source = source
    skills.push(skill)
  }

  function collect(dirPath, parentId = '') {
    let realDirPath = null
    try {
      realDirPath = fs.realpathSync(dirPath)
    } catch {
      return
    }
    if (visitedDirs.has(realDirPath)) return
    visitedDirs.add(realDirPath)

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => {
        if (entry.isDirectory()) return true
        if (!entry.isSymbolicLink()) return false
        const entryPath = path.join(dirPath, entry.name)
        try {
          return fs.statSync(entryPath).isDirectory()
        } catch {
          return false
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      const relativeId = parentId ? `${parentId}/${entry.name}` : entry.name
      const entryDir = path.join(dirPath, entry.name)
      const skillFilePath = path.join(entryDir, 'SKILL.md')
      if (fs.existsSync(skillFilePath)) addSkill(relativeId, skillFilePath)
      if (recursive) collect(entryDir, relativeId)
    }
  }

  try {
    if (!fs.existsSync(skillsDir)) return skills
    collect(skillsDir)
  } catch {
    return []
  }
  return skills
}

function writePlanStatus(filePath, status) {
  let content = '';
  try { content = fs.readFileSync(filePath, 'utf8'); } catch {}
  const frontmatter = extractFrontmatter(content);
  if (frontmatter) {
    const newContent = updateFrontmatter(content, { planStatus: status || null });
    fs.writeFileSync(filePath, newContent, 'utf8');
    return;
  }
  // Remove existing Status: line
  const lines = content.split('\n').filter(l => !l.match(/^Status:\s*/));
  if (status) {
    // Insert after other metadata lines, before first # heading
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^(Dispatched|Job):\s*/)) { insertAt = i + 1; }
      else if (lines[i].startsWith('# ')) break;
    }
    lines.splice(insertAt, 0, `Status: ${status}`);
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function writePlanDispatch(filePath, date, jobId) {
  let content = '';
  try { content = fs.readFileSync(filePath, 'utf8'); } catch {}
  const frontmatter = extractFrontmatter(content);
  if (frontmatter) {
    const newContent = updateFrontmatter(content, {
      dispatched: date || null,
      jobSlug: jobId || null,
    });
    fs.writeFileSync(filePath, newContent, 'utf8');
    return;
  }
  // Remove any existing Dispatched/Job header lines (idempotent)
  const lines = content.split('\n').filter(l => !l.match(/^Dispatched:\s*/) && !l.match(/^Job:\s*/));
  const headerLines = [];
  if (date) headerLines.push(`Dispatched: ${date}`);
  if (jobId) headerLines.push(`Job: ${jobId}`);
  const newContent = [...headerLines, ...lines].join('\n');
  fs.writeFileSync(filePath, newContent, 'utf8');
}

// ── Cron parsing (zero external deps) ────────────────────────

/**
 * Parse a single cron field into a Set of matching integers.
 * Supports: specific values (5), ranges (1-5), step values (star/15), comma lists (1,3,5).
 */
function parseCronField(field, min, max) {
  const result = new Set();
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range, step = 1;
    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
    } else {
      range = part;
    }

    if (range === '*') {
      for (let i = min; i <= max; i += step) result.add(i);
    } else {
      const dashMatch = range.match(/^(\d+)-(\d+)$/);
      if (dashMatch) {
        const start = parseInt(dashMatch[1], 10);
        const end = parseInt(dashMatch[2], 10);
        for (let i = start; i <= end && i <= max; i += step) {
          if (i >= min) result.add(i);
        }
      } else {
        const val = parseInt(range, 10);
        if (!isNaN(val) && val >= min && val <= max) result.add(val);
      }
    }
  }
  return result;
}

/**
 * Check if a cron expression matches a given Date (local time).
 * Standard 5-field: minute hour dom month dow
 * dow: 0=Sun, 1=Mon, ..., 6=Sat, 7=Sun (alias)
 */
function cronMatchesDate(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const dowField = parseCronField(parts[4], 0, 7);
  // Normalize: 7 → 0 (both mean Sunday)
  const dow = new Set([...dowField].map(d => d === 7 ? 0 : d));

  return minute.has(date.getMinutes())
    && hour.has(date.getHours())
    && dom.has(date.getDate())
    && month.has(date.getMonth() + 1)
    && dow.has(date.getDay());
}

/**
 * Compute the next Date after `after` that matches the cron expression.
 * Scans forward minute-by-minute, up to maxDays (default 366).
 * Returns null if no match found within the window.
 */
function computeNextRun(cronExpr, after, maxDays) {
  if (!after) after = new Date();
  maxDays = maxDays || 366;
  // Start from the next whole minute
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = after.getTime() + maxDays * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    if (cronMatchesDate(cronExpr, cursor)) return new Date(cursor);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * Human-readable description of a cron expression.
 * Covers common patterns; falls back to the raw expression for complex ones.
 */
function describeCron(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpr;
  const [min, hr, dom, mon, dow] = parts;

  function fmtTime(h, m) {
    const hh = parseInt(h, 10);
    const mm = parseInt(m, 10);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return mm === 0 ? `${h12} ${ampm}` : `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Every N minutes
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${minStep[1]} minutes`;
  }

  // Specific time patterns
  if (!min.includes(',') && !min.includes('-') && !min.includes('/') &&
      !hr.includes(',') && !hr.includes('-') && !hr.includes('/') &&
      min !== '*' && hr !== '*') {
    const timeStr = fmtTime(hr, min);

    if (dom === '*' && mon === '*' && dow === '*') {
      return `Daily at ${timeStr}`;
    }
    if (dom === '*' && mon === '*' && dow === '1-5') {
      return `Weekdays at ${timeStr}`;
    }
    if (dom === '*' && mon === '*' && dow === '0,6') {
      return `Weekends at ${timeStr}`;
    }
    if (dom === '*' && mon === '*' && dow !== '*') {
      const days = dow.split(',').map(d => dayNames[parseInt(d, 10)] || d).join(', ');
      return `${days} at ${timeStr}`;
    }
    if (/^\d+$/.test(dom) && mon === '*' && dow === '*') {
      return `${dom}${ordinal(parseInt(dom, 10))} of each month at ${timeStr}`;
    }
  }

  return cronExpr;
}

function ordinal(n) {
  if (n >= 11 && n <= 13) return 'th';
  const last = n % 10;
  if (last === 1) return 'st';
  if (last === 2) return 'nd';
  if (last === 3) return 'rd';
  return 'th';
}

/**
 * Validate a cron expression. Returns null if valid, or an error string.
 */
function validateCron(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') return 'cron expression is required';
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return 'cron expression must have exactly 5 fields (minute hour dom month dow)';
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const names = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
  for (let i = 0; i < 5; i++) {
    const vals = parseCronField(parts[i], ranges[i][0], ranges[i][1]);
    if (vals.size === 0) return `invalid ${names[i]} field: "${parts[i]}"`;
  }
  return null;
}

// ── Schedule CRUD ────────────────────────────────────────────

const SCHEDULES_FILENAME = 'schedules.json';
const SCHEDULE_EVENTS_FILENAME = 'schedule-events.json';
const SCHEDULE_LOCKS_DIR = 'schedule-locks';
const SCHEDULE_LOGS_DIR = 'schedule-logs';
const MAX_EVENTS = 100;

function schedulesFilePath(dispatchRoot) {
  return path.join(dispatchRoot, SCHEDULES_FILENAME);
}

function runtimeDir(dispatchRoot) {
  return path.join(dispatchRoot, '.dispatch', 'runtime');
}

function loadSchedules(dispatchRoot) {
  try {
    const fp = schedulesFilePath(dispatchRoot);
    if (fs.existsSync(fp)) {
      const schedules = JSON.parse(fs.readFileSync(fp, 'utf8'));
      // Compute nextRun for each enabled schedule
      const now = new Date();
      return schedules.map(s => {
        // Always compute nextRun relative to 'now' so it's never in the past.
        // Use the later of lastRun and now to handle clock-skew edge cases.
        let after = now;
        if (s.lastRun) {
          const lr = new Date(s.lastRun);
          if (lr > now) after = lr;
        }
        return {
          ...s,
          nextRun: s.enabled ? (computeNextRun(s.cron, after) || null) : null,
        };
      });
    }
  } catch { /* file missing or invalid */ }
  return [];
}

function saveSchedules(dispatchRoot, schedules) {
  // Strip computed nextRun before saving (it's derived from cron + lastRun)
  const toSave = schedules.map(({ nextRun, ...rest }) => rest);
  fs.writeFileSync(schedulesFilePath(dispatchRoot), JSON.stringify(toSave, null, 2) + '\n', 'utf8');
}

function findSchedule(dispatchRoot, id) {
  const schedules = loadSchedules(dispatchRoot);
  return schedules.find(s => s.id === id) || null;
}

function saveSchedule(dispatchRoot, schedule) {
  const schedules = loadSchedules(dispatchRoot);
  const idx = schedules.findIndex(s => s.id === schedule.id);
  if (idx >= 0) {
    schedules[idx] = { ...schedules[idx], ...schedule };
  } else {
    schedules.push(schedule);
  }
  saveSchedules(dispatchRoot, schedules);
  return schedule;
}

function deleteSchedule(dispatchRoot, id) {
  const schedules = loadSchedules(dispatchRoot);
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return false;
  schedules.splice(idx, 1);
  saveSchedules(dispatchRoot, schedules);
  return true;
}

/** Convert a Date to a one-shot cron expression: "M H D Mon *" */
function dateToCron(date) {
  return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
}

function createSchedule(dispatchRoot, fields) {
  const id = 'sched-' + Date.now();
  const schedule = {
    id,
    name: fields.name,
    type: fields.type || 'prompt',
    repo: fields.repo,
    cron: fields.cron,
    prompt: fields.prompt || null,
    model: fields.model || 'claude-opus-4-6',
    loopType: fields.loopType || null,
    agentSpec: fields.agentSpec || null,
    command: fields.command || null,
    recurring: fields.recurring !== undefined ? !!fields.recurring : false,
    enabled: true,
    concurrency: fields.concurrency || 'skip',
    created: new Date().toISOString(),
    lastRun: null,
    lastRunStatus: null,
    lastRunJobId: null,
  };
  saveSchedule(dispatchRoot, schedule);
  return { ...schedule, nextRun: computeNextRun(schedule.cron, new Date()) || null };
}

function updateSchedule(dispatchRoot, id, fields) {
  const schedules = loadSchedules(dispatchRoot);
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const allowed = ['name', 'type', 'repo', 'cron', 'prompt', 'model', 'loopType', 'agentSpec', 'command', 'concurrency', 'recurring'];
  for (const key of allowed) {
    if (fields[key] !== undefined) schedules[idx][key] = fields[key];
  }
  saveSchedules(dispatchRoot, schedules);
  return loadSchedules(dispatchRoot).find(s => s.id === id);
}

function toggleSchedule(dispatchRoot, id) {
  const schedules = loadSchedules(dispatchRoot);
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  schedules[idx].enabled = !schedules[idx].enabled;
  saveSchedules(dispatchRoot, schedules);
  return loadSchedules(dispatchRoot).find(s => s.id === id);
}

function updateScheduleLastRun(dispatchRoot, id, lastRun, lastRunStatus, lastRunJobId) {
  const schedules = loadSchedules(dispatchRoot);
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  schedules[idx].lastRun = lastRun;
  schedules[idx].lastRunStatus = lastRunStatus;
  if (lastRunJobId !== undefined) schedules[idx].lastRunJobId = lastRunJobId;
  saveSchedules(dispatchRoot, schedules);
  return schedules[idx];
}

/**
 * Get adjacent schedules — other schedules whose next run is within windowHours of the given schedule's next run.
 */
function getAdjacentSchedules(dispatchRoot, scheduleId, windowHours) {
  windowHours = windowHours || 2;
  const schedules = loadSchedules(dispatchRoot);
  const target = schedules.find(s => s.id === scheduleId);
  if (!target || !target.nextRun) return [];
  const targetTime = new Date(target.nextRun).getTime();
  const windowMs = windowHours * 60 * 60 * 1000;
  return schedules.filter(s => {
    if (s.id === scheduleId || !s.enabled || !s.nextRun) return false;
    return Math.abs(new Date(s.nextRun).getTime() - targetTime) <= windowMs;
  });
}

// ── Schedule events ──────────────────────────────────────────

function eventsFilePath(dispatchRoot) {
  return path.join(runtimeDir(dispatchRoot), SCHEDULE_EVENTS_FILENAME);
}

function loadScheduleEvents(dispatchRoot, opts) {
  opts = opts || {};
  const fp = eventsFilePath(dispatchRoot);
  let events = [];
  try {
    if (fs.existsSync(fp)) {
      events = JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
  } catch { /* corrupt file */ }
  if (opts.scheduleId) events = events.filter(e => e.scheduleId === opts.scheduleId);
  if (opts.type) events = events.filter(e => e.type === opts.type);
  // Most recent first
  events.sort((a, b) => (b.at || b.startedAt || '').localeCompare(a.at || a.startedAt || ''));
  if (opts.limit) events = events.slice(0, opts.limit);
  return events;
}

function appendScheduleEvent(dispatchRoot, event) {
  const dir = runtimeDir(dispatchRoot);
  fs.mkdirSync(dir, { recursive: true });
  const fp = eventsFilePath(dispatchRoot);
  let events = [];
  try {
    if (fs.existsSync(fp)) events = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { /* corrupt */ }
  event.id = event.id || ('evt-' + Date.now());
  events.push(event);
  // Trim to rolling window
  if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
  fs.writeFileSync(fp, JSON.stringify(events, null, 2) + '\n', 'utf8');
  return event;
}

function clearScheduleEvents(dispatchRoot, scheduleId) {
  const fp = eventsFilePath(dispatchRoot);
  if (!fs.existsSync(fp)) return;
  if (!scheduleId) {
    fs.writeFileSync(fp, '[]\n', 'utf8');
    return;
  }
  let events = [];
  try { events = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  events = events.filter(e => e.scheduleId !== scheduleId);
  fs.writeFileSync(fp, JSON.stringify(events, null, 2) + '\n', 'utf8');
}

// ── Schedule lockfiles ───────────────────────────────────────

function locksDir(dispatchRoot) {
  return path.join(runtimeDir(dispatchRoot), SCHEDULE_LOCKS_DIR);
}

function scheduleLogPath(dispatchRoot, scheduleId) {
  const dir = path.join(runtimeDir(dispatchRoot), SCHEDULE_LOGS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${scheduleId}.log`);
}

function acquireScheduleLock(dispatchRoot, scheduleId, jobId) {
  const dir = locksDir(dispatchRoot);
  fs.mkdirSync(dir, { recursive: true });
  const lockFile = path.join(dir, `${scheduleId}.lock`);

  // Check if lock already exists (per-schedule concurrency: skip)
  if (fs.existsSync(lockFile)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      // Check if PID is still alive
      try { process.kill(lock.pid, 0); return null; } catch { /* stale lock */ }
    } catch { /* corrupt lock file */ }
  }

  const lock = { pid: process.pid, startedAt: new Date().toISOString(), scheduleId, jobId };
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  return lock;
}

function releaseScheduleLock(dispatchRoot, scheduleId) {
  const lockFile = path.join(locksDir(dispatchRoot), `${scheduleId}.lock`);
  try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
}

function getActiveLocks(dispatchRoot) {
  const dir = locksDir(dispatchRoot);
  if (!fs.existsSync(dir)) return [];
  const locks = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.lock')) continue;
    try {
      const lock = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      // Verify PID is still alive
      try { process.kill(lock.pid, 0); locks.push(lock); } catch { /* stale — skip */ }
    } catch { /* corrupt */ }
  }
  return locks;
}

// ── Crontab sync ─────────────────────────────────────────────

const CRONTAB_FENCE_BEGIN = '# dispatch-schedule-begin';
const CRONTAB_FENCE_END = '# dispatch-schedule-end';

function generateCrontabBlock(dispatchRoot) {
  const schedules = loadSchedules(dispatchRoot);
  const absRoot = path.resolve(dispatchRoot);
  const nodeCmd = process.execPath;
  const cliPath = path.join(absRoot, 'cli.js');
  const lines = [CRONTAB_FENCE_BEGIN];
  for (const s of schedules) {
    if (!s.enabled) continue;
    const logPath = path.join(absRoot, '.dispatch', 'runtime', SCHEDULE_LOGS_DIR, `${s.id}.log`);
    lines.push(`# ${s.id} | ${s.name} | ${s.cron}`);
    lines.push(`${s.cron} cd "${absRoot}" && "${nodeCmd}" "${cliPath}" schedule run ${s.id} >> "${logPath}" 2>&1`);
  }
  lines.push(CRONTAB_FENCE_END);
  return lines.join('\n');
}

function syncCrontab(dispatchRoot) {
  const newBlock = generateCrontabBlock(dispatchRoot);
  let existing = '';
  try {
    existing = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { /* no crontab */ }

  // Remove existing fence block
  const fenceRe = new RegExp(
    escapeRegExp(CRONTAB_FENCE_BEGIN) + '[\\s\\S]*?' + escapeRegExp(CRONTAB_FENCE_END) + '\\n?',
    'g'
  );
  let updated = existing.replace(fenceRe, '').trimEnd();

  // Append new block
  if (updated.length > 0) updated += '\n';
  updated += newBlock + '\n';

  // Write back via stdin
  execFileSync('crontab', ['-'], { input: updated, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { synced: true, enabledCount: loadSchedules(dispatchRoot).filter(s => s.enabled).length };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  parseTaskFile,
  parseActivityLog,
  getGitInfo,
  parseJobFile,
  parseJobDir,
  parsePlansDir,
  parseFrontmatter: extractFrontmatter,
  updateFrontmatter,
  parseSkillsDir,
  writePlanDispatch,
  writePlanStatus,
  // Legacy aliases for compatibility during migration
  parseSwarmFile: parseJobFile,
  parseSwarmDir: parseJobDir,
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
  writeJobResults,
  // Legacy aliases for compatibility during migration
  writeSwarmValidation: writeJobValidation,
  writeSwarmKill: writeJobKill,
  writeSwarmStatus: writeJobStatus,
  createCheckpoint,
  revertCheckpoint,
  dismissCheckpoint,
  listCheckpoints,
  parseLoopRun,
  parseLoopRunDetailed,
  parseAllLoopRuns,
  parseLoopState,
  // Cron parsing
  dateToCron,
  parseCronField,
  cronMatchesDate,
  computeNextRun,
  describeCron,
  validateCron,
  // Schedule CRUD
  loadSchedules,
  saveSchedules,
  findSchedule,
  saveSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  getAdjacentSchedules,
  updateScheduleLastRun,
  // Schedule events
  loadScheduleEvents,
  appendScheduleEvent,
  clearScheduleEvents,
  // Schedule locks
  acquireScheduleLock,
  releaseScheduleLock,
  getActiveLocks,
  scheduleLogPath,
  // Crontab sync
  syncCrontab,
  generateCrontabBlock,
};
