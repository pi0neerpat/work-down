#!/bin/bash
# Dispatch - Parallel multi-agent review loop
# Fans out to multiple reviewer agents, synthesizes findings, implements fixes,
# and verifies until all issues are resolved.
#
# Usage (from dispatch/): loops/parallel-review.sh --repo <path> [--agent tool[:model]]...
#
# ── Available models ────────────────────────────────────────────────────────
#
# claude  (claude --print)
#   claude-opus-4-6              claude-sonnet-4-6            claude-haiku-4-5-20251001
#   claude-3-7-sonnet-20250219   claude-3-5-sonnet-20241022   claude-3-5-haiku-20241022
#   claude-3-5-sonnet-20240620   claude-3-opus-20240229       claude-3-sonnet-20240229
#   claude-3-haiku-20240307      claude-2.1                   claude-2.0
#   claude-instant-1.2
#
# codex  (codex exec)
#   gpt-5.4              gpt-5.4-mini         gpt-5.3-codex
#   gpt-5.2-codex        gpt-5.2              gpt-5.1-codex-max
#   gpt-5.1-codex-mini
#
# cursor  (agent -p — run `agent --list-models` for latest)
#   Cursor Composer
#     auto               composer-2           composer-2-fast      composer-1.5
#   Claude
#     claude-4.6-opus-high-thinking  (default)
#     claude-4.6-opus-high           claude-4.6-opus-max          claude-4.6-opus-max-thinking
#     claude-4.6-sonnet-medium       claude-4.6-sonnet-medium-thinking
#     claude-4.5-opus-high           claude-4.5-opus-high-thinking
#     claude-4.5-sonnet              claude-4.5-sonnet-thinking
#     claude-4-sonnet                claude-4-sonnet-1m           claude-4-sonnet-thinking
#     claude-4-sonnet-1m-thinking
#   GPT-5.4
#     gpt-5.4-low        gpt-5.4-medium       gpt-5.4-medium-fast  gpt-5.4-high
#     gpt-5.4-high-fast  gpt-5.4-xhigh        gpt-5.4-xhigh-fast
#     gpt-5.4-mini-none  gpt-5.4-mini-low     gpt-5.4-mini-medium  gpt-5.4-mini-high
#     gpt-5.4-mini-xhigh
#     gpt-5.4-nano-none  gpt-5.4-nano-low     gpt-5.4-nano-medium  gpt-5.4-nano-high
#     gpt-5.4-nano-xhigh
#   GPT-5.3 Codex
#     gpt-5.3-codex-low        gpt-5.3-codex-low-fast   gpt-5.3-codex        gpt-5.3-codex-fast
#     gpt-5.3-codex-high       gpt-5.3-codex-high-fast  gpt-5.3-codex-xhigh  gpt-5.3-codex-xhigh-fast
#     gpt-5.3-codex-spark-preview-low  gpt-5.3-codex-spark-preview  gpt-5.3-codex-spark-preview-high
#     gpt-5.3-codex-spark-preview-xhigh
#   GPT-5.2
#     gpt-5.2-low        gpt-5.2-low-fast     gpt-5.2              gpt-5.2-fast
#     gpt-5.2-high       gpt-5.2-high-fast    gpt-5.2-xhigh        gpt-5.2-xhigh-fast
#     gpt-5.2-codex-low  gpt-5.2-codex-low-fast  gpt-5.2-codex    gpt-5.2-codex-fast
#     gpt-5.2-codex-high gpt-5.2-codex-high-fast gpt-5.2-codex-xhigh gpt-5.2-codex-xhigh-fast
#   GPT-5.1
#     gpt-5.1-low        gpt-5.1              gpt-5.1-high
#     gpt-5.1-codex-max-low  gpt-5.1-codex-max-low-fast  gpt-5.1-codex-max-medium
#     gpt-5.1-codex-max-medium-fast  gpt-5.1-codex-max-high  gpt-5.1-codex-max-high-fast
#     gpt-5.1-codex-max-xhigh  gpt-5.1-codex-max-xhigh-fast
#     gpt-5.1-codex-mini-low   gpt-5.1-codex-mini          gpt-5.1-codex-mini-high
#     gpt-5-mini
#   Other
#     gemini-3.1-pro     gemini-3-flash       grok-4-20            grok-4-20-thinking
#     kimi-k2.5
#
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

