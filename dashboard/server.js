import { createRequire } from 'module'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { WebSocketServer } from 'ws'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const {
  parseTaskFile, parseActivityLog, getGitInfo, parseSwarmFile, parseSwarmDir, loadConfig,
  writeTaskDone, writeTaskDoneByText, writeTaskAdd, writeTaskEdit, writeTaskMove,
  writeSwarmValidation, writeSwarmKill, writeSwarmStatus,
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

let config
try {
  config = loadConfig(HUB_DIR)
} catch (err) {
  console.error('Failed to load hub/config.json:', err.message)
  process.exit(1)
}

const app = express()
app.use(cors())
app.use(express.json())

// Serve built SPA in production
const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
}

// ── API endpoints ────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(config)
})

app.get('/api/overview', (req, res) => {
  const repos = config.repos.map(repo => {
    const rp = repo.resolvedPath
    const tasks = parseTaskFile(path.join(rp, repo.taskFile))
    const activity = parseActivityLog(path.join(rp, repo.activityFile))
    const git = getGitInfo(rp)
    let checkpoints = []
    try { checkpoints = listCheckpoints(rp) } catch { /* ignore */ }

    return {
      name: repo.name,
      git,
      tasks: { openCount: tasks.openCount, doneCount: tasks.doneCount, sections: tasks.sections },
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

app.get('/api/swarm', (req, res) => {
  const allAgents = []
  for (const repo of config.repos) {
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm')
    const agents = parseSwarmDir(swarmDir)
    for (const agent of agents) agent.repo = repo.name
    allAgents.push(...agents)
  }

  let active = 0, completed = 0, failed = 0, needsValidation = 0
  for (const a of allAgents) {
    if (a.status === 'in_progress') active++
    else if (a.status === 'completed') completed++
    else if (a.status === 'failed') failed++
    if (a.validation === 'needs_validation') needsValidation++
  }

  res.json({
    agents: allAgents.map(a => ({
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
    })),
    summary: { active, completed, failed, needsValidation },
  })
})

app.get('/api/swarm/:id', (req, res) => {
  for (const repo of config.repos) {
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm')
    const filePath = path.join(swarmDir, `${req.params.id}.md`)
    if (fs.existsSync(filePath)) {
      const agent = parseSwarmFile(filePath)
      agent.repo = repo.name
      return res.json(agent)
    }
  }
  res.status(404).json({ error: `Swarm agent "${req.params.id}" not found` })
})

app.get('/api/activity', (req, res) => {
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10)

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
  return config.repos.find(r => r.name === name)
}

app.post('/api/swarm/init', (req, res) => {
  const { repo, taskText, sessionId } = req.body
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
  const swarmDir = path.join(repoConfig.resolvedPath, 'notes', 'swarm')
  const filePath = path.join(swarmDir, fileName)

  // Ensure notes/swarm/ exists
  fs.mkdirSync(swarmDir, { recursive: true })

  // Don't overwrite if it already exists (e.g. duplicate click)
  if (!fs.existsSync(filePath)) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const lines = [
      `# Swarm Task: ${taskText}`,
      `Started: ${timestamp}`,
      `Status: In progress`,
      `Repo: ${repo}`,
    ]
    if (sessionId) lines.push(`Session: ${sessionId}`)
    lines.push('', '## Progress', `- [${timestamp}] Task initiated from dashboard`, '', '## Results', '')
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
  }

  // Return both the relative path (for the prompt) and absolute path
  const relativePath = `notes/swarm/${fileName}`
  res.json({ fileName, relativePath, absolutePath: filePath, repo })
})

app.post('/api/tasks/done', (req, res) => {
  const { repo, taskNum } = req.body
  if (!repo || !taskNum) return res.status(400).json({ error: 'repo and taskNum required' })

  const repoConfig = findRepoConfig(repo)
  if (!repoConfig) return res.status(404).json({ error: `repo "${repo}" not found` })

  try {
    const result = writeTaskDone(path.join(repoConfig.resolvedPath, repoConfig.taskFile), taskNum)
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
    res.json({ ...result, fromRepo, toRepo })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/swarm/:id/validate', (req, res) => {
  const { notes } = req.body || {}
  for (const repo of config.repos) {
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm')
    const filePath = path.join(swarmDir, `${req.params.id}.md`)
    if (fs.existsSync(filePath)) {
      try {
        const result = writeSwarmValidation(filePath, 'validated', notes || null)
        return res.json(result)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }
  }
  res.status(404).json({ error: `Swarm agent "${req.params.id}" not found` })
})

app.post('/api/swarm/:id/reject', (req, res) => {
  const { notes } = req.body || {}
  if (!notes) return res.status(400).json({ error: 'notes required when rejecting' })

  for (const repo of config.repos) {
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm')
    const filePath = path.join(swarmDir, `${req.params.id}.md`)
    if (fs.existsSync(filePath)) {
      try {
        const result = writeSwarmValidation(filePath, 'rejected', notes)
        return res.json(result)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }
  }
  res.status(404).json({ error: `Swarm agent "${req.params.id}" not found` })
})

app.post('/api/swarm/:id/kill', (req, res) => {
  for (const repo of config.repos) {
    const swarmDir = path.join(repo.resolvedPath, 'notes', 'swarm')
    const filePath = path.join(swarmDir, `${req.params.id}.md`)
    if (fs.existsSync(filePath)) {
      try {
        const result = writeSwarmKill(filePath)
        return res.json(result)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }
  }
  res.status(404).json({ error: `Swarm agent "${req.params.id}" not found` })
})

// ── Checkpoint endpoints ─────────────────────────────────

app.post('/api/repos/:name/checkpoint', (req, res) => {
  const repoConfig = findRepoConfig(req.params.name)
  if (!repoConfig) return res.status(404).json({ error: `repo "${req.params.name}" not found` })

  try {
    const result = createCheckpoint(repoConfig.resolvedPath)
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
    res.json({ ...result, repo: req.params.name })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// SPA fallback for client-side routing
if (fs.existsSync(distDir)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const server = app.listen(PORT, () => {
  console.log(`Hub dashboard API running at http://localhost:${PORT}`)
})

// ── Persistent PTY sessions ──────────────────────────────
// Sessions persist across WebSocket disconnects so clients can reconnect
const ptySessions = new Map() // sessionId → { shell, repo, cwd, created, scrollback, alive, swarmFilePath }

const SCROLLBACK_LIMIT = 50000 // characters of recent output to buffer for reconnect

function createPtySession(sessionId, cwd, repoName, swarmFilePath) {
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
    scrollback: '',
    alive: true,
    ws: null, // current attached WebSocket
    swarmFilePath: swarmFilePath || null,
  }

  shell.onData((data) => {
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
    session.alive = false
    // If there's an associated swarm file that's still in_progress, mark it completed
    if (session.swarmFilePath) {
      try {
        if (fs.existsSync(session.swarmFilePath)) {
          const agent = parseSwarmFile(session.swarmFilePath)
          if (agent.status === 'in_progress') {
            writeSwarmStatus(session.swarmFilePath, 'completed')
            console.log(`PTY exit: marked swarm file as completed: ${session.swarmFilePath}`)
          }
        }
      } catch (err) {
        console.error(`Failed to update swarm status on PTY exit:`, err.message)
      }
    }
    if (session.ws) {
      try { session.ws.close() } catch {}
    }
    ptySessions.delete(sessionId)
  })

  ptySessions.set(sessionId, session)
  return session
}

// List active PTY sessions (for client recovery after page refresh)
app.get('/api/sessions', (req, res) => {
  const sessions = []
  for (const [id, s] of ptySessions) {
    if (s.alive) {
      sessions.push({ id, repo: s.repo, created: s.created })
    }
  }
  res.json({ sessions })
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
const wss = new WebSocketServer({ server, path: '/ws/terminal' })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const repoName = url.searchParams.get('repo')
  const sessionId = url.searchParams.get('session')
  const swarmFilePath = url.searchParams.get('swarmFile')

  let session

  // Try to reattach to existing session
  if (sessionId && ptySessions.has(sessionId)) {
    session = ptySessions.get(sessionId)
    if (!session.alive) {
      ptySessions.delete(sessionId)
      session = null
    }
  }

  if (session) {
    // Reattach — detach previous WebSocket if any
    if (session.ws) {
      try { session.ws.close() } catch {}
    }
    session.ws = ws
    // Update swarm file path if provided (may not have been set on initial creation)
    if (swarmFilePath && !session.swarmFilePath) {
      session.swarmFilePath = swarmFilePath
    }

    // Replay buffered output so the client sees recent context
    if (session.scrollback) {
      try { ws.send(session.scrollback) } catch {}
    }
  } else {
    // New session — resolve cwd and spawn PTY
    let cwd = HUB_DIR
    if (repoName) {
      const repoConfig = config.repos.find(r => r.name === repoName)
      if (repoConfig?.resolvedPath) cwd = repoConfig.resolvedPath
    }

    const newId = sessionId || ('session-' + Date.now())
    try {
      session = createPtySession(newId, cwd, repoName, swarmFilePath || null)
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
    ws.send(`\x01SESSION:${newId}`)
  }

  ws.on('message', (msg) => {
    const str = msg.toString()
    if (str.startsWith('\x01RESIZE:')) {
      const [cols, rows] = str.slice(8).split(',').map(Number)
      if (cols > 0 && rows > 0) session.shell.resize(cols, rows)
      return
    }
    session.shell.write(str)
  })

  ws.on('close', () => {
    // Detach WebSocket but keep PTY alive for reconnect
    if (session.ws === ws) {
      session.ws = null
    }
  })
})
