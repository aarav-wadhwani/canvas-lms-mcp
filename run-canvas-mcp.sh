#!/bin/bash
# Launches the Canvas MCP server (stdio) for Claude.
#
# - The Canvas API token is read from the macOS Keychain at launch; it is
#   never stored in a file or in Claude's config.
# - Deno permissions are locked down: network ONLY to the Canvas host and
#   Canvas's file-storage hosts, file reads ONLY inside this folder and the
#   download folder, file writes ONLY inside the download folder, only the
#   Canvas env vars, and no dependency downloads at runtime
#   (--cached-only + --frozen lockfile).
#
# One-time token setup (run yourself; you'll be prompted to paste the token):
#   security add-generic-password -a "$USER" -s canvas-mcp-token -w
set -euo pipefail

# Your school's Canvas host (override with the CANVAS_HOST env var)
CANVAS_HOST="${CANVAS_HOST:-canvas.uw.edu}"
# Hosts Canvas redirects file downloads through (the token is never sent to these)
FILE_HOSTS="*.canvas-user-content.com,*.inscloudgate.net"
# Where save_canvas_file writes. Kept outside ~/Downloads, ~/Desktop and
# ~/Documents because macOS privacy protection blocks the Claude app there.
DOWNLOAD_DIR="$HOME/CanvasFiles"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! CANVAS_API_TOKEN="$(security find-generic-password -a "$USER" -s canvas-mcp-token -w 2>/dev/null)"; then
  echo "Canvas token not found in Keychain. Run:" >&2
  echo "  security add-generic-password -a \"\$USER\" -s canvas-mcp-token -w" >&2
  exit 1
fi
export CANVAS_API_TOKEN
export CANVAS_BASE_URL="https://${CANVAS_HOST}"
export CANVAS_STUDENT_ID="${CANVAS_STUDENT_ID:-self}"
export CANVAS_DOWNLOAD_DIR="$DOWNLOAD_DIR"
mkdir -p "$DOWNLOAD_DIR"

exec /opt/homebrew/bin/deno run \
  --cached-only --frozen \
  --allow-net="${CANVAS_HOST},${FILE_HOSTS}" \
  --allow-read="${DIR},${DOWNLOAD_DIR}" \
  --allow-write="${DOWNLOAD_DIR}" \
  --allow-env=CANVAS_API_TOKEN,CANVAS_BASE_URL,CANVAS_STUDENT_ID,CANVAS_DOWNLOAD_DIR \
  --no-prompt \
  agent.ts