MAX_RETRIES=3
MAX_FIXUP_ROUNDS=5
SLEEP_BETWEEN=30

# ── Default model per tool (used when no :model suffix is given) ─────────────
DEFAULT_CLAUDE_MODEL="claude-opus-4-6"
DEFAULT_CODEX_MODEL="gpt-5.4"
DEFAULT_CURSOR_MODEL="claude-4.6-opus-high-thinking"
# ─────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
REPO=""
REVIEWER_AGENTS=()
SYNTHESIZER_AGENT="claude"
IMPLEMENTOR_AGENT="claude"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)        REPO="$(cd "$2" && pwd)"; shift 2 ;;
    --agent)       REVIEWER_AGENTS+=("$2"); shift 2 ;;
    --synthesizer) SYNTHESIZER_AGENT="$2";  shift 2 ;;
    --implementor) IMPLEMENTOR_AGENT="$2";  shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "ERROR: --repo <path> is required" >&2
  echo "Usage: loops/parallel-review.sh --repo <path> [--agent tool[:model]]..." >&2
  exit 1
fi

# Default: single claude reviewer if none passed
[[ ${#REVIEWER_AGENTS[@]} -eq 0 ]] && REVIEWER_AGENTS=("claude")

# ---------------------------------------------------------------------------
# Set up run directory and logging
# ---------------------------------------------------------------------------
RUN_DIR="$REPO/.dispatch/loops/parallel-review/$(date '+%Y-%m-%dT%H:%M:%S')"
mkdir -p "$RUN_DIR"

# Auto-add .dispatch/ to .gitignore if not already present
GITIGNORE="$REPO/.gitignore"
if ! grep -qx ".dispatch/" "$GITIGNORE" 2>/dev/null; then
  echo ".dispatch/" >> "$GITIGNORE"
  echo "(added .dispatch/ to $GITIGNORE)"
fi

LOG_FILE="$RUN_DIR/loop.log"

# Tee all output to log file, still prints live to terminal
exec > >(tee -a "$LOG_FILE") 2>&1

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------
REVIEW_INSTRUCTIONS='You are a code reviewer. Review the following git diff. Be concise: note what was implemented, flag any issues (missing error handling, type safety problems, incomplete logic). End your response with exactly one line: VERDICT: PASS or VERDICT: FAIL.'

SYNTHESIS_INSTRUCTIONS='You are synthesizing code reviews from multiple reviewers. Combine all unique issues into a numbered list. Remove duplicates. If no issues exist across all reviews, output exactly one line: ALL ISSUES RESOLVED'

VERIFY_INSTRUCTIONS='You are verifying a fix. Compare the original findings (listed below) against the new diff. If all findings are resolved, output exactly one line: VERIFIED: PASS. Otherwise list what remains unresolved.'

FIXUP_INSTRUCTIONS="Fix all issues listed above, then commit the fixes with message: 'fix: address review issues'."

# Append project-specific fixup instructions if present
PROJECT_PROMPT="$REPO/.dispatch/loops/parallel-review/prompt.md"
if [[ -f "$PROJECT_PROMPT" ]]; then
  FIXUP_INSTRUCTIONS="${FIXUP_INSTRUCTIONS}

Project-specific instructions:
$(cat "$PROJECT_PROMPT")"
  cp "$PROJECT_PROMPT" "$RUN_DIR/prompt.md"
fi

# ---------------------------------------------------------------------------
# run_agent <spec> [extra-flags...]
# Reads stdin as the prompt. Retries up to MAX_RETRIES on transient failure.
# spec format: tool  or  tool:model
# ---------------------------------------------------------------------------
run_agent() {
  local spec="$1"; shift
  local extra_flags=("$@")

  # Parse tool and optional model from spec; fall back to DEFAULT_*_MODEL
  local tool model=""
  if [[ "$spec" == *:* ]]; then
    tool="${spec%%:*}"
    model="${spec#*:}"
  else
    tool="$spec"
    case "$tool" in
      claude) model="$DEFAULT_CLAUDE_MODEL" ;;
      codex)  model="$DEFAULT_CODEX_MODEL"  ;;
      cursor) model="$DEFAULT_CURSOR_MODEL" ;;
    esac
  fi

  local tmp_prompt exit_code=0 attempt=1
  tmp_prompt=$(mktemp)
  cat > "$tmp_prompt"

  while (( attempt <= MAX_RETRIES )); do
    case "$tool" in
      claude)
        local cmd=(claude --print)
        [[ -n "$model" ]] && cmd+=(--model "$model")
        cmd+=("${extra_flags[@]}")
        if (cd "$REPO" && "${cmd[@]}") < "$tmp_prompt"; then
          rm -f "$tmp_prompt"
          return 0
        fi
        ;;
      codex)
        local cmd=(codex exec --color never)
        [[ -n "$model" ]] && cmd+=(--model "$model")
        local codex_extra=()
        for flag in "${extra_flags[@]}"; do
          if [[ "$flag" == "--dangerously-skip-permissions" ]]; then
            codex_extra+=(--dangerously-bypass-approvals-and-sandbox)
          else
            codex_extra+=("$flag")
          fi
        done
        cmd+=("${codex_extra[@]}")
        cmd+=(-)
        if cat "$tmp_prompt" | (cd "$REPO" && "${cmd[@]}"); then
          rm -f "$tmp_prompt"
          return 0
        fi
        ;;
      cursor)
        # Cursor CLI doesn't read stdin — prompt goes as a positional argument
        local prompt_content
        prompt_content=$(cat "$tmp_prompt")
        local cmd=(agent -p "$prompt_content")
        [[ -n "$model" ]] && cmd+=(--model "$model")
        for flag in "${extra_flags[@]}"; do
          if [[ "$flag" == "--dangerously-skip-permissions" ]]; then
            cmd+=(--force)
          else
            cmd+=("$flag")
          fi
        done
        if (cd "$REPO" && "${cmd[@]}"); then
          rm -f "$tmp_prompt"
          return 0
        fi
        ;;
      *)
        local cmd=("$tool")
        [[ -n "$model" ]] && cmd+=(--model "$model")
        cmd+=("${extra_flags[@]}")
        if (cd "$REPO" && "${cmd[@]}") < "$tmp_prompt"; then
          rm -f "$tmp_prompt"
          return 0
        fi
        ;;
    esac
    exit_code=$?
    echo "WARNING: $tool exited $exit_code (attempt $attempt/$MAX_RETRIES). Retrying in 10s..." >&2
    sleep 10
    (( ++attempt ))
  done

  rm -f "$tmp_prompt"
  echo "ERROR: $tool failed after $MAX_RETRIES attempts." >&2
  return 1
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
echo "Starting parallel review loop."
echo "Repo:        $REPO"
echo "Reviewers:   ${REVIEWER_AGENTS[*]}"
echo "Synthesizer: $SYNTHESIZER_AGENT"
echo "Implementor: $IMPLEMENTOR_AGENT"
echo "Run dir:     $RUN_DIR"
echo ""

