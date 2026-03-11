/**
 * Shared parsing module for the Scribular coordination hub.
 * Used by cli.js (JSON output) and terminal.js (ANSI output).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function parseTaskFile(filePath) {
  const sections = [];
  let currentSection = null;
  let openCount = 0, doneCount = 0;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
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
        if (done) {
          doneCount++;
          if (currentSection) currentSection.tasks.push({ text, done: true });
        } else {
          openCount++;
          if (currentSection) currentSection.tasks.push({ text, done: false });
        }
      }
    }
  } catch { /* file missing */ }
  return { sections: sections.filter(s => s.tasks.length > 0), openCount, doneCount };
}

function parseActivityLog(filePath) {
  let stage = '';
  const entries = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const stageMatch = line.match(/\*\*Current stage:\*\*\s*(.+)/);
      if (stageMatch) { stage = stageMatch[1]; continue; }
      const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        entries.push({ date: dateMatch[1], bullet: '' });
        continue;
      }
      if (entries.length > 0 && !entries[entries.length - 1].bullet) {
        const bulletMatch = line.match(/^- (.+)/);
        if (bulletMatch) {
          entries[entries.length - 1].bullet = bulletMatch[1]
            .replace(/\*\*/g, '')
            .replace(/\s*\(.*?\)/, '');
        }
      }
    }
  } catch { /* file missing */ }
  return { stage, entries };
}

function getGitInfo(repoPath) {
  try {
    const branch = execSync(`git -C "${repoPath}" branch --show-current`, { encoding: 'utf8' }).trim();
    const porcelain = execSync(`git -C "${repoPath}" status --porcelain`, { encoding: 'utf8' }).trim();
    const dirtyCount = porcelain ? porcelain.split('\n').length : 0;
    return { branch, dirtyCount };
  } catch {
    return { branch: '?', dirtyCount: 0 };
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

function parseSwarmFile(filePath) {
  const id = path.basename(filePath, '.md');
  let taskName = '', started = '', status = 'unknown', validation = 'none', agentId = null, skills = [];
  let originalTask = '';
  const progressEntries = [];
  let results = null;
  let validationNotes = null;

  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    let currentSection = null;
    let resultLines = [];
    let validationLines = [];

    for (const line of lines) {
      // Header metadata
      const taskMatch = line.match(/^#\s+Swarm Task:\s*(.+)/);
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
        if (line.trim()) resultLines.push(line);
      } else if (currentSection === 'validation') {
        if (line.trim()) validationLines.push(line);
      }
    }

    if (resultLines.length > 0) results = resultLines.join('\n');
    if (validationLines.length > 0) validationNotes = validationLines.join('\n');
  } catch { /* file missing or unreadable */ }

  const lastProgress = progressEntries.length > 0 ? progressEntries[progressEntries.length - 1] : null;
  const progressCount = progressEntries.length;

  let durationMinutes = null;
  if (started) {
    const startDate = new Date(started);
    if (!isNaN(startDate.getTime())) {
      durationMinutes = Math.round((Date.now() - startDate.getTime()) / 60000);
    }
  }

  const resultsSummary = results ? results.split('\n')[0] : null;

  return {
    id, taskName, started, status, validation, agentId, skills,
    lastProgress, progressCount, durationMinutes, resultsSummary,
    progressEntries, results, validationNotes,
  };
}

function parseSwarmDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    return files.map(f => parseSwarmFile(path.join(dirPath, f)));
  } catch {
    return [];
  }
}

