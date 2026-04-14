import { useMemo } from 'react'
import { Clock, RefreshCcw, CheckCircle2, XCircle, Loader2, ChevronRight } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, timeAgo } from '../lib/utils'
import { getRepoColor, normalizeAgentId, getAgentBrandColor } from '../lib/constants'
import { LOOP_TYPE_META } from '../lib/loopConstants'
import { usePolling } from '../lib/usePolling'
import { mdComponents } from './mdComponents'
import AgentIcon, { getAgentLabel } from './AgentIcon'

const VERDICT_COLORS = {
  PASS: '#4ade80',
  FAIL: '#f87171',
}

const TRANSCRIPT_META_RE = /^(OpenAI |--------$|workdir: |model: |provider: |approval: |sandbox: |reasoning effort: |reasoning summaries: |session id: |user$|assistant$|mcp startup:|codex$|claude$|cursor$|tokens used$|\d{1,3}(,\d{3})*$)/
const SUMMARY_LINE_RE = /^(Implemented:|Findings:|VERDICT:|VERIFIED:|ALL ISSUES RESOLVED|Original findings:|\d+\.\s)/

function normalizeArtifactText(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim()
}

function isTranscriptMetaLine(line) {
  return TRANSCRIPT_META_RE.test(String(line || '').trim())
}

function isDiffStart(line) {
  return /^diff --git /.test(line)
}

function isDiffLine(line) {
  return /^(diff --git |index |--- |\+\+\+ |@@ |[ +\-].*|\\ No newline at end of file)/.test(line)
}

function isDiffMetadataLine(line) {
  return /^(diff --git |index |--- [ab]\/|\+\+\+ [ab]\/|@@ )/.test(String(line || '').trim())
}

function formatArtifactContent(text) {
  const normalized = normalizeArtifactText(text)
  if (!normalized) return '*Empty*'

  const lines = normalized.split('\n')
  const blocks = []

  for (let idx = 0; idx < lines.length;) {
    const line = lines[idx]

    if (isDiffStart(line)) {
      const diffLines = []
      while (idx < lines.length && (lines[idx] === '' || isDiffLine(lines[idx]))) {
        diffLines.push(lines[idx])
        idx += 1
      }
      blocks.push(`\`\`\`diff\n${diffLines.join('\n')}\n\`\`\``)
      continue
    }

    if (isTranscriptMetaLine(line)) {
      const metaLines = []
      while (idx < lines.length && (lines[idx] === '' || isTranscriptMetaLine(lines[idx]))) {
        metaLines.push(lines[idx])
        idx += 1
      }
      blocks.push(`\`\`\`text\n${metaLines.join('\n')}\n\`\`\``)
      continue
    }

    blocks.push(line)
    idx += 1
  }

  return blocks.join('\n')
}

function collectSummaryLines(lines, startIndex) {
  const collected = []
  let blankCount = 0

  for (let idx = startIndex; idx < lines.length; idx += 1) {
    const line = lines[idx]
    const trimmed = line.trim()
    if (!trimmed) {
      blankCount += 1
      if (blankCount > 1 && collected.length > 0) break
      continue
    }
    blankCount = 0
    if (isTranscriptMetaLine(trimmed) || isDiffMetadataLine(trimmed)) continue
    collected.push(trimmed)
    if (collected.length >= 6) break
  }

  return collected
}

