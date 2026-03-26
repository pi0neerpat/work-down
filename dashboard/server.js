import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { randomUUID } from 'crypto'
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
  writeTaskDone, writeTaskDoneByText, writeTaskReopenByText, writeTaskAdd, writeTaskEdit, writeTaskMove,
  writeActivityEntry, writeJobValidation, writeJobKill, writeJobStatus,
  createCheckpoint, revertCheckpoint, dismissCheckpoint, listCheckpoints,
} = require('../parsers')

const HUB_DIR = path.resolve(__dirname, '..')
const PORT = 3001
const RUNTIME_DIR = path.join(HUB_DIR, '.hub-runtime')
const JOB_RUNS_FILE = path.join(RUNTIME_DIR, 'job-runs.json')
const PROMPTS_DIR = path.join(RUNTIME_DIR, 'prompts')
const RUN_STATE = Object.freeze({
  QUEUED: 'queued',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  AWAITING_VALIDATION: 'awaiting_validation',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
  FAILED: 'failed',
  KILLED: 'killed',
})
const RUN_TRANSITIONS = Object.freeze({
  [RUN_STATE.QUEUED]: new Set([RUN_STATE.STARTING, RUN_STATE.KILLED, RUN_STATE.FAILED]),
  [RUN_STATE.STARTING]: new Set([RUN_STATE.RUNNING, RUN_STATE.FAILED, RUN_STATE.KILLED]),
  [RUN_STATE.RUNNING]: new Set([RUN_STATE.STOPPING, RUN_STATE.AWAITING_VALIDATION, RUN_STATE.FAILED, RUN_STATE.KILLED]),
  [RUN_STATE.STOPPING]: new Set([RUN_STATE.AWAITING_VALIDATION, RUN_STATE.FAILED, RUN_STATE.KILLED]),
  [RUN_STATE.AWAITING_VALIDATION]: new Set([RUN_STATE.VALIDATED, RUN_STATE.REJECTED]),
  [RUN_STATE.VALIDATED]: new Set(),
  [RUN_STATE.REJECTED]: new Set([RUN_STATE.STARTING]),
  [RUN_STATE.FAILED]: new Set([RUN_STATE.STARTING]),
  [RUN_STATE.KILLED]: new Set([RUN_STATE.STARTING]),
})

function makeSessionId() {
  return `session-${randomUUID()}`
}

