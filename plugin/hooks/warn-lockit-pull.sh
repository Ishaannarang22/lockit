#!/bin/bash
# Hook: warn on lockit pull (writes plaintext to disk)
# This hook detects when an agent invokes "lockit pull" and warns
# to prefer "lockit run" instead, which keeps secrets in memory only.

set -euo pipefail

# Extract the Bash command from stdin
COMMAND=$(jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Check if this is a lockit pull command
if echo "$COMMAND" | grep -qE '^\s*lockit\s+pull\b'; then
  # Emit a warning but allow it (exit 0, not 2)
  jq -n '{
    "continue": true,
    "suppressOutput": false,
    "systemMessage": "⚠️  lockit pull writes plaintext secrets to .env on disk. Prefer lockit run -- <cmd> instead, which injects into memory only and shreds on exit. Only use pull if you truly need an .env file for local testing, and remember to .gitignore it."
  }'
else
  # Not a pull command; pass through
  exit 0
fi