function summarizeArtifact(text, type) {
  const normalized = normalizeArtifactText(text)
  if (!normalized) return { status: 'Empty artifact', details: [] }

  const lines = normalized.split('\n')
  const verdictLine = [...lines].reverse().find(line => /^(VERDICT:|VERIFIED:|ALL ISSUES RESOLVED)/.test(line.trim()))
  const verdict = verdictLine ? verdictLine.trim() : null

  if (verdict === 'ALL ISSUES RESOLVED') {
    return { status: verdict, details: [] }
  }

  const findingsStart = lines.findIndex(line => /^Findings:\s*$/.test(line.trim()))
  const implementedStart = lines.findIndex(line => /^Implemented:\s*$/.test(line.trim()))
  const numberedFindings = lines
    .filter(line => /^\d+\.\s+/.test(line.trim()))
    .slice(0, 3)
    .map(line => line.trim())

  const details = findingsStart >= 0
    ? collectSummaryLines(lines, findingsStart).filter(line => line !== 'Findings:')
    : numberedFindings

  if (details.length > 0) {
    return { status: verdict || `${details.length} key finding${details.length === 1 ? '' : 's'}`, details }
  }

  if (implementedStart >= 0) {
    return {
      status: verdict || (type === 'review' ? 'Review summary' : 'Summary'),
      details: collectSummaryLines(lines, implementedStart).filter(line => line !== 'Implemented:'),
    }
  }

  const generic = lines.find(line => SUMMARY_LINE_RE.test(line.trim()) && !isTranscriptMetaLine(line))
  if (generic) {
    return { status: verdict || generic.trim(), details: verdict && generic.trim() !== verdict ? [generic.trim()] : [] }
  }

  return { status: verdict || 'Open artifact', details: [] }
}

