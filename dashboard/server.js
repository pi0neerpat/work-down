import { createRequire } from 'module'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import {
  createSessionEventStore,
  appendChunkToEventStore,
  getSessionEvents,
  searchEvents,
  answerFromEvents,
} from './eventPipeline.js'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const {
  parseTaskFile, parseActivityLog, getGitInfo, parseJobFile, parseJobDir, loadConfig,
  writeTaskDone, writeTaskDoneByText, writeTaskAdd, writeTaskEdit, writeTaskMove,
  writeJobValidation, writeJobKill, writeJobStatus,
  createCheckpoint, revertCheckpoint, dismissCheckpoint, listCheckpoints,
} = require('../parsers')

const HUB_DIR = path.resolve(__dirname, '..')
const PORT = 3001

// Strip ANSI escape sequences for clean log output
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences
    .replace(/\x1b\][^\x07]*\x07/g, '')        // OSC sequences
    .replace(/\x1b\([A-Z]/g, '')               // Charset sequences
    .replace(/\x1b[=>]/g, '')                  // Keypad mode
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // Control chars (keep \n \r \t)
}

try {
  loadConfig(HUB_DIR)
} catch (err) {
  console.error('Failed to load hub/config.json:', err.message)
  process.exit(1)
}

const GIT_CACHE_TTL_MS = 8000
const gitInfoCache = new Map() // repoPath -> { value, expiresAt }

function getConfig() {
  return loadConfig(HUB_DIR)
}

function getCachedGitInfo(repoPath) {
  const now = Date.now()
  const cached = gitInfoCache.get(repoPath)
  if (cached && cached.expiresAt > now) return cached.value
  const value = getGitInfo(repoPath)
  gitInfoCache.set(repoPath, { value, expiresAt: now + GIT_CACHE_TTL_MS })
  return value
}

function invalidateGitInfoCache(repoPath) {
  if (!repoPath) return
  gitInfoCache.delete(repoPath)
}

const app = express()
app.use(cors())
app.use(express.json())
let wss = null
const JOB_EVENT = '\x01JOBS_CHANGED:'
const LEGACY_SWARM_EVENT = '\x01SWARM_CHANGED:'

function emitJobsChanged({ repo = null, id = null, reason = null } = {}) {
  if (!wss) return
  const payload = JSON.stringify({ repo, id, reason, ts: Date.now() })
  const msg = `${JOB_EVENT}${payload}`
  const legacyMsg = `${LEGACY_SWARM_EVENT}${payload}`
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue
    try {
      client.send(msg)
      client.send(legacyMsg)
    } catch { /* ignore disconnected client */ }
  }
}

// Serve built SPA in production
const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
}

// ── API endpoints ────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(getConfig())
})

app.get('/api/overview', (req, res) => {
  const config = getConfig()
  const repos = config.repos.map(repo => {
    const rp = repo.resolvedPath
    const tasks = parseTaskFile(path.join(rp, repo.taskFile))
    const activity = parseActivityLog(path.join(rp, repo.activityFile))
    const git = getCachedGitInfo(rp)
    let checkpoints = []
    try { checkpoints = listCheckpoints(rp) } catch { /* ignore */ }

    // Parse bugs.md if configured (optional — gracefully skip if missing)
    let bugs = { openCount: 0, doneCount: 0, sections: [], allTasks: [] }
    if (repo.bugsFile) {
      bugs = parseTaskFile(path.join(rp, repo.bugsFile))
    }

    return {
      name: repo.name,
      git,
      tasks: { openCount: tasks.openCount, doneCount: tasks.doneCount, sections: tasks.sections, allTasks: tasks.allTasks },
      bugs: { openCount: bugs.openCount, doneCount: bugs.doneCount, sections: bugs.sections, allTasks: bugs.allTasks },
      lastActivity: activity.entries[0] || null,
      activity: { stage: activity.stage, entries: activity.entries.slice(0, 3) },
      checkpoints,
    }
  })

  const stage = repos.find(r => r.activity.stage)?.activity.stage || ''
  const totalOpen = repos.reduce((s, r) => s + r.tasks.openCount, 0)
  const totalDone = repos.reduce((s, r) => s + r.tasks.doneCount, 0)

  res.json({ hubRoot: config.hubRoot || HUB_DIR, stage, repos, totals: { openTasks: totalOpen, doneTasks: totalDone }, monthlyBudget: config.monthlyBudget || null })
})

