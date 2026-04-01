#!/bin/bash
# Dispatch - Linear review loop
# Implements phases from <repo>/.dispatch/loops/linear-review/prompt.md until
# completion, with a review/fixup cycle after each phase.
#
# Usage (from dispatch/): loops/linear-review.sh --repo <path> [--agent tool[:model]] [--session <id>]

set -euo pipefail

MAX_RETRIES=3
MAX_FIXUPS=2
SLEEP_BETWEEN=10

# ── Default model per tool ───────────────────────────────────────────────────
DEFAULT_CLAUDE_MODEL="claude-sonnet-4-6"
DEFAULT_CODEX_MODEL="gpt-5.4"
DEFAULT_CURSOR_MODEL="claude-4.6-opus-high-thinking"
# ─────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
REPO=""
AGENT_SPEC=""
SESSION_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)    REPO="$(cd "$2" && pwd)"; shift 2 ;;
    --agent)   AGENT_SPEC="$2"; shift 2 ;;
    --session) SESSION_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[[ -z "$AGENT_SPEC" ]] && AGENT_SPEC="claude"

if [[ -z "$REPO" ]]; then
  echo "ERROR: --repo <path> is required" >&2
  echo "Usage: loops/linear-review.sh --repo <path>" >&2
  exit 1
fi

PROMPT_FILE="$REPO/.dispatch/loops/linear-review/prompt.md"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: prompt.md not found at $PROMPT_FILE" >&2
  echo "Create it with your implementation instructions and re-run." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Set up run directory and logging
# ---------------------------------------------------------------------------
RUN_DIR="$REPO/.dispatch/loops/linear-review/$(date '+%Y-%m-%dT%H:%M:%S')"
mkdir -p "$RUN_DIR"

# Auto-add .dispatch/ to .gitignore if not already present
GITIGNORE="$REPO/.gitignore"
if ! grep -qx ".dispatch/" "$GITIGNORE" 2>/dev/null; then
  echo ".dispatch/" >> "$GITIGNORE"
  echo "(added .dispatch/ to $GITIGNORE)"
fi

LOG_FILE="$RUN_DIR/loop.log"

# Write structured header before redirecting output
cat > "$LOG_FILE" <<EOF
LOOP_SESSION: ${SESSION_ID}
LOOP_TYPE: linear-review
LOOP_AGENT: ${AGENT_SPEC}
LOOP_STARTED: $(date '+%Y-%m-%d %H:%M:%S')
---
EOF

# Tee all output to log file, still prints live to terminal
exec > >(tee -a "$LOG_FILE") 2>&1

# Write LOOP_STATUS on unexpected exit
trap 'echo "LOOP_STATUS: failed"' ERR

# Snapshot the prompt used for this run
cp "$PROMPT_FILE" "$RUN_DIR/prompt.md"

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------
REVIEW_INSTRUCTIONS='You are a code reviewer. Review the following git diff from a just-completed implementation phase. Be concise: note what was implemented, flag any issues (missing error handling, type safety problems, incomplete logic). End your response with exactly one line: VERDICT: PASS or VERDICT: FAIL.'

FIXUP_INSTRUCTIONS="A code reviewer found issues with the implementation you just completed. Fix all issues, then commit the fixes with message: 'fix: address review issues from phase'."

# ---------------------------------------------------------------------------
# run_agent <spec> [extra-flags...]
# Reads stdin as prompt, retries on transient failure.
# spec format: tool  or  tool:model
# ---------------------------------------------------------------------------
run_agent() {
  local spec="$1"; shift
  local extra_flags=("$@")

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
    exit_code=0
    case "$tool" in
      claude)
        local cmd=(claude --print)
        [[ -n "$model" ]] && cmd+=(--model "$model")
        cmd+=("${extra_flags[@]}")
        (cd "$REPO" && CLAUDE_PROJECT_DIR="$REPO" "${cmd[@]}") < "$tmp_prompt" && { rm -f "$tmp_prompt"; return 0; }
        exit_code=$?
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
        cat "$tmp_prompt" | (cd "$REPO" && CLAUDE_PROJECT_DIR="$REPO" "${cmd[@]}") && { rm -f "$tmp_prompt"; return 0; }
        exit_code=$?
        ;;
      cursor)
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
        (cd "$REPO" && CLAUDE_PROJECT_DIR="$REPO" "${cmd[@]}") && { rm -f "$tmp_prompt"; return 0; }
        exit_code=$?
        ;;
    esac
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
echo "Starting linear review loop."
echo "Repo:    $REPO"
echo "Prompt:  $PROMPT_FILE"
echo "Run dir: $RUN_DIR"
echo ""

iteration=1
while true; do
  echo "======================================="
  echo "Iteration $iteration - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "======================================="

  pre_phase_sha=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "")

  # Run the implementation phase
  tmp_output=$(mktemp)
  if run_agent "$AGENT_SPEC" --dangerously-skip-permissions < "$PROMPT_FILE" | tee "$tmp_output"; then
    output=$(cat "$tmp_output")
    rm -f "$tmp_output"
  else
    cat "$tmp_output"
    rm -f "$tmp_output"
    echo "ERROR: Phase run failed after all retries. Sleeping before next iteration."
    sleep "$SLEEP_BETWEEN"
    (( ++iteration ))
    continue
  fi

  if echo "$output" | grep -qx "ALL PHASES COMPLETE"; then
    echo ""
    echo "All phases complete. Loop done."
    echo "LOOP_STATUS: completed"
    exit 0
  fi

  # Review + fixup cycle
  fixup_attempt=0
  review_idx=0
  while true; do
    echo ""
    echo "-- Phase review --"
    diff=$(git -C "$REPO" diff "$pre_phase_sha" 2>/dev/null || true)
    if [[ -z "$diff" ]]; then
      echo "(no changes to review)"
      break
    fi

    tmp_review=$(mktemp)
    printf '%s\n\n%s' "$REVIEW_INSTRUCTIONS" "$diff" > "$tmp_review"
    if review=$(run_agent "$AGENT_SPEC" < "$tmp_review" 2>&1); then
      rm -f "$tmp_review"
    else
      rm -f "$tmp_review"
      echo "WARNING: Review failed. Skipping."
      break
    fi
    echo "$review" | tee "$RUN_DIR/review_iter${iteration}_${review_idx}.txt"
    echo "------------------"
    (( ++review_idx ))

    if echo "$review" | grep -qx "VERDICT: PASS"; then
      break
    fi

    if (( fixup_attempt >= MAX_FIXUPS )); then
      echo "WARNING: Max fixup attempts reached. Continuing to next phase."
      break
    fi

    (( ++fixup_attempt ))
    echo ""
    echo "-- Fixup attempt $fixup_attempt / $MAX_FIXUPS --"
    tmp_fixup=$(mktemp)
    phase_instructions=$(cat "$PROMPT_FILE")
    printf 'Phase instructions (what was intended):\n%s\n\nDiff of changes made:\n%s\n\nReview feedback:\n%s\n\n%s' \
      "$phase_instructions" "$diff" "$review" "$FIXUP_INSTRUCTIONS" > "$tmp_fixup"
    run_agent "$AGENT_SPEC" --dangerously-skip-permissions < "$tmp_fixup" || \
      echo "WARNING: Fixup failed."
    rm -f "$tmp_fixup"
    echo "------------------"
  done

  echo ""
  echo "Sleeping ${SLEEP_BETWEEN}s before next iteration..."
  sleep "$SLEEP_BETWEEN"
  (( ++iteration ))
done