export default function LoopReviewPanel({ loop, overview }) {
  const meta = LOOP_TYPE_META[loop?.loopType] || { label: loop?.loopType || 'Unknown', icon: RefreshCcw }
  const TypeIcon = meta.icon
  const repoColor = getRepoColor(overview, loop?.repo)
  const agentId = normalizeAgentId((loop?.agent || 'claude').split(':')[0])
  const agentLabel = getAgentLabel(agentId)
  const agentColor = getAgentBrandColor(agentId)
  const duration = loop?.durationMinutes != null ? timeAgo(null, loop.durationMinutes) : null
  const isActive = loop?.status === 'in_progress'

  // Build artifacts URL from loop identity.
  const artifactsUrl = useMemo(() => {
    if (!loop?.id || !loop?.repo || !loop?.loopType) return null
    const parts = loop.id.split('/')
    const timestamp = parts.length >= 3 ? parts.slice(2).join('/') : parts.slice(1).join('/')
    if (!timestamp) return null
    return `/api/loops/${encodeURIComponent(loop.loopType)}/${encodeURIComponent(timestamp)}/artifacts?repo=${encodeURIComponent(loop.repo)}`
  }, [loop?.id, loop?.repo, loop?.loopType])

  const artifacts = usePolling(artifactsUrl, isActive ? 10000 : null)
  const data = artifacts.data
  const iterations = data?.iterations || []
  const artifactList = data?.artifacts || []

  // Group artifacts by iteration, most recent first
  const iterationGroups = useMemo(() => {
    if (iterations.length === 0 && artifactList.length === 0) return []
    // Collect iteration numbers from both sources
    const iterNums = new Set([
      ...iterations.map(i => i.number),
      ...artifactList.filter(a => a.iteration != null).map(a => a.iteration),
    ])
    const groups = [...iterNums].sort((a, b) => b - a).map(num => {
      const iterInfo = iterations.find(i => i.number === num)
      const arts = artifactList.filter(a => a.iteration === num)
      return { number: num, timestamp: iterInfo?.timestamp || null, verdict: iterInfo?.verdict || null, artifacts: arts }
    })
    return groups
  }, [iterations, artifactList])

  return (
    <div className="space-y-5">
      {/* Metadata card */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="w-6 h-6 rounded-md border flex items-center justify-center shrink-0"
            style={{ color: repoColor, background: `${repoColor}12`, borderColor: `${repoColor}30` }}
          >
            <TypeIcon size={13} />
          </span>
          <span className="text-[13px] font-semibold text-foreground">{meta.label}</span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full border font-medium capitalize"
            style={{ background: `${repoColor}10`, color: repoColor, borderColor: `${repoColor}30` }}
          >
            {loop?.repo}
          </span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color: agentColor }}>
            <AgentIcon agent={agentId} size={10} />
            {loop?.agent || agentLabel}
          </span>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          {loop?.started && <span>Started: <strong className="text-foreground">{loop.started}</strong></span>}
          {duration && (
            <span className="flex items-center gap-1">
              <Clock size={10} /> {duration}
            </span>
          )}
          {loop?.loopState?.iteration > 0 && (
            <span>Iterations: <strong className="text-foreground">{loop.loopState.iteration}</strong></span>
          )}
          <span>Status: <strong className="text-foreground capitalize">{loop?.status === 'in_progress' ? 'running' : loop?.status}</strong></span>
          {loop?.loopState?.lastVerdict && (
            <span>Verdict: <strong className="text-foreground">{loop.loopState.lastVerdict}</strong></span>
          )}
        </div>
      </div>

      {/* Artifacts list grouped by iteration */}
      {iterationGroups.length === 0 ? (
        <div className="py-12 text-center">
          {isActive ? (
            <>
              <Loader2 size={24} className="mx-auto mb-2 text-muted-foreground/30 animate-spin" />
              <p className="text-[12px] text-muted-foreground/50">Awaiting review output…</p>
            </>
          ) : (
            <>
              <TypeIcon size={24} className="mx-auto mb-2 text-muted-foreground/20" />
              <p className="text-[12px] text-muted-foreground/50">No review artifacts found.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {iterationGroups.map(group => {
            const verdictColor = group.verdict ? (VERDICT_COLORS[group.verdict] || '#888') : null
            return (
              <div key={group.number}>
                {/* Iteration header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[12px] font-semibold text-foreground">Iteration {group.number}</span>
                  {group.timestamp && (
                    <span className="text-[10px] text-muted-foreground/50 font-mono">{group.timestamp}</span>
                  )}
                  {group.verdict && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium"
                      style={{ color: verdictColor, borderColor: `${verdictColor}40`, background: `${verdictColor}10` }}
                    >
                      {group.verdict === 'PASS' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                      {group.verdict}
                    </span>
                  )}
                </div>

                {/* Artifact blocks */}
                {group.artifacts.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/40 pl-2">No artifacts for this iteration.</p>
                ) : (
                  <div className="space-y-3">
                    {group.artifacts.map(art => (
                      <ArtifactCard key={art.name} artifact={art} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ArtifactCard({ artifact }) {
  const formattedContent = useMemo(() => formatArtifactContent(artifact.content), [artifact.content])
  const summary = useMemo(() => summarizeArtifact(artifact.content, artifact.type), [artifact.content, artifact.type])

  return (
    <details className="group border border-border rounded-lg overflow-hidden bg-card/20">
      <summary className="list-none px-3 py-2 cursor-pointer border-b border-border/80 bg-card/50">
        <div className="flex items-start gap-2">
          <ChevronRight size={12} className="mt-0.5 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-90" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium capitalize',
                artifact.type === 'review' && 'text-blue-400 bg-blue-400/10',
                artifact.type === 'synthesis' && 'text-purple-400 bg-purple-400/10',
                artifact.type === 'verification' && 'text-amber-400 bg-amber-400/10',
                artifact.type === 'phase' && 'text-emerald-400 bg-emerald-400/10',
                artifact.type === 'unknown' && 'text-muted-foreground bg-card',
              )}>
                {artifact.type}
              </span>
              <span className="text-[10px] text-muted-foreground/40 font-mono break-all">{artifact.name}</span>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-foreground/90">{summary.status}</p>
              {summary.details.length > 0 && (
                <ul className="space-y-1">
                  {summary.details.map(detail => (
                    <li key={detail} className="text-[11px] leading-relaxed text-muted-foreground/75 line-clamp-2">
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </summary>
      <div className="px-4 py-3 text-[13px] leading-relaxed prose-sm max-w-none">
        <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {formattedContent}
        </Markdown>
      </div>
    </details>
  )
}