function collectJobAgents(config = getConfig()) {
  const allAgents = []
  for (const repo of config.repos) {
    const jobsDir = path.join(repo.resolvedPath, 'notes', 'jobs')
    const legacySwarmDir = path.join(repo.resolvedPath, 'notes', 'swarm')
    const seen = new Set()
    for (const dirPath of [jobsDir, legacySwarmDir]) {
      const agents = parseJobDir(dirPath)
      for (const agent of agents) {
        if (seen.has(agent.id)) continue
        seen.add(agent.id)
        agent.repo = repo.name
        allAgents.push(agent)
      }
    }
  }
  return allAgents
}

app.get(['/api/jobs', '/api/swarm'], (req, res) => {
  const allAgents = collectJobAgents()
  const liveSessionIds = new Set(
    Array.from(ptySessions.entries())
      .filter(([, s]) => s && s.alive)
      .map(([id]) => id)
  )

  let active = 0, completed = 0, failed = 0, needsValidation = 0
  for (const a of allAgents) {
    if (a.status === 'in_progress' && a.session && liveSessionIds.has(a.session)) active++
    else if (a.status === 'completed') completed++
    else if (a.status === 'failed') failed++
    if (a.validation === 'needs_validation') needsValidation++
  }

  const jobs = allAgents.map(a => ({
      id: a.id,
      repo: a.repo,
      taskName: a.taskName,
      started: a.started,
      status: a.status,
      validation: a.validation,
      lastProgress: a.lastProgress,
      progressCount: a.progressCount,
      durationMinutes: a.durationMinutes,
      skills: a.skills,
      session: a.session,
    }))
  res.json({
    jobs,
    agents: jobs,
    summary: { active, completed, failed, needsValidation },
  })
})

function compareAgentsByStart(a, b) {
  const aTs = a?.started ? Date.parse(a.started) : NaN
  const bTs = b?.started ? Date.parse(b.started) : NaN
  const aHas = Number.isFinite(aTs)
  const bHas = Number.isFinite(bTs)
  if (aHas && bHas && aTs !== bTs) return aTs - bTs
  if (aHas !== bHas) return aHas ? -1 : 1
  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

function buildCanonicalSessionState() {
  const config = getConfig()
  const allAgents = collectJobAgents(config)
  const agentsBySession = new Map()
  const jobFileToSession = {}

  for (const agent of allAgents) {
    if (!agent.session) continue
    if (!agentsBySession.has(agent.session)) agentsBySession.set(agent.session, [])
    agentsBySession.get(agent.session).push(agent)
    jobFileToSession[agent.id] = agent.session
  }

  const sessions = []
  for (const [id, s] of ptySessions) {
    const sessionAgents = (agentsBySession.get(id) || []).slice().sort(compareAgentsByStart)
    const initAgent = sessionAgents[0] || null
    const canonicalAgent = sessionAgents.length > 0 ? sessionAgents[sessionAgents.length - 1] : null
    const shouldExpose = s.alive || (canonicalAgent && canonicalAgent.validation !== 'validated')
    if (!shouldExpose) continue

    if (canonicalAgent?.id) jobFileToSession[canonicalAgent.id] = id
    if (initAgent?.id) jobFileToSession[initAgent.id] = id
    if (s.jobFilePath) jobFileToSession[path.basename(s.jobFilePath, '.md')] = id

    sessions.push({
      id,
      repo: canonicalAgent?.repo || initAgent?.repo || s.repo,
      created: s.created,
      summary: s.eventStore?.summary || null,
      eventCount: s.eventStore?.events?.length || 0,
      jobFileName: canonicalAgent?.id || initAgent?.id || (s.jobFilePath ? path.basename(s.jobFilePath, '.md') : null),
      initJobId: initAgent?.id || null,
      jobId: canonicalAgent?.id || initAgent?.id || null,
      jobIds: sessionAgents.map(a => a.id),
      status: canonicalAgent?.status || initAgent?.status || 'in_progress',
      validation: canonicalAgent?.validation || initAgent?.validation || 'none',
      label: canonicalAgent?.taskName || initAgent?.taskName || 'Manual worker',
      alive: Boolean(s.alive),
    })
  }

  return { sessions, jobFileToSession, swarmFileToSession: jobFileToSession }
}

app.get(['/api/jobs/:id', '/api/swarm/:id'], (req, res) => {
  const config = getConfig()
  for (const repo of config.repos) {
    for (const dirName of ['jobs', 'swarm']) {
      const jobsDir = path.join(repo.resolvedPath, 'notes', dirName)
      const filePath = path.join(jobsDir, `${req.params.id}.md`)
      if (fs.existsSync(filePath)) {
        const agent = parseJobFile(filePath)
        agent.repo = repo.name
        return res.json(agent)
      }
    }
  }
  res.status(404).json({ error: `Job "${req.params.id}" not found` })
})

app.get('/api/activity', (req, res) => {
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10)
  const config = getConfig()

  let allEntries = []
  for (const repo of config.repos) {
    const activity = parseActivityLog(path.join(repo.resolvedPath, repo.activityFile))
    for (const entry of activity.entries) {
      if (entry.bullet) {
        allEntries.push({ date: entry.date, bullet: entry.bullet, repo: repo.name })
      }
    }
  }

  // Sort by date descending
  allEntries.sort((a, b) => b.date.localeCompare(a.date))

  res.json({ entries: allEntries.slice(0, limit) })
})