# Anchor: diff always computed from this SHA so fixes are cumulative, not lost
start_sha=$(git -C "$REPO" rev-parse HEAD 2>/dev/null)

iteration=1
while true; do
  echo "======================================="
  echo "Iteration $iteration - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "======================================="

  # ------------------------------------------------------------------
  # PHASE 1: Capture diff ONCE, then fan out to all reviewers in parallel
  # ------------------------------------------------------------------
  diff=$(git -C "$REPO" diff "$start_sha" 2>/dev/null || true)

  if [[ -z "$diff" ]]; then
    echo "(nothing to review — no changes since start)"
    exit 0
  fi

  echo "-- Phase 1: Parallel review (${#REVIEWER_AGENTS[@]} agent(s)) --"

  tmp_dir=$(mktemp -d)
  pids=()
  out_files=()

  for i in "${!REVIEWER_AGENTS[@]}"; do
    out="${tmp_dir}/review_${i}.txt"
    out_files+=("$out")
    printf '%s\n\n%s' "$REVIEW_INSTRUCTIONS" "$diff" \
      | run_agent "${REVIEWER_AGENTS[$i]}" > "$out" 2>&1 &
    pids+=($!)
  done

  for pid in "${pids[@]}"; do
    wait "$pid" || echo "WARNING: a reviewer exited non-zero" >&2
  done

  # Copy reviewer outputs to run dir
  for i in "${!out_files[@]}"; do
    cp "${out_files[$i]}" "$RUN_DIR/review_iter${iteration}_agent${i}.txt"
  done

  # ------------------------------------------------------------------
  # PHASE 2: Synthesis
  # ------------------------------------------------------------------
  echo ""
  echo "-- Phase 2: Synthesis --"

  combined_reviews=""
  for i in "${!out_files[@]}"; do
    label="${REVIEWER_AGENTS[$i]}"
    review_text=$(cat "${out_files[$i]}")
    combined_reviews+="=== Review by ${label} ===
