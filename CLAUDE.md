# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Secrets / Credentials / Proxy (OneCLI)

API keys, secret keys, OAuth tokens, and auth credentials are managed by the OneCLI gateway — which handles secret injection into containers at request time, so no keys or tokens are ever passed to containers directly. Run `onecli --help`.

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/init-onecli` | Install OneCLI Agent Vault and migrate `.env` credentials to it |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Contributing

Before creating a PR, adding a skill, or preparing any contribution, you MUST read [CONTRIBUTING.md](CONTRIBUTING.md). It covers accepted change types, the four skill types and their guidelines, SKILL.md format rules, PR requirements, and the pre-submission checklist (searching for existing PRs/issues, testing, description format).

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

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
