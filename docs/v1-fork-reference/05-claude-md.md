# Project CLAUDE.md custom sections

v2 ships its own `CLAUDE.md` at the repo root. The user's v1 `CLAUDE.md` has two custom sections that don't exist upstream.

**Action:** After replacing `CLAUDE.md` with v2's version, **append** these two sections at the bottom (preserving v2's content above).

---

## Section 1: Container Build Cache

```markdown
## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
```

**Where:** Append before "Julia Memory Backup" section. Include the H2 heading.

---

## Section 2: Julia Memory Backup

```markdown
## Julia Memory Backup

Julia's memory (the consolidated `groups/telegram_main/` folder plus `groups/global/` and the frozen `groups/discord_main/`) is version-controlled via an orphan `julia-memory` branch on the `Qewler/Nanoclaw_Julia` private repo, with a parallel plain-file mirror in iCloud Drive.

- **Schedule**: every 12 h via `~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist`
- **Git destination**: `https://github.com/Qewler/Nanoclaw_Julia/tree/julia-memory` (orphan branch, never merges into `main`)
- **iCloud mirror**: `~/Library/Mobile Documents/com~apple~CloudDocs/!!! iCloud Dropbox/! Agentic Flows/Julia-Memory/`
- **Staging clone**: `~/.local/share/nanoclaw/julia-memory-repo/`
- **Logs**: `~/Library/Logs/nanoclaw/julia-memory-backup.{log,err}`

### Secret air-gap

`google-service-account.json` is **not in the backup**. It lives at `~/.config/nanoclaw/secrets/` on the host and is mounted back into Julia's container read-only at `/workspace/extra/secrets/google-service-account.json`. The backup script also runs a length-aware secret-marker canary (`-----BEGIN ... PRIVATE KEY-----`, `ghp_`, `github_pat_`, `sk-ant-`) and aborts the commit if anything matches — last line of defense if the rsync exclude list ever drifts.

### Manual operations

```bash
scripts/julia-memory-backup.sh                    # run once now
scripts/julia-memory-restore.sh telegram_main     # restore one folder from backup
scripts/julia-memory-restore.sh all               # restore all three
scripts/julia-memory-setup.sh                     # (re)bootstrap the staging clone/iCloud dir

# pause / resume the schedule
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.julia-memory-backup.plist
launchctl kickstart gui/$(id -u)/com.nanoclaw.julia-memory-backup  # force an immediate run
```

### macOS TCC requirement

launchd-spawned processes need explicit Full Disk Access to write to `~/Library/Mobile Documents/` (the iCloud path). Grant it to `/bin/bash` via **System Settings → Privacy & Security → Full Disk Access** — one-time setup.
```

**Where:** Append at the very end of v2's CLAUDE.md (after any v2 troubleshooting section).

---

## v2 watch-out

If v2's CLAUDE.md introduces a "## Troubleshooting" or "## Container" section that already covers similar ground (build cache invalidation), merge our content into v2's section rather than duplicating. The Julia Memory Backup section is uniquely user-content — it should always be appended verbatim.

If v2 switched to a different file (e.g. `AGENTS.md`, `INSTRUCTIONS.md`), append to the v2 file at the same priority level.
