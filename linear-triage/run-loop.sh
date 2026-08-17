#!/bin/bash
# Stage-0 triage loop — run this on the dedicated PC (or locally to test).
# Polls every INTERVAL seconds. Ctrl-C to stop.
#
# Required:  export LINEAR_API_KEY=lin_api_...
# Optional:  export GIT_PULL=1        (dedicated PC only — clean checkout, no local edits)
#            export CLAUDE_MODEL=sonnet   (cheaper on Max quota than opus)
#            export MAX_PER_RUN=3
#            export INTERVAL=300

set -euo pipefail
cd "$(dirname "$0")"

INTERVAL="${INTERVAL:-300}"

echo "Linear triage loop starting — polling every ${INTERVAL}s. Ctrl-C to stop."
while true; do
  node triage.mjs || echo "[$(date '+%H:%M:%S')] run failed — will retry next tick"
  sleep "$INTERVAL"
done
