#!/usr/bin/env bash
#
# Julia memory backup — runs every 12h via com.nanoclaw.julia-memory-backup.plist
#
# Flow per run:
#   1. Acquire a flock so concurrent runs can't collide
#   2. rsync source folders → staging git clone (with exclusions)
#   3. rsync source folders → iCloud mirror (same exclusions, no .git)
#   4. Secret-marker canary grep on the staging clone
#   5. git add / commit (skip if no changes) / push to orphan julia-memory branch
#
# Exit codes:
#   0  — success (either committed or no changes)
#   1  — rsync or git failure
#   2  — secret marker detected in staging clone (hard abort)
#   3  — another instance is already running

set -euo pipefail

# ------- config -------
SRC=/Users/qewler/Github/nanoclaw/groups
REPO="$HOME/.local/share/nanoclaw/julia-memory-repo"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/!!! iCloud Dropbox/! Agentic Flows/Julia-Memory"
FOLDERS=(telegram_main global discord_main)
LOG_DIR="$HOME/Library/Logs/nanoclaw"
LOCK_FILE="$HOME/.local/share/nanoclaw/.julia-memory-backup.lock"

# Put git, rsync, flock, python on PATH so launchd can find them
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$LOG_DIR"
# When run by launchd, stdout/stderr are already redirected by the plist's
# StandardOutPath / StandardErrorPath. When run interactively, output goes to
# the terminal — pipe to `tee -a ~/Library/Logs/nanoclaw/julia-memory-backup.log`
# if you want persistence for interactive runs.
echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) backup start ====="

# ------- single-instance lock -------
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { echo "another backup is already running, exiting"; exit 3; }
else
  # macOS ships without flock; fall back to a PID file check
  if [ -s "$LOCK_FILE" ] && kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
    echo "another backup is already running (pid $(cat "$LOCK_FILE")), exiting"
    exit 3
  fi
  echo $$ > "$LOCK_FILE"
  trap 'rm -f "$LOCK_FILE"' EXIT
fi

# ------- sanity: staging clone must exist -------
if [ ! -d "$REPO/.git" ]; then
  echo "ERROR: staging clone missing at $REPO — run scripts/julia-memory-setup.sh first"
  exit 1
fi

# Make sure we're on the julia-memory branch
cd "$REPO"
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "julia-memory" ]; then
  echo "ERROR: staging clone is on branch '$current_branch', expected 'julia-memory'"
  exit 1
fi
cd - >/dev/null

# ------- exclusions (applied to both destinations) -------
# Note: rsync --exclude patterns apply relative to each rsync source root.
RSYNC_EXCLUDES=(
  --exclude='node_modules/'
  --exclude='logs/'
  --exclude='*.log'
  --exclude='.DS_Store'
  --exclude='google-service-account.json'
  --exclude='*service-account*.json'
  --exclude='*credentials*.json'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='*.pem'
  --exclude='*.key'
  --exclude='id_rsa*'
  --exclude='id_ed25519*'
)

mkdir -p "$ICLOUD"

# ------- rsync each folder to both destinations -------
for folder in "${FOLDERS[@]}"; do
  if [ ! -d "$SRC/$folder" ]; then
    echo "skip: $SRC/$folder does not exist"
    continue
  fi
  echo "-> $folder"
  rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC/$folder/" "$REPO/$folder/"
  rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC/$folder/" "$ICLOUD/$folder/"
done

# ------- secret-marker canary -------
# Last line of defense if rsync's exclude list ever drifts. Uses length-aware
# patterns so that discussion mentions (e.g. "github_pat_11...") don't false-
# positive — the constraints match real token widths, not truncated references.
#   - PEM headers: distinctive literal, no length needed
#   - sk-ant-: Anthropic keys are 90+ chars; 20 is a safe floor
#   - ghp_: classic PATs are 36 chars
#   - github_pat_: fine-grained PATs are 82 chars; 20 is safe floor
echo "secret-marker canary scan..."
if grep -rIEl --binary-files=without-match \
     -e '-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----' \
     -e 'sk-ant-[A-Za-z0-9_-]{20,}' \
     -e 'ghp_[A-Za-z0-9]{30,}' \
     -e 'github_pat_[A-Za-z0-9_]{20,}' \
     "$REPO" 2>/dev/null | grep -v '/\.git/' | head -5; then
  echo "ABORT: secret marker detected in staging clone — refusing to commit" >&2
  echo "Investigate the files above, fix the rsync exclude list, then re-run." >&2
  exit 2
fi
echo "canary clean"

# ------- commit + push -------
cd "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "no changes to commit"
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) backup end (no-op) ====="
  exit 0
fi

commit_msg="snapshot $(date -u +%Y-%m-%dT%H:%MZ)"
git -c user.email=noreply@qewler.local -c user.name="NanoClaw Julia Memory Backup" \
    commit -m "$commit_msg"
git push origin julia-memory

echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) backup end (committed) ====="