${review_text}

"
  done
  rm -rf "$tmp_dir"

  synthesis_prompt="${SYNTHESIS_INSTRUCTIONS}

${combined_reviews}"

  synthesis=$(printf '%s' "$synthesis_prompt" | run_agent "$SYNTHESIZER_AGENT" 2>&1)
  echo "$synthesis"
  echo "$synthesis" > "$RUN_DIR/synthesis_iter${iteration}.txt"
  echo "------------------"

  if echo "$synthesis" | grep -qx "ALL ISSUES RESOLVED"; then
    echo ""
    echo "All issues resolved. Loop done."
    exit 0
  fi

  # ------------------------------------------------------------------
  # PHASE 3+4: Fix-verify cycle
  # ------------------------------------------------------------------
  fixup_round=0
  while (( fixup_round < MAX_FIXUP_ROUNDS )); do
    (( ++fixup_round ))
    echo ""
    echo "-- Fixup round $fixup_round / $MAX_FIXUP_ROUNDS --"

    fixup_prompt="Issues found by reviewers:
${synthesis}

${FIXUP_INSTRUCTIONS}"

    printf '%s' "$fixup_prompt" \
      | run_agent "$IMPLEMENTOR_AGENT" --dangerously-skip-permissions \
      || echo "WARNING: Fixup failed."

    echo "-- Verification --"
    new_diff=$(git -C "$REPO" diff "$start_sha" 2>/dev/null || true)
    verify_prompt="${VERIFY_INSTRUCTIONS}

Original findings:
${synthesis}

New diff (everything from start, including all fixes):
${new_diff}"

    verification=$(printf '%s' "$verify_prompt" | run_agent "$SYNTHESIZER_AGENT" 2>&1)
    echo "$verification"
    echo "$verification" > "$RUN_DIR/verification_iter${iteration}_round${fixup_round}.txt"
    echo "------------------"

    if echo "$verification" | grep -qx "VERIFIED: PASS"; then
      echo "(fixes verified — proceeding to next review cycle)"
      break
    fi
  done

  if (( fixup_round >= MAX_FIXUP_ROUNDS )); then
    echo "WARNING: max fixup rounds reached. Continuing to next review cycle."
  fi

  echo ""
  echo "Sleeping ${SLEEP_BETWEEN}s before re-reviewing..."
  sleep "$SLEEP_BETWEEN"
  (( ++iteration ))
done
