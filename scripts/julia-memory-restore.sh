#!/usr/bin/env bash
#
# Julia memory restore — one-command recovery from the julia-memory backup
#
# Usage:
#   scripts/julia-memory-restore.sh telegram_main    # restore one folder
#   scripts/julia-memory-restore.sh global
#   scripts/julia-memory-restore.sh discord_main
#   scripts/julia-memory-restore.sh all              # restore all three
#
# Behavior:
#   1. Clone the staging repo from origin if missing, otherwise fetch+reset
#   2. rsync the named folder(s) from the staging clone back to groups/<folder>/
#   3. Loud reminder that google-service-account.json is NOT in the backup
#   4. Suggest launchctl kickstart after restore so the new mounts pick up
#
# Safety: this OVERWRITES groups/<folder>/ with the contents from the backup.
# Any on-disk changes that haven't been backed up yet will be lost.
# If in doubt, rename groups/<folder>/ to <folder>.bak before running.

set -euo pipefail

SRC=/Users/qewler/Github/nanoclaw/groups
REPO="$HOME/.local/share/nanoclaw/julia-memory-repo"
REMOTE_URL="https://github.com/Qewler/Nanoclaw_Julia.git"
FOLDERS_ALL=(telegram_main global discord_main)

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

target="${1:-}"
if [ -z "$target" ]; then
  echo "usage: $0 <folder|all>"
  echo "  valid folders: ${FOLDERS_ALL[*]}"
  exit 1
fi

if [ "$target" = "all" ]; then
  folders=("${FOLDERS_ALL[@]}")
else
  match=0
  for f in "${FOLDERS_ALL[@]}"; do
    if [ "$f" = "$target" ]; then match=1; break; fi
  done
  if [ "$match" -eq 0 ]; then
    echo "ERROR: unknown folder '$target'"
    echo "  valid folders: ${FOLDERS_ALL[*]} all"
    exit 1
  fi
  folders=("$target")
fi

# ------- ensure staging clone is up to date -------
if [ ! -d "$REPO/.git" ]; then
  echo "staging clone missing — cloning fresh from $REMOTE_URL"
  mkdir -p "$(dirname "$REPO")"
  git clone "$REMOTE_URL" "$REPO"
  cd "$REPO"
  git checkout julia-memory
else
  cd "$REPO"
  git fetch origin julia-memory
  git checkout julia-memory
  git reset --hard origin/julia-memory
fi

# ------- restore each requested folder -------
for folder in "${folders[@]}"; do
  if [ ! -d "$REPO/$folder" ]; then
    echo "skip: $folder — not in backup"
    continue
  fi
  echo "-> restoring $folder from backup"
  mkdir -p "$SRC/$folder"
  rsync -a --delete \
    --exclude='google-service-account.json' \
    "$REPO/$folder/" "$SRC/$folder/"
done

cat <<'REMINDER'

========================================================================
IMPORTANT: google-service-account.json is NOT in the backup by design.

If this is a fresh restore (new machine, wiped ~/.config):
  1. Grab the Google Cloud service account JSON from your 1Password vault
     (or re-download from the GCP console)
  2. Save it to: ~/.config/nanoclaw/secrets/google-service-account.json
  3. chmod 600 the file
  4. Make sure ~/.config/nanoclaw/secrets has mode 700

Then restart nanoclaw to pick up the restored group folders:

  launchctl kickstart -k gui/$(id -u)/com.nanoclaw

========================================================================
REMINDER