// ── Write endpoints ──────────────────────────────────────

function findRepoConfig(name) {
  return getConfig().repos.find(r => r.name === name)
}

app.post(['/api/jobs/init', '/api/swarm/init'], (req, res) => {
  const { repo, taskText, originalTask, sessionId, model, maxTurns, autoMerge, baseBranch } = req.body
  if (!repo || !taskText) return res.status(400).json({ error: 'repo and taskText required' })

  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })

  // Generate slug from task text
  const slug = taskText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

  const date = new Date().toISOString().slice(0, 10)
  const fileName = `${date}-${slug}.md`
  const jobsDir = path.join(repoConfig.resolvedPath, 'notes', 'jobs')
  const filePath = path.join(jobsDir, fileName)

  // Ensure notes/jobs/ exists
  fs.mkdirSync(jobsDir, { recursive: true })

  // Don't overwrite if it already exists (e.g. duplicate click)
  if (!fs.existsSync(filePath)) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const singleLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    const headerTaskText = singleLine(taskText)
    const headerOriginalTask = singleLine(originalTask || '')
    const lines = [
      `# Job Task: ${headerTaskText}`,
      `Started: ${timestamp}`,
      `Status: In progress`,
      `Repo: ${repo}`,
    ]
    if (headerOriginalTask && headerOriginalTask !== headerTaskText) {
      lines.push(`OriginalTask: ${headerOriginalTask}`)
    }
    if (sessionId) lines.push(`Session: ${sessionId}`)
    if (model) lines.push(`Model: ${model}`)
    if (maxTurns) lines.push(`MaxTurns: ${maxTurns}`)
    if (autoMerge) lines.push(`AutoMerge: true`)
    if (baseBranch) lines.push(`BaseBranch: ${baseBranch}`)
    lines.push('', '## Progress', `- [${timestamp}] Task initiated from dashboard`, '', '## Results', '')
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
  }

  // Return both the relative path (for the prompt) and absolute path
  const relativePath = `notes/jobs/${fileName}`
  invalidateGitInfoCache(repoConfig.resolvedPath)
  emitJobsChanged({ repo, id: fileName.replace(/\.md$/, ''), reason: 'init' })
  res.json({ fileName, relativePath, absolutePath: filePath, repo })
})