function loadJobRunsStore() {
  try {
    if (!fs.existsSync(JOB_RUNS_FILE)) return []
    const parsed = JSON.parse(fs.readFileSync(JOB_RUNS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

const jobRuns = loadJobRunsStore()

function persistJobRunsStore() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  fs.writeFileSync(JOB_RUNS_FILE, JSON.stringify(jobRuns, null, 2), 'utf8')
}

function getJobIdFromPath(filePath) {
  return filePath ? path.basename(filePath, '.md') : null
}

function getLatestRunByJobId(jobId) {
  if (!jobId) return null
  const matches = jobRuns.filter(run => run.jobId === jobId)
  if (matches.length === 0) return null
  matches.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
  return matches[0]
}

function getLatestRunBySessionId(sessionId) {
  if (!sessionId) return null
  const matches = jobRuns.filter(run => run.sessionId === sessionId)
  if (matches.length === 0) return null
  matches.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
  return matches[0]
}

function createRun({ jobId, repo, jobFilePath, sessionId, parentRunId = null, state = RUN_STATE.QUEUED }) {
  const now = new Date().toISOString()
  const run = {
    runId: randomUUID(),
    jobId,
    repo: repo || null,
    jobFilePath: jobFilePath || null,
    sessionId: sessionId || null,
    parentRunId,
    state,
    createdAt: now,
    updatedAt: now,
    startedAt: state === RUN_STATE.RUNNING ? now : null,
    endedAt: null,
    exitReason: null,
    validation: 'none',
  }
  jobRuns.push(run)
  persistJobRunsStore()
  return run
}

function transitionRun(run, nextState, { reason = null, validation = null, force = false } = {}) {
  if (!run) return null
  const current = run.state || RUN_STATE.QUEUED
  if (!force && current !== nextState) {
    const allowed = RUN_TRANSITIONS[current] || new Set()
    if (!allowed.has(nextState)) {
      throw new Error(`Invalid run transition: ${current} -> ${nextState}`)
    }
  }
  const now = new Date().toISOString()
  run.state = nextState
  run.updatedAt = now
  if (!run.startedAt && (nextState === RUN_STATE.RUNNING || nextState === RUN_STATE.STARTING)) {
    run.startedAt = now
  }
  if ([RUN_STATE.KILLED, RUN_STATE.FAILED, RUN_STATE.VALIDATED, RUN_STATE.REJECTED, RUN_STATE.AWAITING_VALIDATION].includes(nextState)) {
    run.endedAt = now
  }
  if (reason) run.exitReason = reason
  if (validation) run.validation = validation
  persistJobRunsStore()
  return run
}

function ensureRunForJob({ jobId, repo, jobFilePath, sessionId, state = RUN_STATE.STARTING, parentRunId = null, force = false }) {
  let run = getLatestRunByJobId(jobId)
  if (!run || [RUN_STATE.VALIDATED, RUN_STATE.REJECTED].includes(run.state)) {
    run = createRun({ jobId, repo, jobFilePath, sessionId, parentRunId, state })
    return run
  }
  run.repo = repo || run.repo || null
  run.jobFilePath = jobFilePath || run.jobFilePath || null
  run.sessionId = sessionId || run.sessionId || null
  transitionRun(run, state, { force: force || run.state === state })
  return run
}

function syncRunForTerminalAttach({ jobId, repo, jobFilePath, sessionId } = {}) {
  if (!jobId) return null
  const run = getLatestRunByJobId(jobId)
  if (!run) {
    return ensureRunForJob({ jobId, repo, jobFilePath, sessionId, state: RUN_STATE.RUNNING })
  }

  run.repo = repo || run.repo || null
  run.jobFilePath = jobFilePath || run.jobFilePath || null
  run.sessionId = sessionId || run.sessionId || null

  if (run.state === RUN_STATE.STARTING || run.state === RUN_STATE.RUNNING) {
    transitionRun(run, RUN_STATE.RUNNING, { force: run.state === RUN_STATE.RUNNING })
  } else {
    persistJobRunsStore()
  }

  return run
}

function allocateUniqueJobFile({ jobsDir, datePrefix, slug }) {
  const safeSlug = slug || 'task'
  let seq = 0
  while (seq < 1000) {
    const suffix = seq === 0 ? '' : `-${seq + 1}`
    const fileName = `${datePrefix}-${safeSlug}${suffix}.md`
    const filePath = path.join(jobsDir, fileName)
    if (!fs.existsSync(filePath)) {
      return { fileName, filePath }
    }
    seq += 1
  }
  throw new Error('Failed to allocate unique job file name')
}

function shellQuote(value) {
  const text = String(value ?? '')
  return `'${text.replace(/'/g, `'\"'\"'`)}'`
}

function buildResumeClaudeCommand(resumeId, flags = '') {
  const id = String(resumeId ?? '').trim()
  if (!id) return null
  return `claude${flags} --resume "${id}"`
}

function buildDispatchPrompt(taskText, jobRelativePath = null) {
  let prompt = String(taskText || '')
  prompt += '\n\nUse a strictly linear approach. Do not run tasks in parallel and do not delegate to sub-agents.'
  if (jobRelativePath) {
    prompt += `\n\nWrite progress to the existing file just created: ${jobRelativePath}`
  }
  return prompt
}

function persistPromptFile(sessionId, prompt) {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  const filePath = path.join(PROMPTS_DIR, `${sessionId}.txt`)
  fs.writeFileSync(filePath, String(prompt || ''), 'utf8')
  return filePath
}

function cleanupPromptFile(filePath) {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

function buildClaudeEnvPrefix({ sessionId = null, jobId = null, repoName = null } = {}) {
  if (!sessionId || !jobId) return ''
  const envVars = {
    HUB_API_BASE: `http://127.0.0.1:${PORT}`,
    HUB_SESSION_ID: sessionId,
    HUB_JOB_ID: jobId,
  }
  if (repoName) envVars.HUB_REPO = repoName
  return `${Object.entries(envVars).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ')} `
}

function buildTrackedClaudeCommand({
  promptFilePath = null,
  model = null,
  maxTurns = null,
  skipPermissions = false,
  resumeId = null,
  sessionId = null,
  jobId = null,
  repoName = null,
} = {}) {
  if (!promptFilePath && !resumeId) return null
  let flags = ''
  if (skipPermissions) flags += ' --dangerously-skip-permissions'
  if (model) flags += ` --model ${shellQuote(model)}`
  if (maxTurns) flags += ` --max-turns ${shellQuote(maxTurns)}`
  const envPrefix = buildClaudeEnvPrefix({ sessionId, jobId, repoName })
  const claudeCommand = resumeId
    ? `${envPrefix}${buildResumeClaudeCommand(resumeId, flags)}`
    : `${envPrefix}claude${flags} "$(cat ${shellQuote(promptFilePath)})"`
  return `${claudeCommand}; __hub_code=$?; echo "__HUB_CLAUDE_EXIT_CODE:\${__hub_code}__"; exit $__hub_code`
}

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
  const latestRunByJob = new Map()
  for (const run of jobRuns) {
    if (!run.jobId) continue
    const prev = latestRunByJob.get(run.jobId)
    if (!prev || Date.parse(run.updatedAt || run.createdAt || 0) > Date.parse(prev.updatedAt || prev.createdAt || 0)) {
      latestRunByJob.set(run.jobId, run)
    }
  }

  let active = 0, completed = 0, failed = 0, needsValidation = 0
  for (const a of allAgents) {
    const run = latestRunByJob.get(a.id)
    const runSessionAlive = run?.sessionId ? liveSessionIds.has(run.sessionId) : false
    const runStateIsActive = run?.state ? [RUN_STATE.STARTING, RUN_STATE.RUNNING, RUN_STATE.STOPPING].includes(run.state) : false
    if ((a.status === 'in_progress' && a.session && liveSessionIds.has(a.session)) || (runSessionAlive && runStateIsActive)) active++
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
      session: latestRunByJob.get(a.id)?.sessionId || a.session,
      runState: latestRunByJob.get(a.id)?.state || null,
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
      serverStarted: Boolean(s.serverStarted),
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
  const { repo, taskText, originalTask, sessionId, ai, model, maxTurns, autoMerge, baseBranch, skipPermissions } = req.body
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
  const jobsDir = path.join(repoConfig.resolvedPath, 'notes', 'jobs')
  const assignedSessionId = sessionId || makeSessionId()

  // Ensure notes/jobs/ exists
  fs.mkdirSync(jobsDir, { recursive: true })

  const { fileName, filePath } = allocateUniqueJobFile({ jobsDir, datePrefix: date, slug })
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const singleLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  const headerTaskText = singleLine(taskText)
  const headerOriginalTask = singleLine(originalTask || '')
  const lines = [
    `# Job Task: ${headerTaskText}`,
    `Started: ${timestamp}`,
    'Status: In progress',
    `Repo: ${repo}`,
  ]
  if (headerOriginalTask && headerOriginalTask !== headerTaskText) {
    lines.push(`OriginalTask: ${headerOriginalTask}`)
  }
  lines.push(`Session: ${assignedSessionId}`)
  lines.push(`SkipPermissions: ${Boolean(skipPermissions)}`)
  if (model) lines.push(`Model: ${model}`)
  if (maxTurns) lines.push(`MaxTurns: ${maxTurns}`)
  if (autoMerge) lines.push('AutoMerge: true')
  if (baseBranch) lines.push(`BaseBranch: ${baseBranch}`)
  lines.push('', '## Progress', `- [${timestamp}] Task initiated from dashboard`, '', '## Results', '')
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8')

  // Return both the relative path (for the prompt) and absolute path
  const relativePath = `notes/jobs/${fileName}`
  const jobId = fileName.replace(/\.md$/, '')
  createRun({
    jobId,
    repo,
    jobFilePath: filePath,
    sessionId: assignedSessionId,
    state: RUN_STATE.STARTING,
  })
  try {
    const promptFilePath = persistPromptFile(assignedSessionId, buildDispatchPrompt(taskText, relativePath))
    createPtySession(
      assignedSessionId,
      repoConfig.resolvedPath,
      repo,
      filePath,
      '',
      null,
      {
        promptFilePath,
        model,
        maxTurns,
        skipPermissions: Boolean(skipPermissions),
        sessionId: assignedSessionId,
        jobId,
        repoName: repo,
      }
    )
  } catch (err) {
    const run = getLatestRunByJobId(jobId)
    if (run) {
      try { transitionRun(run, RUN_STATE.FAILED, { reason: 'spawn_failed', force: true }) } catch {}
    }
    try { writeJobStatus(filePath, 'failed') } catch {}
    return res.status(500).json({ error: `Failed to start job session: ${err.message}` })
  }
  invalidateGitInfoCache(repoConfig.resolvedPath)
  emitJobsChanged({ repo, id: jobId, reason: 'init' })
  res.json({ fileName, relativePath, absolutePath: filePath, repo, sessionId: assignedSessionId, serverStarted: true })
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

app.post('/api/tasks/reopen-by-text', (req, res) => {
  const { repo, text } = req.body
  if (!repo || !text) return res.status(400).json({ error: 'repo and text required' })
  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })
  try {
    const result = writeTaskReopenByText(path.join(repoConfig.resolvedPath, repoConfig.taskFile), text)
    invalidateGitInfoCache(repoConfig.resolvedPath)
    res.json({ ...result, repo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/bugs/reopen-by-text', (req, res) => {
  const { repo, text } = req.body
  if (!repo || !text) return res.status(400).json({ error: 'repo and text required' })
  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })
  if (!repoConfig.bugsFile) return res.status(400).json({ error: `repo "${repo}" has no bugsFile` })
  try {
    const result = writeTaskReopenByText(path.join(repoConfig.resolvedPath, repoConfig.bugsFile), text)
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
  const match = String(resumeCommand).match(/(?:resume|--resume)\s+(?:["'])?([A-Za-z0-9._:-]+)(?:["'])?/i)
  return match ? match[1] : null
}

function markJobReadyForValidation({ jobId, sessionId = null, reason = 'stop_hook' } = {}) {
  const found = findJobFileById(jobId)
  if (!found) return { status: 404, body: { error: `Job "${jobId}" not found` } }

  const detail = parseJobFile(found.filePath)
  if (sessionId && detail.session && detail.session !== sessionId) {
    return { status: 409, body: { error: 'Session does not match job session.' } }
  }

  const latestRun = getLatestRunByJobId(jobId) || (sessionId ? getLatestRunBySessionId(sessionId) : null)
  if ([RUN_STATE.VALIDATED, RUN_STATE.REJECTED, RUN_STATE.FAILED, RUN_STATE.KILLED].includes(latestRun?.state)) {
    return {
      status: 200,
      body: { ok: true, ignored: true, state: latestRun.state, id: jobId, repo: found.repo.name },
    }
  }

  if (latestRun) {
    const activeStates = new Set([RUN_STATE.STARTING, RUN_STATE.RUNNING, RUN_STATE.STOPPING, RUN_STATE.AWAITING_VALIDATION])
    transitionRun(latestRun, RUN_STATE.AWAITING_VALIDATION, {
      reason,
      validation: 'needs_validation',
      force: activeStates.has(latestRun.state),
    })
  }

  if (detail.status === 'in_progress') {
    writeJobStatus(found.filePath, 'completed')
  }
  if (!detail.validation || detail.validation === 'none') {
    writeJobValidation(found.filePath, 'needs_validation', null)
  }

  const session = sessionId ? ptySessions.get(sessionId) : null
  if (session) {
    if (!session.jobFilePath) session.jobFilePath = found.filePath
    if (!session.repo) session.repo = found.repo.name
  }

  invalidateGitInfoCache(found.repo.resolvedPath)
  emitJobsChanged({ repo: found.repo.name, id: jobId, reason })
  return {
    status: 200,
    body: { ok: true, id: jobId, repo: found.repo.name, status: 'completed', validation: 'needs_validation' },
  }
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
    const resumeId = detail.resumeId || extractResumeId(detail.resumeCommand)
    if (!resumeId) {
      return res.status(409).json({
        error: 'No resume id is recorded for this job yet.',
      })
    }
    const skipPermissions = detail.skipPermissions == null ? true : detail.skipPermissions === true
    const resumeFlags = skipPermissions ? ' --dangerously-skip-permissions' : ''
    const resumeCommand = buildResumeClaudeCommand(resumeId, resumeFlags)
    if (!resumeCommand) {
      return res.status(409).json({
        error: 'No resume command is recorded for this job yet.',
      })
    }

    const latestRun = getLatestRunByJobId(req.params.id)
    if (latestRun?.state === RUN_STATE.VALIDATED) {
      return res.status(409).json({ error: 'Validated jobs cannot be resumed.' })
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
    createPtySession(
      sessionId,
      cwd,
      found.repo?.name || null,
      found.filePath,
      priorScrollback,
      null,
      {
        resumeId,
        skipPermissions,
        sessionId,
        jobId: req.params.id,
        repoName: found.repo?.name || null,
      }
    )

    writeJobStatus(found.filePath, 'in_progress')
    writeJobValidation(found.filePath, 'none', null)
    ensureRunForJob({
      jobId: req.params.id,
      repo: found.repo?.name || null,
      jobFilePath: found.filePath,
      sessionId,
      state: RUN_STATE.STARTING,
      parentRunId: latestRun?.runId || null,
      force: true,
    })

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
      resumeId,
      skipPermissions,
      taskText: detail.taskName || detail.originalTask || req.params.id,
      status: 'in_progress',
      validation: 'none',
      serverStarted: true,
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

app.post('/api/hooks/stop-ready', (req, res) => {
  const { sessionId, jobId, reason } = req.body || {}
  if (!sessionId || !jobId) {
    return res.status(400).json({ error: 'sessionId and jobId required' })
  }
  const result = markJobReadyForValidation({ sessionId, jobId, reason: reason || 'stop_hook' })
  return res.status(result.status).json(result.body)
})

app.post(['/api/jobs/:id/validate', '/api/swarm/:id/validate'], (req, res) => {
  const { notes } = req.body || {}
  const found = findJobFileById(req.params.id)
  if (!found) {
    return res.status(404).json({ error: `Job "${req.params.id}" not found` })
  }
  try {
    const detail = parseJobFile(found.filePath)
    const latestRun = getLatestRunByJobId(req.params.id)
    const validatableStates = new Set([RUN_STATE.AWAITING_VALIDATION, RUN_STATE.VALIDATED, RUN_STATE.FAILED, RUN_STATE.RUNNING])
    if (latestRun && !validatableStates.has(latestRun.state)) {
      return res.status(409).json({ error: `Job cannot be validated from state "${latestRun.state}"` })
    }
    if (['failed', 'in_progress'].includes(detail.status)) {
      writeJobStatus(found.filePath, 'completed')
    }
    const result = writeJobValidation(found.filePath, 'validated', notes || null)
    // On validate, fully close and remove the terminal session for this job.
    if (detail.session && ptySessions.has(detail.session)) {
      const s = ptySessions.get(detail.session)
      s.suppressFinalize = true
      if (s.tmuxName) { killTmuxSession(s.tmuxName); delete ptySessionsMeta[detail.session]; savePtySessionsMeta() }
      try { s?.shell?.kill() } catch {}
      ptySessions.delete(detail.session)
    } else if (detail.session && ptySessionsMeta[detail.session]?.tmuxName) {
      // Session may have survived a server restart in tmux — kill it now
      killTmuxSession(ptySessionsMeta[detail.session].tmuxName)
      delete ptySessionsMeta[detail.session]
      savePtySessionsMeta()
    }
    if (latestRun) {
      transitionRun(latestRun, RUN_STATE.VALIDATED, { validation: 'validated', reason: 'user_validated', force: true })
    }
    // Mark the originating task done and log to activity — best-effort, non-blocking
    try {
      const taskText = detail.originalTask || detail.taskName
      if (taskText && found.repo.taskFile) {
        const taskFilePath = path.join(found.repo.resolvedPath, found.repo.taskFile)
        writeTaskDoneByText(taskFilePath, taskText)
      }
    } catch { /* task may already be done or not found — not fatal */ }
    try {
      if (found.repo.activityFile && detail.taskName) {
        const activityFilePath = path.join(found.repo.resolvedPath, found.repo.activityFile)
        writeActivityEntry(activityFilePath, detail.taskName)
      }
    } catch { /* activity log update failure is non-fatal */ }
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
    const latestRun = getLatestRunByJobId(req.params.id)
    if (latestRun && latestRun.state !== RUN_STATE.AWAITING_VALIDATION && latestRun.state !== RUN_STATE.REJECTED) {
      return res.status(409).json({ error: `Job cannot be rejected from state "${latestRun.state}"` })
    }
    const result = writeJobValidation(found.filePath, 'rejected', notes)
    if (latestRun) {
      transitionRun(latestRun, RUN_STATE.REJECTED, { validation: 'rejected', reason: 'user_rejected', force: latestRun.state === RUN_STATE.REJECTED })
    }
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
    const latestRun = getLatestRunByJobId(req.params.id)
    if (detail.status !== 'killed') {
      writeJobKill(found.filePath)
    }
    if (latestRun) {
      transitionRun(latestRun, RUN_STATE.KILLED, {
        validation: latestRun.validation || 'none',
        reason: 'user_killed_job',
        force: latestRun.state === RUN_STATE.KILLED,
      })
    }
    // Terminate the underlying shell if still running, but keep session record
    // so scrollback remains viewable in the dashboard.
    if (detail.session && ptySessions.has(detail.session)) {
      const s = ptySessions.get(detail.session)
      s.killRequested = true
      try { transitionRun(getLatestRunBySessionId(detail.session), RUN_STATE.STOPPING, { reason: 'user_kill_requested', force: true }) } catch {}
      if (s.tmuxName) killTmuxSession(s.tmuxName)
      try { s?.shell?.kill() } catch {}
    }
    invalidateGitInfoCache(found.repo.resolvedPath)
    emitJobsChanged({ repo: found.repo.name, id: req.params.id, reason: 'killed' })
    return res.json({ success: true, id: req.params.id, status: 'killed' })
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
    const idxs = []
    for (let i = 0; i < jobRuns.length; i++) {
      if (jobRuns[i].jobId === req.params.id) idxs.push(i)
    }
    for (let i = idxs.length - 1; i >= 0; i--) jobRuns.splice(idxs[i], 1)
    if (idxs.length > 0) persistJobRunsStore()
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
const DEAD_SESSION_TTL_MS = 6 * 60 * 60 * 1000
const SESSION_GC_INTERVAL_MS = 5 * 60 * 1000

// ── tmux-backed session persistence ──────────────────────
// PTY sessions are wrapped in named tmux sessions so they survive server restarts.
// When node --watch restarts the server, tmux detaches the client but keeps the
// session alive. On reconnect the client gets reattached to the same session.
const PTY_SESSIONS_FILE = path.join(RUNTIME_DIR, 'pty-sessions.json')
const ptySessionsMeta = (() => {
  try {
    if (!fs.existsSync(PTY_SESSIONS_FILE)) return {}
    return JSON.parse(fs.readFileSync(PTY_SESSIONS_FILE, 'utf8'))
  } catch { return {} }
})()

function savePtySessionsMeta() {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
    fs.writeFileSync(PTY_SESSIONS_FILE, JSON.stringify(ptySessionsMeta, null, 2))
  } catch {}
}

function makeTmuxName(sessionId) {
  // tmux names: max 50 chars, no dots, colons, or spaces
  return `wd-${sessionId.replace('session-', '').slice(0, 12)}`
}

function tmuxSessionAlive(name) {
  try { execFileSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }); return true } catch { return false }
}

function killTmuxSession(name) {
  try { execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' }) } catch {}
}

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

function garbageCollectSessions() {
  const now = Date.now()
  for (const [id, session] of ptySessions) {
    if (session?.alive) continue
    if (!session?.created || now - session.created < DEAD_SESSION_TTL_MS) continue
    try {
      if (session?.eventStore?.snapshotPath && fs.existsSync(session.eventStore.snapshotPath)) {
        fs.unlinkSync(session.eventStore.snapshotPath)
      }
    } catch {}
    ptySessions.delete(id)
  }
}

function startPendingLaunch(session) {
  if (!session || session.launchStarted || !session.pendingLaunch) return
  const command = buildTrackedClaudeCommand(session.pendingLaunch)
  if (!command) return
  session.launchStarted = true
  // Transition run to RUNNING now that the command is being written to the PTY
  const jobId = session.pendingLaunch?.jobId || (session.jobFilePath ? getJobIdFromPath(session.jobFilePath) : null)
  if (jobId) {
    const run = getLatestRunByJobId(jobId)
    if (run && (run.state === RUN_STATE.STARTING || run.state === RUN_STATE.RUNNING)) {
      try { transitionRun(run, RUN_STATE.RUNNING, { force: run.state === RUN_STATE.RUNNING }) } catch {}
    }
  }
  try {
    session.shell.write(`${command}\r`)
  } catch (err) {
    console.error(`Failed to start pending launch (${session?.eventStore?.sessionId || 'unknown'}):`, err?.message || err)
    if (typeof session.finalize === 'function') {
      session.finalize('write_error')
    } else {
      session.alive = false
    }
  }
}
setInterval(garbageCollectSessions, SESSION_GC_INTERVAL_MS)

function createPtySession(sessionId, cwd, repoName, jobFilePath, initialScrollback = '', launch = null, pendingLaunch = null) {
  let spawnSpec = launch || { file: '/bin/zsh', args: ['--login'] }
  let tmuxName = null

  if (!launch) {
    // Wrap shell in tmux so the session survives server restarts
    const candidate = makeTmuxName(sessionId)
    try {
      if (!tmuxSessionAlive(candidate)) {
        execFileSync('tmux', ['new-session', '-d', '-s', candidate, '-x', '220', '-y', '50'], {
          cwd,
          env: { ...process.env, TERM: 'xterm-256color' },
          stdio: 'ignore',
        })
      }
      tmuxName = candidate
      spawnSpec = { file: 'tmux', args: ['attach-session', '-t', tmuxName] }
      ptySessionsMeta[sessionId] = { tmuxName, cwd, repoName: repoName || null, jobFilePath: jobFilePath || null }
      savePtySessionsMeta()
    } catch (err) {
      console.warn(`[PTY] tmux unavailable (${err.message}), using direct shell`)
    }
  }

  const shell = pty.spawn(spawnSpec.file, spawnSpec.args, {
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
    killRequested: false,
    suppressFinalize: false,
    commandExitCode: null,
    serverStarted: Boolean(launch || pendingLaunch),
    pendingLaunch: pendingLaunch || null,
    launchStarted: Boolean(launch),
    resumeCommand: null,
    resumeId: null,
    tmuxName: tmuxName || null,
    eventStore: createSessionEventStore({
      sessionId,
      repo: repoName || null,
      baseDir: HUB_DIR,
    }),
  }

  const finalizeSession = (reason = 'unknown') => {
    if (!session.alive) return
    session.alive = false
    // Clean up tmux session — but only if it's actually gone (normal exit).
    // If tmux is still alive here it means the server restarted and killed the
    // node-pty process while the inner shell was still running; in that case we
    // keep the tmux session alive so the client can reattach after restart.
    if (session.tmuxName) {
      if (!tmuxSessionAlive(session.tmuxName) || session.killRequested) {
        killTmuxSession(session.tmuxName)
        delete ptySessionsMeta[sessionId]
        savePtySessionsMeta()
      }
      // else: tmux session still alive — preserve metadata for post-restart reattach
    }
    if (session.suppressFinalize) {
      cleanupPromptFile(session.pendingLaunch?.promptFilePath)
      if (session.ws) {
        try { session.ws.close() } catch {}
      }
      return
    }
    // Ensure job file is in a reviewable state whenever the PTY/session ends.
    if (session.jobFilePath) {
      try {
        if (fs.existsSync(session.jobFilePath)) {
          const agent = parseJobFile(session.jobFilePath)
          const run = getLatestRunByJobId(agent.id) || getLatestRunBySessionId(sessionId)
          const isKilled = session.killRequested || reason === 'killed'
          if (run) {
            if (isKilled) {
              transitionRun(run, RUN_STATE.KILLED, { reason, validation: run.validation || 'none', force: true })
            } else if (reason === 'write_error') {
              transitionRun(run, RUN_STATE.FAILED, { reason, validation: run.validation || 'none', force: true })
            } else if (run.state !== RUN_STATE.AWAITING_VALIDATION) {
              transitionRun(run, RUN_STATE.AWAITING_VALIDATION, {
                reason,
                validation: 'needs_validation',
                force: true,
              })
            }
          }

          if (isKilled) {
            if (agent.status !== 'killed') {
              writeJobKill(session.jobFilePath)
            }
            if (session.repo) {
              const repoConfig = findRepoConfig(session.repo)
              invalidateGitInfoCache(repoConfig?.resolvedPath)
            }
            emitJobsChanged({ repo: session.repo, id: agent.id, reason: `${reason}_killed` })
            return
          }

          if (reason === 'write_error') {
            if (agent.status === 'in_progress') {
              writeJobStatus(session.jobFilePath, 'failed')
            }
            if (session.repo) {
              const repoConfig = findRepoConfig(session.repo)
              invalidateGitInfoCache(repoConfig?.resolvedPath)
            }
            emitJobsChanged({ repo: session.repo, id: agent.id, reason: `${reason}_failed` })
            return
          }

          if (agent.status === 'in_progress') {
            writeJobStatus(session.jobFilePath, 'completed')
            writeJobValidation(session.jobFilePath, 'needs_validation', null)
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
    cleanupPromptFile(session.pendingLaunch?.promptFilePath)
    if (session.ws) {
      try { session.ws.close() } catch {}
    }
  }
  session.finalize = finalizeSession

  shell.onData((data) => {
    let chunk = String(data || '')
    const exitMatch = chunk.match(/__HUB_CLAUDE_EXIT_CODE:(\d+)__/)
    if (exitMatch) {
      session.commandExitCode = parseInt(exitMatch[1], 10)
      chunk = chunk.replace(/__HUB_CLAUDE_EXIT_CODE:\d+__/g, '')
    }

    const stripped = stripAnsi(chunk)
    // Capture resume command emitted by Claude so the job can be resumed later.
    const cmdMatch = stripped.match(/(claude(?:\s+code)?\s+(?:resume|--resume)\s+(?:["'])?[A-Za-z0-9._:-]+(?:["'])?)/i)
    if (cmdMatch) {
      const nextResumeId = extractResumeId(cmdMatch[1])
      const headerDetail = session.jobFilePath && fs.existsSync(session.jobFilePath)
        ? parseJobFile(session.jobFilePath)
        : null
      const resumeFlags = headerDetail?.skipPermissions ? ' --dangerously-skip-permissions' : ''
      const nextResumeCommand = buildResumeClaudeCommand(nextResumeId, resumeFlags)
      if (nextResumeCommand && nextResumeCommand !== session.resumeCommand) {
        session.resumeCommand = nextResumeCommand
        session.resumeId = nextResumeId
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

    if (!chunk) return
    appendChunkToEventStore(session.eventStore, chunk)
    // Buffer output for reconnect
    session.scrollback += chunk
    if (session.scrollback.length > SCROLLBACK_LIMIT) {
      session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT)
    }
    // Forward to attached client
    if (session.ws) {
      try { session.ws.send(chunk) } catch { /* client disconnected */ }
    }
  })

  shell.onExit((event) => {
    if (Number.isInteger(event?.exitCode)) {
      session.commandExitCode = event.exitCode
    }
    finalizeSession(session.killRequested ? 'killed' : 'pty_exit')
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

app.get('/api/job-runs', (req, res) => {
  const jobId = req.query.jobId ? String(req.query.jobId) : null
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null
  let runs = jobRuns
  if (jobId) runs = runs.filter(run => run.jobId === jobId)
  if (sessionId) runs = runs.filter(run => run.sessionId === sessionId)
  res.json({ runs })
})

// Soft-kill a specific PTY session (preserves scrollback/event history).
app.delete('/api/sessions/:id', (req, res) => {
  const session = ptySessions.get(req.params.id)
  if (!session) return res.status(404).json({ error: 'session not found' })
  session.killRequested = true
  try {
    const run = getLatestRunBySessionId(req.params.id)
    if (run) transitionRun(run, RUN_STATE.STOPPING, { reason: 'session_delete_requested', force: true })
  } catch {}
  try { session.shell.kill() } catch {}
  res.json({ ok: true, mode: 'soft_kill' })
})

// Hard-delete a session record (used for explicit UI cleanup).
app.delete('/api/sessions/:id/purge', (req, res) => {
  const session = ptySessions.get(req.params.id)
  if (session?.alive) {
    session.killRequested = true
    session.suppressFinalize = true
    if (session.tmuxName) killTmuxSession(session.tmuxName)
    try { session.shell.kill() } catch {}
  }
  ptySessions.delete(req.params.id)
  // Also clean up any orphaned tmux session (e.g. after server restart)
  const meta = ptySessionsMeta[req.params.id]
  if (meta?.tmuxName && !session?.tmuxName) killTmuxSession(meta.tmuxName)
  if (meta) { delete ptySessionsMeta[req.params.id]; savePtySessionsMeta() }
  res.json({ ok: true, mode: 'purge' })
})

// ── WebSocket terminal server ────────────────────────────
wss = new WebSocketServer({ server, path: '/ws/terminal' })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const repoName = url.searchParams.get('repo')
  const sessionId = url.searchParams.get('session')
  const jobFilePath = url.searchParams.get('jobFile') || url.searchParams.get('swarmFile')
  const jobIdFromPath = getJobIdFromPath(jobFilePath)

  let session

  // Try to reattach to existing session
  if (sessionId && ptySessions.has(sessionId)) {
    session = ptySessions.get(sessionId)
  } else if (sessionId && ptySessionsMeta[sessionId]?.tmuxName) {
    // Server may have restarted — try to reconnect to the persistent tmux session
    const meta = ptySessionsMeta[sessionId]
    if (tmuxSessionAlive(meta.tmuxName)) {
      try {
        session = createPtySession(
          sessionId,
          meta.cwd,
          meta.repoName,
          meta.jobFilePath || jobFilePath,
          '' // scrollback lost on restart, client will see fresh output
        )
      } catch (err) {
        console.error('[PTY] Failed to reattach to tmux session:', err.message)
      }
    } else {
      // tmux session is gone — clean up stale metadata
      delete ptySessionsMeta[sessionId]
      savePtySessionsMeta()
    }
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
    if (jobIdFromPath) {
      try {
        syncRunForTerminalAttach({
          jobId: jobIdFromPath,
          repo: session.repo || repoName,
          jobFilePath: session.jobFilePath || jobFilePath,
          sessionId: sessionId,
        })
      } catch {}
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

    const newId = sessionId || makeSessionId()
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
    if (jobIdFromPath) {
      try {
        syncRunForTerminalAttach({
          jobId: jobIdFromPath,
          repo: repoName,
          jobFilePath: jobFilePath || null,
          sessionId: newId,
        })
      } catch {}
    }

    // Tell client the assigned session ID
    try { ws.send(`\x01SESSION:${newId}`) } catch { /* client disconnected */ }
  }

  ws.on('message', (msg) => {
    const str = msg.toString()
    if (str.startsWith('\x01RESIZE:')) {
      const [cols, rows] = str.slice(8).split(',').map(Number)
      if (cols > 0 && rows > 0) {
        try { session.shell.resize(cols, rows) } catch { /* PTY exited */ }
        startPendingLaunch(session)
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