function loadConfig(hubDir) {
  const configPath = path.join(hubDir, 'config.json');
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
function writeTaskAdd(filePath, text, section) {
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
function writeSwarmValidation(filePath, newValidation, notes) {
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

  const parsed = parseSwarmFile(filePath);
  return { success: true, id: parsed.id, validation: newValidation, taskName: parsed.taskName };
}

/**
 * Kill a swarm agent by marking its file as Killed and writing a .kill marker.
 * Returns { success, id, agentId }.
 */
function writeSwarmKill(filePath) {
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
  const parsed = parseSwarmFile(filePath);
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
function writeSwarmStatus(filePath, newStatus) {
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
  const displayValue = displayMap[newStatus] || newStatus;
  lines[statusLineIndex] = `Status: ${displayValue}`;

  // When completing, auto-set validation to needs_validation if still 'none'
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
      if (currentVal === 'none' || currentVal === '') {
        lines[validationLineIndex] = 'Validation: Needs validation';
      }
    } else {
      // No Validation line exists — insert one after Status
      lines.splice(statusLineIndex + 1, 0, 'Validation: Needs validation');
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  const parsed = parseSwarmFile(filePath);
  return { success: true, id: parsed.id, status: newStatus };
}

// ── Checkpoint operations ────────────────────────────────

/**
 * Create a checkpoint branch capturing the repo's full working directory state.
 * Returns { checkpointId, originalBranch, filesStashed }.
 */
function createCheckpoint(repoPath) {
  const git = (cmd) => execSync(`git -C "${repoPath}" ${cmd}`, { encoding: 'utf8' }).trim();

  const originalBranch = git('branch --show-current');
  if (originalBranch.startsWith('checkpoint/')) {
    throw new Error('already on a checkpoint branch');
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/^(\d{8})(\d{6})/, '$1-$2');
  const checkpointId = `checkpoint/${timestamp}`;

  // Count files that will be captured
  git(`checkout -b "${checkpointId}"`);
  git('add -A');
  const porcelain = git('status --porcelain');
  const filesStashed = porcelain ? porcelain.split('\n').length : 0;

  git(`commit --allow-empty -m "Checkpoint: ${timestamp}\n\nOriginal branch: ${originalBranch}\nFiles captured: ${filesStashed}"`);
  git(`checkout "${originalBranch}"`);

  return { checkpointId, originalBranch, filesStashed };
}

/**
 * Revert to a checkpoint: discard current changes and restore checkpoint state.
 * Returns { checkpointId, filesRestored, filesDiscarded }.
 */
function revertCheckpoint(repoPath, checkpointId) {
  const git = (cmd) => execSync(`git -C "${repoPath}" ${cmd}`, { encoding: 'utf8' }).trim();

  // Ensure full branch name
  const branchName = checkpointId.startsWith('checkpoint/') ? checkpointId : `checkpoint/${checkpointId}`;

  const exists = git(`branch --list "${branchName}"`);
  if (!exists) {
    throw new Error(`checkpoint branch "${branchName}" not found`);
  }

  // Count files being discarded
  const currentPorcelain = git('status --porcelain');
  const filesDiscarded = currentPorcelain ? currentPorcelain.split('\n').length : 0;

  // Discard all current changes
  git('checkout -- .');
  try { git('clean -fd'); } catch { /* no untracked files */ }

  // Restore checkpoint files
  git(`checkout "${branchName}" -- .`);
  const restoredPorcelain = git('status --porcelain');
  const filesRestored = restoredPorcelain ? restoredPorcelain.split('\n').length : 0;

  // Delete the checkpoint branch
  git(`branch -D "${branchName}"`);

  return { checkpointId: branchName, filesRestored, filesDiscarded };
}

/**
 * Dismiss a checkpoint: delete the branch, keep current working directory as-is.
 * Returns { checkpointId }.
 */
function dismissCheckpoint(repoPath, checkpointId) {
  const git = (cmd) => execSync(`git -C "${repoPath}" ${cmd}`, { encoding: 'utf8' }).trim();

  const branchName = checkpointId.startsWith('checkpoint/') ? checkpointId : `checkpoint/${checkpointId}`;

  const exists = git(`branch --list "${branchName}"`);
  if (!exists) {
    throw new Error(`checkpoint branch "${branchName}" not found`);
  }

  git(`branch -D "${branchName}"`);
  return { checkpointId: branchName };
}

/**
 * List all checkpoint branches for a repo.
 * Returns array of { id, created, filesStashed, originalBranch }.
 */
function listCheckpoints(repoPath) {
  const git = (cmd) => execSync(`git -C "${repoPath}" ${cmd}`, { encoding: 'utf8' }).trim();

  const raw = git('branch --list "checkpoint/*"');
  if (!raw) return [];

  const branches = raw.split('\n').map(b => b.trim().replace(/^\* /, ''));
  const checkpoints = [];

  for (const branch of branches) {
    try {
      const msg = git(`log -1 --format=%B "${branch}"`);
      const originalMatch = msg.match(/Original branch:\s*(.+)/);
      const filesMatch = msg.match(/Files captured:\s*(\d+)/);
      const dateStr = git(`log -1 --format=%aI "${branch}"`);

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
 * Finds the first open task whose text contains the search string (case-insensitive).
 * Returns { success, text } or throws on error.
 */
function writeTaskDoneByText(filePath, searchText) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const needle = searchText.toLowerCase().replace(/\*\*/g, '');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)/);
    if (m) {
      const taskText = m[2].replace(/\*\*/g, '').replace(/\s*\(.*?\)\s*$/, '');
      if (taskText.toLowerCase().includes(needle) || needle.includes(taskText.toLowerCase())) {
        lines[i] = lines[i].replace('[ ]', '[x]');
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return { success: true, text: taskText };
      }
    }
  }

  throw new Error(`no open task matching "${searchText}" found`);
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

module.exports = {
  parseTaskFile,
  parseActivityLog,
  getGitInfo,
  parseSwarmFile,
  parseSwarmDir,
  loadConfig,
  writeTaskDone,
  writeTaskDoneByText,
  writeTaskAdd,
  writeTaskEdit,
  writeTaskMove,
  writeSwarmValidation,
  writeSwarmKill,
  writeSwarmStatus,
  createCheckpoint,
  revertCheckpoint,
  dismissCheckpoint,
  listCheckpoints,
};