app.post('/api/tasks/done', (req, res) => {
  const { repo, taskNum } = req.body
  if (!repo || !taskNum) return res.status(400).json({ error: 'repo and taskNum required' })

  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })

  try {
    const result = writeTaskDone(path.join(repoConfig.resolvedPath, repoConfig.taskFile), taskNum)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/tasks/done-by-text', (req, res) => {
  const { repo, text } = req.body
  if (!repo || !text) return res.status(400).json({ error: 'repo and text required' })

  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })

  try {
    const result = writeTaskDoneByText(path.join(repoConfig.resolvedPath, repoConfig.taskFile), text)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/tasks/edit', (req, res) => {
  const { repo, taskNum, newText } = req.body
  if (!repo || !taskNum || !newText) return res.status(400).json({ error: 'repo, taskNum, and newText required' })

  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })

  try {
    const result = writeTaskEdit(path.join(repoConfig.resolvedPath, repoConfig.taskFile), taskNum, newText)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/tasks/add', (req, res) => {
  const { repo, text, section } = req.body
  if (!repo || !text) return res.status(400).json({ error: 'repo and text required' })

  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })

  try {
    const result = writeTaskAdd(path.join(repoConfig.resolvedPath, repoConfig.taskFile), text, section || null)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── Bug CRUD endpoints (mirror task endpoints, using bugsFile) ──

app.post('/api/bugs/done', (req, res) => {
  const { repo, taskNum } = req.body
  if (!repo || !taskNum) return res.status(400).json({ error: 'repo and taskNum required' })
  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })
  if (!repoConfig.bugsFile) return res.status(400).json({ error: `repo "${repo}" has no bugsFile` })
  try {
    const result = writeTaskDone(path.join(repoConfig.resolvedPath, repoConfig.bugsFile), taskNum)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/bugs/done-by-text', (req, res) => {
  const { repo, text } = req.body
  if (!repo || !text) return res.status(400).json({ error: 'repo and text required' })
  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })
  if (!repoConfig.bugsFile) return res.status(400).json({ error: `repo "${repo}" has no bugsFile` })
  try {
    const result = writeTaskDoneByText(path.join(repoConfig.resolvedPath, repoConfig.bugsFile), text)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/bugs/add', (req, res) => {
  const { repo, text, section } = req.body
  if (!repo || !text) return res.status(400).json({ error: 'repo and text required' })
  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })
  if (!repoConfig.bugsFile) return res.status(400).json({ error: `repo "${repo}" has no bugsFile` })
  try {
    const result = writeTaskAdd(path.join(repoConfig.resolvedPath, repoConfig.bugsFile), text, section || 'Bug')
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/bugs/edit', (req, res) => {
  const { repo, taskNum, newText } = req.body
  if (!repo || !taskNum || !newText) return res.status(400).json({ error: 'repo, taskNum, and newText required' })
  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })
  if (!repoConfig.bugsFile) return res.status(400).json({ error: `repo "${repo}" has no bugsFile` })
  try {
    const result = writeTaskEdit(path.join(repoConfig.resolvedPath, repoConfig.bugsFile), taskNum, newText)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/tasks/move', (req, res) => {
  const { fromRepo, taskNum, toRepo, section } = req.body
  if (!fromRepo || !toRepo || !taskNum) return res.status(400).json({ error: 'fromRepo, toRepo, and taskNum required' })
  if (fromRepo === toRepo) return res.status(400).json({ error: 'fromRepo and toRepo must be different' })

  const fromConfig = findRepoConfig(fromRepo)
  if (!fromConfig) return res.status(404).json({ error: `repo "${fromRepo}" not found` })

  const toConfig = findRepoConfig(toRepo)
  if (!toConfig) return res.status(404).json({ error: `repo "${toRepo}" not found` })

  try {
    const sourceFile = path.join(fromConfig.resolvedPath, fromConfig.taskFile)
    const destFile = path.join(toConfig.resolvedPath, toConfig.taskFile)
    const result = writeTaskMove(sourceFile, taskNum, destFile, section || null)
    invalidateGitInfoCache(fromConfig.resolvedPath)
    invalidateGitInfoCache(toConfig.resolvedPath)
    res.json({ ...result, fromRepo, toRepo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

function findJobFileById(id, config = getConfig()) {
  for (const repo of config.repos) {
    for (const dirName of ['jobs', 'swarm']) {
      const jobsDir = path.join(repo.resolvedPath, 'notes', dirName)
      const filePath = path.join(jobsDir, `${id}.md`)
      if (fs.existsSync(filePath)) return { repo, filePath }
    }
  }
  return null
}

function upsertHeaderLine(filePath, key, value) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  const prefix = `${key}:`
  const idx = lines.findIndex(line => line.startsWith(prefix))
  const nextLine = `${prefix} ${value}`
  if (idx >= 0) {
    lines[idx] = nextLine
  } else {
    const statusIdx = lines.findIndex(line => line.startsWith('Status:'))
    if (statusIdx >= 0) lines.splice(statusIdx + 1, 0, nextLine)
    else lines.splice(1, 0, nextLine)
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
}

function extractResumeId(resumeCommand) {
  if (!resumeCommand) return null
  const match = String(resumeCommand).match(/(?:resume|--resume)\s+([A-Za-z0-9._:-]+)/i)
  return match ? match[1] : null
}

app.post(['/api/jobs/:id/resume', '/api/swarm/:id/resume'], (req, res) => {
  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }

  try {
    const detail = parseJobFile(found.filePath)
    const sessionId = detail.session || null
    if (!sessionId) {
      return res.status(409).json({
        error: 'This job has no tracked terminal session to resume.',
      })
    }
    const resumeCommand = detail.resumeCommand || (detail.resumeId ? `claude resume ${detail.resumeId}` : null)
    if (!resumeCommand) {
      return res.status(409).json({
        error: 'No resume command is recorded for this job yet.',
      })
    }

    const existingSession = ptySessions.get(sessionId)
    if (existingSession?.alive) {
      return res.status(409).json({
        error: 'This terminal session is already active.',
      })
    }

    // Reopen the terminal session using the same Session: id so job mappings stay stable.
    // Carry forward prior scrollback so users can still inspect earlier output.
    const priorScrollback = existingSession?.scrollback || ''
    if (existingSession) {
      ptySessions.delete(sessionId)
    }

    const cwd = found.repo?.resolvedPath || HUB_DIR
    createPtySession(sessionId, cwd, found.repo?.name || null, found.filePath, priorScrollback)

    writeJobStatus(found.filePath, 'in_progress')
    writeJobValidation(found.filePath, 'none', null)

    const fileName = path.basename(found.filePath)
    const relativePath = path.relative(found.repo.resolvedPath, found.filePath).replaceAll(path.sep, '/')

    invalidateGitInfoCache(found.repo.resolvedPath)
    emitJobsChanged({ repo: found.repo.name, id: req.params.id, reason: 'resumed' })

    return res.json({
      ok: true,
      id: req.params.id,
      repo: found.repo.name,
      sessionId,
      resumeCommand,
      resumeId: extractResumeId(resumeCommand),
      taskText: detail.taskName || detail.originalTask || req.params.id,
      status: 'in_progress',
      validation: 'none',
      jobFile: {
        fileName,
        relativePath,
        absolutePath: found.filePath,
      },
    })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

app.post(['/api/jobs/:id/validate', '/api/swarm/:id/validate'], (req, res) => {
  const { notes } = req.body || {}
  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }
  try {
    const detail = parseJobFile(found.filePath)
    const result = writeJobValidation(found.filePath, 'validated', notes || null)
    // On validate, fully close and remove the terminal session for this job.
    if (detail.session && ptySessions.has(detail.session)) {
      const s = ptySessions.get(detail.session)
      try { s?.shell?.kill() } catch {}
      ptySessions.delete(detail.session)
    }
    invalidateGitInfoCache(found.repo.resolvedPath)
    emitJobsChanged({ repo: found.repo.name, id: req.params.id, reason: 'validated' })
    return res.json(result)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

app.post(['/api/jobs/:id/reject', '/api/swarm/:id/reject'], (req, res) => {
  const { notes } = req.body || {}
  if (!notes) return res.status(400).json({ error: 'notes required when rejecting' })

  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }
  try {
    const result = writeJobValidation(found.filePath, 'rejected', notes)
    invalidateGitInfoCache(found.repo.resolvedPath)
    emitJobsChanged({ repo: found.repo.name, id: req.params.id, reason: 'rejected' })
    return res.json(result)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

app.post(['/api/jobs/:id/kill', '/api/swarm/:id/kill'], (req, res) => {
  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }
  try {
    const detail = parseJobFile(found.filePath)
    const result = writeJobKill(found.filePath)
    // Terminate the underlying shell if still running, but keep session record
    // so scrollback remains viewable in the dashboard.
    if (detail.session && ptySessions.has(detail.session)) {
      const s = ptySessions.get(detail.session)
      try { s?.shell?.kill() } catch {}
    }
    invalidateGitInfoCache(found.repo.resolvedPath)
    emitJobsChanged({ repo: found.repo.name, id: req.params.id, reason: 'killed' })
    return res.json(result)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

app.delete(['/api/jobs/:id', '/api/swarm/:id'], (req, res) => {
  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }
  try {
    fs.unlinkSync(found.filePath)
    // Also remove .kill marker if present
    const killMarker = found.filePath + '.kill'
    if (fs.existsSync(killMarker)) fs.unlinkSync(killMarker)
    invalidateGitInfoCache(found.repo.resolvedPath)
    emitJobsChanged({ repo: found.repo.name, id: req.params.id, reason: 'deleted' })
    return res.json({ ok: true, id: req.params.id, repo: found.repo.name })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

app.post(['/api/jobs/:id/merge', '/api/swarm/:id/merge'], (req, res) => {
  const { targetBranch } = req.body || {}

  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }
  const repoPath = found.repo.resolvedPath
  try {
    const { execSync } = require('child_process')
    const git = (cmd) => execSync(`git -C "${repoPath}" ${cmd}`, { encoding: 'utf8' }).trim()

    // Get current branch (the job's working branch)
    const currentBranch = git('branch --show-current')
    const base = targetBranch || 'main'

    if (currentBranch === base) {
      return res.status(400).json({ error: `Already on ${base} — nothing to merge` })
    }

    // Checkout base, merge branch, then go back
    git(`checkout "${base}"`)
    try {
      git(`merge "${currentBranch}" --no-edit`)
    } catch (mergeErr) {
      // Abort failed merge, restore state
      try { git('merge --abort') } catch { /* ignore */ }
      git(`checkout "${currentBranch}"`)
      return res.status(409).json({ error: `Merge conflict — could not merge ${currentBranch} into ${base}` })
    }
    git(`checkout "${currentBranch}"`)

    invalidateGitInfoCache(found.repo.resolvedPath)
    return res.json({ ok: true, merged: currentBranch, into: base, repo: found.repo.name })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

// ── Checkpoint endpoints ─────────────────────────────────

app.post('/api/repos/:name/checkpoint', (req, res) => {
  const repoConfig = findRepoConfig(req.params.name)
  if (!repoConfig) return res.status(404).json({ error: `repo "${req.params.name}" not found` })

  try {
    const result = createCheckpoint(repoConfig.resolvedPath)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo: req.params.name })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/repos/:name/checkpoints', (req, res) => {
  const repoConfig = findRepoConfig(req.params.name)
  if (!repoConfig) return res.status(404).json({ error: `repo "${req.params.name}" not found` })

  try {
    const result = listCheckpoints(repoConfig.resolvedPath)
    res.json({ checkpoints: result, repo: req.params.name })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/repos/:name/checkpoint/:id/revert', (req, res) => {
  const repoConfig = findRepoConfig(req.params.name)
  if (!repoConfig) return res.status(404).json({ error: `repo "${req.params.name}" not found` })

  const checkpointId = `checkpoint/${req.params.id}`
  try {
    const result = revertCheckpoint(repoConfig.resolvedPath, checkpointId)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo: req.params.name })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.delete('/api/repos/:name/checkpoint/:id', (req, res) => {
  const repoConfig = findRepoConfig(req.params.name)
  if (!repoConfig) return res.status(404).json({ error: `repo "${req.params.name}" not found` })

  const checkpointId = `checkpoint/${req.params.id}`
  try {
    const result = dismissCheckpoint(repoConfig.resolvedPath, checkpointId)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo: req.params.name })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── Schedules CRUD ──────────────────────────────────────

const SCHEDULES_FILE = path.join(HUB_DIR, 'schedules.json')

function loadSchedules() {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'))
    }
  } catch {}
  return []
}

function saveSchedules(schedules) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf8')
}

app.get('/api/schedules', (req, res) => {
  const schedules = loadSchedules()
  res.json({ schedules })
})

app.post('/api/schedules', (req, res) => {
  const { name, repo, cron, prompt, model } = req.body
  if (!name || !repo || !cron || !prompt) {
    return res.status(400).json({ error: 'name, repo, cron, and prompt required' })
  }

  const schedules = loadSchedules()
  const schedule = {
    id: 'sched-' + Date.now(),
    name,
    repo,
    cron,
    prompt,
    model: model || 'claude-opus-4-6',
    enabled: true,
    created: new Date().toISOString(),
    lastRun: null,
    nextRun: null,
  }
  schedules.push(schedule)
  saveSchedules(schedules)
  res.json(schedule)
})

app.put('/api/schedules/:id', (req, res) => {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'schedule not found' })

  const { name, repo, cron, prompt, model } = req.body
  if (name) schedules[idx].name = name
  if (repo) schedules[idx].repo = repo
  if (cron) schedules[idx].cron = cron
  if (prompt) schedules[idx].prompt = prompt
  if (model) schedules[idx].model = model
  saveSchedules(schedules)
  res.json(schedules[idx])
})

app.delete('/api/schedules/:id', (req, res) => {
  let schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'schedule not found' })

  schedules.splice(idx, 1)
  saveSchedules(schedules)
  res.json({ ok: true })
})

app.post('/api/schedules/:id/toggle', (req, res) => {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'schedule not found' })

  schedules[idx].enabled = !schedules[idx].enabled
  saveSchedules(schedules)
  res.json(schedules[idx])
})

// SPA fallback for client-side routing
if (fs.existsSync(distDir)) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const server = app.listen(PORT, () => {
  console.log(`Hub dashboard API running at http://localhost:${PORT}`)
})

// ── Persistent PTY sessions ──────────────────────────────
// Sessions persist across WebSocket disconnects so clients can reconnect
const ptySessions = new Map() // sessionId → { shell, repo, cwd, created, scrollback, alive, jobFilePath, eventStore }

const SCROLLBACK_LIMIT = 50000 // characters of recent output to buffer for reconnect

function parseKindsParam(value) {
  if (!value) return null
  const kinds = new Set(
    String(value)
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  )
  return kinds.size > 0 ? kinds : null
}

function collectEventStores({ scope = 'all', repo = null, sessionId = null } = {}) {
  const stores = []
  for (const [, session] of ptySessions) {
    if (!session.eventStore) continue
    if (scope === 'session' && sessionId && session.eventStore.sessionId !== sessionId) continue
    if (scope === 'repo' && repo && session.eventStore.repo !== repo) continue
    stores.push(session.eventStore)
  }
  return stores
}

function createPtySession(sessionId, cwd, repoName, jobFilePath, initialScrollback = '') {
  const shell = pty.spawn('/bin/zsh', ['--login'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  })

  const session = {
    shell,
    repo: repoName || null,
    cwd,
    created: Date.now(),
    scrollback: initialScrollback || '',
    alive: true,
    ws: null, // current attached WebSocket
    jobFilePath: jobFilePath || null,
    resumeCommand: null,
    resumeId: null,
    eventStore: createSessionEventStore({
      sessionId,
      repo: repoName || null,
      baseDir: HUB_DIR,
    }),
  }

  const finalizeSession = (reason = 'unknown') => {
    if (!session.alive) return
    session.alive = false
    // Ensure job file is in a reviewable state whenever the PTY/session ends.
    if (session.jobFilePath) {
      try {
        if (fs.existsSync(session.jobFilePath)) {
          const agent = parseJobFile(session.jobFilePath)
          if (agent.status === 'in_progress') {
            writeJobStatus(session.jobFilePath, 'completed')
            if (session.repo) {
              const repoConfig = findRepoConfig(session.repo)
              invalidateGitInfoCache(repoConfig?.resolvedPath)
            }
            emitJobsChanged({ repo: session.repo, id: agent.id, reason: `${reason}_completed` })
            console.log(`Session end (${reason}): marked job file as completed: ${session.jobFilePath}`)
          } else if (agent.status === 'completed' && (!agent.validation || agent.validation === 'none')) {
            writeJobValidation(session.jobFilePath, 'needs_validation', null)
            if (session.repo) {
              const repoConfig = findRepoConfig(session.repo)
              invalidateGitInfoCache(repoConfig?.resolvedPath)
            }
            emitJobsChanged({ repo: session.repo, id: agent.id, reason: `${reason}_needs_validation` })
            console.log(`Session end (${reason}): added needs_validation to completed job file: ${session.jobFilePath}`)
          }
        }
      } catch (err) {
        console.error(`Failed to update job status on session end (${reason}):`, err.message)
      }
    }
    if (session.ws) {
      try { session.ws.close() } catch {}
    }
  }
  session.finalize = finalizeSession

  shell.onData((data) => {
    const stripped = stripAnsi(String(data || ''))
    // Capture resume command emitted by Claude so the job can be resumed later.
    const cmdMatch = stripped.match(/(claude(?:\s+code)?\s+(?:resume|--resume)\s+[A-Za-z0-9._:-]+)/i)
    if (cmdMatch) {
      const nextResumeCommand = cmdMatch[1].trim()
      if (nextResumeCommand && nextResumeCommand !== session.resumeCommand) {
        session.resumeCommand = nextResumeCommand
        session.resumeId = extractResumeId(nextResumeCommand)
        if (session.jobFilePath && fs.existsSync(session.jobFilePath)) {
          try {
            upsertHeaderLine(session.jobFilePath, 'ResumeCommand', session.resumeCommand)
            if (session.resumeId) upsertHeaderLine(session.jobFilePath, 'ResumeId', session.resumeId)
          } catch (err) {
            console.error('Failed to persist resume metadata:', err.message)
          }
        }
      }
    }

    appendChunkToEventStore(session.eventStore, data)
    // Buffer output for reconnect
    session.scrollback += data
    if (session.scrollback.length > SCROLLBACK_LIMIT) {
      session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT)
    }
    // Forward to attached client
    if (session.ws) {
      try { session.ws.send(data) } catch { /* client disconnected */ }
    }
  })

  shell.onExit(() => {
    finalizeSession('pty_exit')
    // Don't delete session — keep scrollback and event data for review.
    // Dead sessions have alive=false and can be cleaned up explicitly.
  })

  ptySessions.set(sessionId, session)
  return session
}

// List active PTY sessions (for client recovery after page refresh)
app.get('/api/sessions', (req, res) => {
  const state = buildCanonicalSessionState()
  res.json(state)
})

app.get('/api/sessions/:id/events', (req, res) => {
  const session = ptySessions.get(req.params.id)
  if (!session || !session.eventStore) return res.status(404).json({ error: 'session not found' })

  const limit = parseInt(req.query.limit, 10) || 120
  const cursor = req.query.cursor || null
  const kinds = parseKindsParam(req.query.kinds)

  const page = getSessionEvents(session.eventStore, { cursor, limit, kinds })
  res.json({
    sessionId: req.params.id,
    items: page.items,
    nextCursor: page.nextCursor,
  })
})

app.get('/api/sessions/:id/summary', (req, res) => {
  const session = ptySessions.get(req.params.id)
  if (!session || !session.eventStore) return res.status(404).json({ error: 'session not found' })

  const events = session.eventStore.events
  const latest = events[events.length - 1] || null

  res.json({
    sessionId: req.params.id,
    repo: session.repo,
    alive: session.alive,
    eventCount: events.length,
    latestEvent: latest,
    summary: {
      ...session.eventStore.summary,
      filesTouched: session.eventStore.summary.filesTouched || [],
      toolCalls: session.eventStore.summary.toolCalls || 0,
      currentStep: session.eventStore.summary.lastStep || null,
    },
  })
})

app.post('/api/sessions/:id/chat', async (req, res) => {
  const session = ptySessions.get(req.params.id)
  if (!session || !session.eventStore) return res.status(404).json({ error: 'session not found' })

  const {
    message,
    scope = 'session',
    provider = 'auto',
    model = null,
    includeRaw = false,
  } = req.body || {}

  const stores = collectEventStores({
    scope: scope === 'session' ? 'session' : scope,
    sessionId: req.params.id,
    repo: session.repo,
  })

  const events = stores.flatMap(s => s.events)
  const contextEvents = includeRaw ? events : events.map(evt => ({ ...evt, raw: undefined }))

  const response = await answerFromEvents({
    message: String(message || ''),
    events: contextEvents,
    provider,
    model,
  })

  res.json(response)
})

app.get('/api/events/search', (req, res) => {
  const q = req.query.q || ''
  const scope = req.query.scope || 'all'
  const sessionId = req.query.sessionId || null
  const repo = req.query.repo || null
  const limit = parseInt(req.query.limit, 10) || 50

  const stores = collectEventStores({ scope, repo, sessionId })
  const items = searchEvents(stores, { q, scope, repo, sessionId, limit })
  res.json({ items })
})

// Kill a specific PTY session
app.delete('/api/sessions/:id', (req, res) => {
  const session = ptySessions.get(req.params.id)
  if (!session) return res.status(404).json({ error: 'session not found' })
  try { session.shell.kill() } catch {}
  ptySessions.delete(req.params.id)
  res.json({ ok: true })
})

// ── WebSocket terminal server ────────────────────────────
wss = new WebSocketServer({ server, path: '/ws/terminal' })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const repoName = url.searchParams.get('repo')
  const sessionId = url.searchParams.get('session')
  const jobFilePath = url.searchParams.get('jobFile') || url.searchParams.get('swarmFile')

  let session

  // Try to reattach to existing session
  if (sessionId && ptySessions.has(sessionId)) {
    session = ptySessions.get(sessionId)
  }

  if (session) {
    // Reattach — detach previous WebSocket if any
    if (session.ws) {
      // Expected during reattach flow: old client socket is intentionally closed.
      // Vite dev proxy may log this as ECONNRESET; treat as non-fatal.
      try { session.ws.close(1000, 'Reattached to new client') } catch {}
    }
    session.ws = ws
    // Update job file path if provided (may not have been set on initial creation)
    if (jobFilePath && !session.jobFilePath) {
      session.jobFilePath = jobFilePath
    }

    // Replay buffered output so the client sees recent context
    if (session.scrollback) {
      try { ws.send(session.scrollback) } catch {}
    }
  } else {
    // New session — resolve cwd and spawn PTY
    let cwd = HUB_DIR
    if (repoName) {
      const config = getConfig()
      const repoConfig = config.repos.find(r => r.name === repoName)
      if (repoConfig?.resolvedPath) cwd = repoConfig.resolvedPath
    }

    const newId = sessionId || ('session-' + Date.now())
    try {
      session = createPtySession(newId, cwd, repoName, jobFilePath || null)
    } catch (err) {
      console.error('Failed to spawn PTY:', err.message)
      try {
        ws.send(`\r\n\x1b[31mFailed to spawn terminal: ${err.message}\x1b[0m\r\n`)
        ws.close()
      } catch {}
      return
    }
    session.ws = ws

    // Tell client the assigned session ID
    try { ws.send(`\x01SESSION:${newId}`) } catch { /* client disconnected */ }
  }

  ws.on('message', (msg) => {
    const str = msg.toString()
    if (str.startsWith('\x01RESIZE:')) {
      const [cols, rows] = str.slice(8).split(',').map(Number)
      if (cols > 0 && rows > 0) {
        try { session.shell.resize(cols, rows) } catch { /* PTY exited */ }
      }
      return
    }
    if (str.trim()) {
      appendChunkToEventStore(session.eventStore, `\nUSER> ${stripAnsi(str)}\n`)
    }
    if (!session.alive) {
      // Dead sessions are retained for scrollback/review. Ignore input.
      return
    }
    try {
      session.shell.write(str)
    } catch (err) {
      // Some PTY failures surface as write-time errors (e.g. "Object has been destroyed")
      // without a clean onExit callback. Finalize so jobs don't stay in Active forever.
      console.error(`Session write failed (${session?.eventStore?.sessionId || 'unknown'}):`, err?.message || err)
      if (typeof session?.finalize === 'function') {
        session.finalize('write_error')
      } else {
        session.alive = false
      }
      try { ws.close() } catch {}
    }
  })

  ws.on('close', () => {
    // Detach WebSocket but keep PTY alive for reconnect
    if (session.ws === ws) {
      session.ws = null
    }
  })
})
