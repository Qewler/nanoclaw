# Julia memory backup infrastructure

This is host-level infrastructure that exists OUTSIDE the NanoClaw repo (or in `scripts/`). Most of it survives the upgrade automatically because it's not in the repo. The repo-side pieces (`scripts/julia-memory-*.sh`) need explicit replay.

---

## 4.1 Backup scripts (in repo)

**Files:** `scripts/julia-memory-backup.sh`, `scripts/julia-memory-restore.sh`, `scripts/julia-memory-setup.sh`

**Apply:** Copy verbatim from the v1 main tree (or from the `pre-v2-snapshot-20260426-004007` tag) into the worktree's `scripts/` directory:

```bash
# In worktree, from $PROJECT_ROOT main tree:
cp $PROJECT_ROOT/scripts/julia-memory-backup.sh   ./scripts/
cp $PROJECT_ROOT/scripts/julia-memory-restore.sh  ./scripts/
cp $PROJECT_ROOT/scripts/julia-memory-setup.sh    ./scripts/
chmod +x ./scripts/julia-memory-*.sh
```

**No code changes needed** — these scripts only read `groups/`, push to a private repo, and rsync to iCloud. They don't depend on NanoClaw runtime.

**Configuration values inside the scripts** (verified at extraction time, do not modify):
- Backup folders: `groups/telegram_main/`, `groups/global/`, `groups/discord_main/`
- Git remote: `https://github.com/Qewler/Nanoclaw_Julia.git`, orphan branch `julia-memory`
- iCloud mirror: `~/Library/Mobile Documents/com~apple~CloudDocs/!!! iCloud Dropbox/! Agentic Flows/Julia-Memory/`
- Staging clone: `~/.local/share/nanoclaw/julia-memory-repo/`
- Logs: `~/Library/Logs/nanoclaw/julia-memory-backup.{log,err}`
- Rsync excludes: `node_modules/`, `logs/`, `*.log`, `.DS_Store`, `*service-account*.json`, `*credentials*.json`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`
- Secret canary regexes (length-aware to avoid false positives):
  - `-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----`
  - `sk-ant-[A-Za-z0-9_-]{20,}`
  - `ghp_[A-Za-z0-9]{30,}`
  - `github_pat_[A-Za-z0-9_]{20,}`

**v2 watch-out:** v2 introduced `inbound.db` / `outbound.db` per session. These DBs live inside `groups/<name>/` (or wherever v2 puts them). The backup script rsyncs the entire group folder, so they get backed up automatically. Verify after first backup that the dbs are included and not corrupting the canary scan (binary content shouldn't match the regexes).

---

## 4.2 Backup launchd plist (host)

**File:** `~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist`

**Status:** Already exists on host. Currently UNLOADED (paused for upgrade). Do NOT recreate; just reload after upgrade.

**Verify path** is still valid post-upgrade — the install path doesn't change (v2 lives at the same `/Users/qewler/Github/nanoclaw/`).

```bash
plutil -p ~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist | grep ProgramArguments
# Expect: /Users/qewler/Github/nanoclaw/scripts/julia-memory-backup.sh
```

**Reload after upgrade succeeds:**

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist
launchctl list | grep julia-memory
```

If install path changed (it shouldn't), edit the plist's `ProgramArguments[1]` and `WorkingDirectory` before reloading.

---

## 4.3 Service launchd plist (host)

**File:** `~/Library/LaunchAgents/com.nanoclaw.plist`

**Status:** Already exists on host. Currently UNLOADED (stopped for upgrade).

**v2 caveat:** v2 may install differently. Check the v2 README / `nanoclaw.sh` for the new entry-point. If v2 still emits `dist/index.js`, the plist's `ProgramArguments` still works. If v2 switched to running TypeScript directly via `tsx` or built differently, edit the plist:

```bash
plutil -p ~/Library/LaunchAgents/com.nanoclaw.plist | grep ProgramArguments
# Current: /opt/homebrew/bin/node + /Users/qewler/Github/nanoclaw/dist/index.js
# v2 may need: pnpm start, or a different built artifact path
```

**Reload after upgrade + post-build:**

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl list | grep com.nanoclaw
```

If the v2 install requires a different launcher, regenerate the plist via v2's `bash nanoclaw.sh` setup, which should detect launchd and emit a fresh plist.

---

## 4.4 Secret air-gap (off-repo)

**Host paths (untouched by upgrade):**

- `~/.config/nanoclaw/secrets/google-service-account.json` — mode `600`
- `~/.config/nanoclaw/secrets/` — mode `700`
- `~/.config/nanoclaw/mount-allowlist.json` — governs container mount permissions

**Container mount config:** v1 mounts `~/.config/nanoclaw/secrets` read-only into containers at `/workspace/extra/secrets/`.

**v2 may have a different mount mechanism.** v2's `OneCLI Agent Vault` is the credential proxy for everything except service-account JSONs (which Google APIs require as files, not env). Verify that v2 still allows mounting an extras directory, or migrate the service account into the OneCLI vault (preferred, if vault supports JSON file injection).

**Until verified, leave secrets in place** — `~/.config/nanoclaw/secrets/` is unchanged by the upgrade.

**v2 mount config check:**

```bash
# In worktree:
grep -rn "additionalMounts\|mount-allowlist\|workspace/extra" src/ container/
```

If the mount-allowlist mechanism survived to v2, just reuse `~/.config/nanoclaw/mount-allowlist.json` as-is. If v2 replaced it, port the allowlist entries to v2's new config schema.

---

## 4.5 Per-group CLAUDE.md files (untouched)

**Status:** Gitignored. Migration skill never reads or writes these. They sit on disk in:

- `groups/main/CLAUDE.md`
- `groups/global/CLAUDE.md`
- `groups/telegram_main/CLAUDE.md` ← Julia's primary memory (months of accumulated context)
- `groups/discord_main/CLAUDE.md`
- `groups/discord_boty-i-koty/CLAUDE.md`
- `groups/discord_wingman-personas/CLAUDE.md`

**Action:** Nothing. They're already on disk; v2 reads them at runtime; the upgrade doesn't touch `groups/`.

**v2 caveat:** v2 may compose CLAUDE.md from multiple sources (shared base + per-group fragment). If v2 expects a different per-group file naming convention (e.g. `CLAUDE.local.md` or `.claude-fragments/`), the existing `groups/<name>/CLAUDE.md` files may need to be moved/renamed. Check after first container spawn:

```bash
# Will the v2 container actually pick up groups/telegram_main/CLAUDE.md?
# Check the v2 claude-md-compose.ts for the merge logic
grep -rn "CLAUDE.md\|CLAUDE.local.md\|.claude-fragments" src/ container/
```

If v2 needs renaming, rename the file IN PLACE (don't copy — keeps the user's data intact):

```bash
mv groups/telegram_main/CLAUDE.md groups/telegram_main/CLAUDE.local.md
# (Repeat for each group, ONLY if v2 requires the rename)
```

---

## 4.6 Rollback assurance

If the upgrade fails or memory looks corrupted post-upgrade:

```bash
# Restore one group:
scripts/julia-memory-restore.sh telegram_main

# Or all backed-up groups:
scripts/julia-memory-restore.sh all
```

The backup branch `julia-memory` on `Qewler/Nanoclaw_Julia` is the source of truth. The iCloud mirror is the secondary recovery surface. Both were freshly synced as the last step of Phase 0.
