#!/bin/bash
# Dispatch - Linear implementation loop
# Runs an implementor agent on <repo>/.dispatch/loops/linear-implementation/prompt.md
# until all phases are complete, with a review/fixup cycle after each phase.
#
# Usage (from dispatch/): loops/linear-implementation.sh --repo <path>

set -euo pipefail

MAX_CLAUDE_RETRIES=3
MAX_FIXUPS=2
SLEEP_BETWEEN=10

# ── Default model ────────────────────────────────────────────────────────────
DEFAULT_CLAUDE_MODEL="claude-opus-4-6"
# ─────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$(cd "$2" && pwd)"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "ERROR: --repo <path> is required" >&2
  echo "Usage: loops/linear-implementation.sh --repo <path>" >&2
  exit 1
fi

PROMPT_FILE="$REPO/.dispatch/loops/linear-implementation/prompt.md"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: prompt.md not found at $PROMPT_FILE" >&2
  echo "Create it with your implementation instructions and re-run." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Set up run directory and logging
# ---------------------------------------------------------------------------
RUN_DIR="$REPO/.dispatch/loops/linear-implementation/$(date '+%Y-%m-%dT%H:%M:%S')"
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

# Snapshot the prompt used for this run
cp "$PROMPT_FILE" "$RUN_DIR/prompt.md"

echo "Starting linear implementation loop."
echo "Repo:    $REPO"
echo "Prompt:  $PROMPT_FILE"
echo "Run dir: $RUN_DIR"
echo ""

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------
REVIEW_INSTRUCTIONS='You are a code reviewer. Review the following git diff from a just-completed implementation phase. Be concise: note what was implemented, flag any issues (missing error handling, type safety problems, incomplete logic). End your response with exactly one line: VERDICT: PASS or VERDICT: FAIL.'

FIXUP_INSTRUCTIONS="A code reviewer found issues with the implementation you just completed. Fix all issues, then commit the fixes with message: 'fix: address review issues from phase'."

# ---------------------------------------------------------------------------
# run_claude [flags...] — reads stdin as prompt, retries on transient failure
# ---------------------------------------------------------------------------
run_claude() {
  local tmp_prompt exit_code=0 attempt=1
  tmp_prompt=$(mktemp)
  cat > "$tmp_prompt"
  while (( attempt <= MAX_CLAUDE_RETRIES )); do
    if (cd "$REPO" && claude --model "$DEFAULT_CLAUDE_MODEL" "$@") < "$tmp_prompt"; then
      rm -f "$tmp_prompt"
      return 0
    fi
    exit_code=$?
    echo "WARNING: claude exited $exit_code (attempt $attempt/$MAX_CLAUDE_RETRIES). Retrying in 10s..." >&2
    sleep 10
    (( ++attempt ))
  done
  rm -f "$tmp_prompt"
  echo "ERROR: claude failed after $MAX_CLAUDE_RETRIES attempts." >&2
  return 1
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
iteration=1
while true; do
  echo "======================================="
  echo "Iteration $iteration - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "======================================="

  pre_phase_sha=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "")

  # Run the implementation phase; stream output live and capture for completion check
  tmp_output=$(mktemp)
  if run_claude --dangerously-skip-permissions --print < "$PROMPT_FILE" | tee "$tmp_output"; then
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

  # Exact-line match to avoid false positives
  if echo "$output" | grep -qx "ALL PHASES COMPLETE"; then
    echo ""
    echo "All phases complete. Loop done."
    exit 0
  fi

  # Review the phase changes, then fix if needed
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
    if review=$(run_claude --print < "$tmp_review" 2>&1); then
      rm -f "$tmp_review"
    else
      rm -f "$tmp_review"
      echo "WARNING: Review failed. Skipping review for this phase."
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
    run_claude --dangerously-skip-permissions --print < "$tmp_fixup" || \
      echo "WARNING: Fixup failed."
    rm -f "$tmp_fixup"
    echo "------------------"
  done

  echo ""
  echo "Sleeping ${SLEEP_BETWEEN}s before next iteration..."
  sleep "$SLEEP_BETWEEN"
  (( ++iteration ))
done
