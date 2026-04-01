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
  if (lower === 'killed') return 'killed';
  return lower;
}

function parseJobFile(filePath) {
  const id = path.basename(filePath, '.md');
  let taskName = '', started = '', status = 'unknown', validation = 'none', agentId = null, skills = [];
  let originalTask = '', session = null, repo = null;
  let originalPrompt = '';
  let planSlug = null;
  let agent = 'claude';
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

      const agentMatch = line.match(/^Agent:\s*(.+)/);
      if (agentMatch) { agent = agentMatch[1].trim().toLowerCase() || 'claude'; continue; }

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
    originalTask, originalPrompt, session, skipPermissions, resumeId, resumeCommand, repo, planSlug,
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
      const iterMatch = line.match(/Iteration\s+(\d+)/i);
      if (iterMatch) iteration = parseInt(iterMatch[1], 10);
      if (line.includes('ALL PHASES COMPLETE')) { lastVerdict = 'ALL PHASES COMPLETE'; complete = true; }
      else if (line.includes('ALL ISSUES RESOLVED')) { lastVerdict = 'ALL ISSUES RESOLVED'; complete = true; }
      else if (line.includes('VERIFIED: PASS')) lastVerdict = 'VERIFIED: PASS';
      else if (line.includes('VERDICT: PASS')) lastVerdict = 'VERDICT: PASS';
      else if (line.includes('VERDICT: FAIL')) lastVerdict = 'VERDICT: FAIL';
      const statusMatch = line.match(/^LOOP_STATUS:\s*(.+)/);
      if (statusMatch) {
        loopStatus = statusMatch[1].trim();
        if (loopStatus === 'completed') complete = true;
      }
    }
  } catch { /* log missing */ }
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

function loadConfig(hubDir) {
  const localConfigPath = path.join(hubDir, 'config.local.json');
  const configPath = fs.existsSync(localConfigPath) ? localConfigPath : path.join(hubDir, 'config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...raw,
    repos: raw.repos.map(repo => ({
      ...repo,
      resolvedPath: path.resolve(hubDir, repo.path),
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
 * Kill a swarm agent by marking its file as Killed and writing a .kill marker.
 * Returns { success, id, agentId }.
 */
function writeJobKill(filePath) {
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

  // Change Status to Killed
  lines[statusLineIndex] = 'Status: Killed';

  // Append a ## Killed section with timestamp
  const killTimestamp = new Date().toISOString();
  lines.push('');
  lines.push('## Killed');
  lines.push(`Killed at: ${killTimestamp}`);

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
    killed: 'Killed',
  };
  const validStatuses = Object.keys(displayMap);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
  }
  const displayValue = displayMap[newStatus];
  lines[statusLineIndex] = `Status: ${displayValue}`;

  // When completing, always force validation to "Needs validation".
  // This prevents agents from self-validating by writing Validation: Validated
  // directly to the swarm file before the PTY exits.
  if (newStatus === 'completed') {
    let validationLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^Validation:\s/)) {
        validationLineIndex = i;
        break;
      }
    }
    if (validationLineIndex !== -1) {
      const currentVal = lines[validationLineIndex].replace(/^Validation:\s*/, '').trim().toLowerCase().replace(/\s+/g, '_');
      if (currentVal !== 'needs_validation') {
        lines[validationLineIndex] = 'Validation: Needs validation';
      }
    } else {
      // No Validation line exists — insert one after Status
      lines.splice(statusLineIndex + 1, 0, 'Validation: Needs validation');
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  const parsed = parseJobFile(filePath);
  return { success: true, id: parsed.id, status: newStatus };
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
  parseAllLoopRuns,
  parseLoopState,
};
