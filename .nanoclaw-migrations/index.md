# NanoClaw Migration Guide — v1 → v2

**Generated:** 2026-04-26 (UTC)
**Base (last sync with upstream):** `2983946`
**HEAD at generation:** `96ff0a1`
**Upstream HEAD:** `0bc082a` (qwibitai/nanoclaw, main, v2.0.13)
**Tier:** 3 (large fork: 4 channel skills + 7+ feature commits + custom container skills + Julia memory infra)

---

## Why this migration

NanoClaw v2 is an architectural rewrite, not an incremental release:

- **Entity model** — users, roles, messaging_groups, agent_groups, messaging_group_agents replace the old `isMain` channel-level model
- **Two-DB session split** — `inbound.db` (host writes, container reads) + `outbound.db` (container writes, host reads)
- **Channels moved to `channels` branch** — Discord, Telegram, WhatsApp, Gmail, etc. install per-fork via `/add-*`
- **Providers moved to `providers` branch** — OpenCode, Codex, Ollama install via `/add-*`
- **Shared-source agent-runner** — per-group `agent-runner-src/` overlays gone; per-group customization flows through composed CLAUDE.md
- **Agent-runner runtime: Node → Bun**
- **Install flow replaced** — `bash nanoclaw.sh` is the new default
- **OneCLI Agent Vault is the sole credential path** (user is already on it: `~/.onecli/config.json` present, Docker runtime)
- **Apple Container removed from default setup** (n/a — user is on Docker)

A merge-based update across this boundary (`/update-nanoclaw`) would produce dozens of unresolvable conflicts. The migration approach: replay user customizations on a clean v2 base in a worktree, validate, then swap.

---

## What does NOT get touched

These are protected by either gitignore or explicit migration-skill guarantees:

- `groups/` (Julia memory + every per-group CLAUDE.md + conversation state) — gitignored as `groups/*`
- `.env`, `.env.*`, `store/`, `data/`, `logs/`, `nanoclaw.db` — gitignored
- `~/.config/nanoclaw/secrets/google-service-account.json` — outside repo, mounted read-only into containers
- `~/.local/share/nanoclaw/julia-memory-repo/` (staging clone) — outside repo
- `~/Library/Mobile Documents/com~apple~CloudDocs/.../Julia-Memory/` (iCloud mirror) — outside repo
- Pre-upgrade git state — backup tag `pre-v2-snapshot-20260426-004007` already created

---

## Migration plan (Tier 3, ordered)

Apply in this order during Phase 2 (Upgrade) inside the worktree:

1. **Skills + channels** — install via `/add-*` (sourced from v2 `channels` branch). See `01-skills.md`.
2. **Channel customizations** — bidirectional Telegram files, voice transcription, Discord threading, WhatsApp+local-whisper. See `02-channel-customizations.md`.
3. **Container customizations** — Brave Search MCP, Product Hunt MCP, LibreOffice + send_file, Dockerfile changes, env-gated model classifier. See `03-container.md`.
4. **Custom container skills** — copy `gmail-batch/`, `home-assistant-manager/`, `printing/` from main tree as user content. See `03-container.md`.
5. **Julia memory infra** — scripts, launchd plists, secret air-gap. See `04-julia-memory.md`.
6. **CLAUDE.md custom sections** — Container Build Cache + Julia Memory Backup. See `05-claude-md.md`.

---

## Open decisions (already resolved with user)

| Decision | Choice |
|---|---|
| Multi-channel group sharing (v1 dropped UNIQUE on `registered_groups.folder`) | **Skip** — use v2 native `session_mode: 'shared' / 'agent-shared'` during channel re-add |
| Model classifier replay | **Env-gated** (`NANOCLAW_MODEL_ROUTER=1`) — only active per-group when flag set |
| Custom container skills to keep | **All three:** `gmail-batch`, `home-assistant-manager`, `printing` |

---

## Open decisions (resolve during replay)

| Decision | When |
|---|---|
| Where the v2 agent-runner has the right hook to insert `classifyModel()` (Bun, may differ from v1's Node loop) | When applying `03-container.md` |
| Whether IPC handlers for `send_file` / `print_file` already exist in v2 (some user features may have landed upstream during the 556-commit gap) | Search v2 source first; only add what's missing |
| How v2's `/add-telegram` / `/add-discord` / `/add-gmail` handle inbound binary documents and voice — likely already covered, but verify before re-adding the v1 binary-download path | When applying `02-channel-customizations.md` |

---

## Skill interactions to watch

- **Telegram + voice transcription** — v1 user had OpenRouter (Gemini Flash Lite) for Telegram and local Whisper.cpp fallback. v2 may ship one and not the other. Keep OpenRouter path for Telegram, local Whisper for WhatsApp; surface conflict if both branches introduce the same module.
- **Brave + Product Hunt + LibreOffice MCP** — all three add `npm install -g` lines to the Dockerfile RUN block. Check that the v2 Dockerfile RUN line is still where to add them; if v2 moved system deps to `nanoclaw.sh` or a multi-stage build, adapt.
- **`gmail-batch` skill + `/add-gmail` channel** — gmail-batch is a container-side bulk-ops helper; `/add-gmail` is the channel. They don't conflict but both depend on Gmail OAuth credentials being in OneCLI vault.

---

## File index

- `01-skills.md` — list of skills to install + reapply
- `02-channel-customizations.md` — channel feature replays
- `03-container.md` — Dockerfile, MCPs, agent-runner, container skills
- `04-julia-memory.md` — backup scripts, plists, secret air-gap
- `05-claude-md.md` — project-root CLAUDE.md custom sections

---

## Phase 2 readiness gate

Before the worktree upgrade starts:

- [x] Working tree clean (commit `96ff0a1`)
- [x] Service stopped (`com.nanoclaw.plist` unloaded)
- [x] Julia 12h backup paused (`com.nanoclaw.julia-memory-backup.plist` unloaded)
- [x] Fresh Julia backup ran (canary clean, no drift)
- [x] Snapshot tag + branch created: `pre-v2-snapshot-20260426-004007`
- [x] OneCLI confirmed installed (Docker runtime, no Apple Container migration needed)
