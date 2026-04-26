#!/usr/bin/env bash
#
# Julia memory backup — one-time setup script
#
# Replayable bootstrap for the backup infrastructure. Run this on a fresh
# machine to recreate the staging clone, iCloud mirror dir, and log dir.
# Idempotent: safe to re-run — it only creates missing pieces.
#
# What this does NOT do:
#   - install the launchd plist (do that separately, see end of script)
#   - put google-service-account.json anywhere (restore that from 1Password)
#   - kick off a backup (run scripts/julia-memory-backup.sh for that)

set -euo pipefail

REPO="$HOME/.local/share/nanoclaw/julia-memory-repo"
REMOTE_URL="https://github.com/Qewler/Nanoclaw_Julia.git"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/!!! iCloud Dropbox/! Agentic Flows/Julia-Memory"
LOG_DIR="$HOME/Library/Logs/nanoclaw"
SECRETS_DIR="$HOME/.config/nanoclaw/secrets"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "==> Julia memory backup setup"

# 1. Secrets vault directory (the service account lives here)
if [ ! -d "$SECRETS_DIR" ]; then
  echo "  creating $SECRETS_DIR (mode 700)"
  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
else
  echo "  secrets vault exists: $SECRETS_DIR"
fi

if [ ! -f "$SECRETS_DIR/google-service-account.json" ]; then
  echo "  WARNING: $SECRETS_DIR/google-service-account.json missing"
  echo "  Restore it from 1Password or the GCP console before messaging Julia"
fi

# 2. Log directory for the backup script
mkdir -p "$LOG_DIR"
echo "  log dir: $LOG_DIR"

# 3. iCloud mirror directory
mkdir -p "$ICLOUD"
echo "  iCloud mirror: $ICLOUD"

# 4. Staging git clone + orphan branch
if [ ! -d "$REPO/.git" ]; then
  echo "  cloning $REMOTE_URL -> $REPO"
  mkdir -p "$(dirname "$REPO")"
  git clone "$REMOTE_URL" "$REPO"
  cd "$REPO"
  if git show-ref --verify --quiet refs/remotes/origin/julia-memory; then
    echo "  checking out existing julia-memory branch"
    git checkout julia-memory
  else
    echo "  creating new orphan julia-memory branch"
    git checkout --orphan julia-memory
    git rm -rf . >/dev/null 2>&1 || true
    cat > .gitignore <<'GITIGNORE'
google-service-account.json
*service-account*.json
*credentials*.json
.env
.env.*
*.pem
*.key
id_rsa*
id_ed25519*
node_modules/
logs/
*.log
.DS_Store
Thumbs.db
GITIGNORE
    git add .gitignore
    git -c user.email=noreply@qewler.local -c user.name="NanoClaw Julia Memory Backup" \
        commit -m "Bootstrap julia-memory orphan branch"
    git push -u origin julia-memory
  fi
  cd - >/dev/null
else
  echo "  staging clone exists: $REPO"
  cd "$REPO"
  git fetch origin julia-memory >/dev/null 2>&1 || true
  cd - >/dev/null
fi

echo ""
echo "==> Setup complete."
echo ""
echo "Next steps:"
echo "  1. (first time only) Put google-service-account.json in $SECRETS_DIR and chmod 600 it"
echo "  2. Run a manual backup to confirm it works:"
echo "       scripts/julia-memory-backup.sh"
echo "  3. Install the launchd schedule:"
echo "       launchctl load ~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist"
