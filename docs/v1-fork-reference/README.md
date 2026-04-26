# v1 fork reference

Customizations from `/Users/qewler/Github/nanoclaw` (v1, last commit `d2fd7c5`, snapshot tag `pre-v2-snapshot-20260426-004007`).

Per `/migrate-from-v1` guidance: **do not mechanically translate** `src/*` or `container/agent-runner/src/*` customizations to v2. The architectures are too different (v1's single Node process + IPC file queue → v2's split inbound/outbound session DBs + entity model). Use this directory as intent reference and rebuild features on v2 primitives.

## Already applied to v2 (portable)

| Item | v2 location |
|---|---|
| Custom container skills (`gmail-batch`, `home-assistant-manager`, `printing`) | `container/skills/` |
| Julia memory backup scripts | `scripts/julia-memory-{backup,restore,setup}.sh` |
| `discord_main` group folder (Julia's frozen Discord context) | `groups/discord_main/CLAUDE.local.md` |

## To rebuild on v2 primitives (NOT translated)

Each of these is captured in detail with intent + v1 code excerpts in the section files of this directory. The "v2 watch-out" notes in each section already point at where the equivalent v2 hook lives.

| Customization | v1 source | Reference file | v2 path forward |
|---|---|---|---|
| Discord thread-on-trigger reply | `src/channels/discord.ts` (commit `571147c`) | `02-channel-customizations.md` § 2.1 | Build on v2's Chat SDK Discord adapter; use its native thread support if present, else add via the agent-group hook layer. |
| Name-based trigger detection | `src/channels/{discord,telegram}.ts` (`571147c`) | `02-channel-customizations.md` § 2.2 | v2 supports `engage_pattern` per messaging group — set per-group. |
| Telegram bidirectional files (download + send_file MCP) | `src/channels/telegram.ts`, `src/ipc.ts`, `src/types.ts`, `src/router.ts` (`5172d20`) | `02-channel-customizations.md` § 2.3 | v2 splits IPC into inbound.db / outbound.db. Add as a separate adapter capability or via the chat-sdk-bridge. |
| Telegram voice transcription via OpenRouter | `src/channels/telegram.ts`, `src/transcription.ts` (`571147c`) | `02-channel-customizations.md` § 2.4 | Likely covered natively by v2's Telegram skill or as a transcription module — verify before reapplying. |
| WhatsApp local-whisper voice fallback | `src/transcription.ts` (`1506a0c`) | `02-channel-customizations.md` § 2.5 | Add via `/add-whatsapp` plus `/use-local-whisper` once user re-pairs WhatsApp. |
| Multi-channel group sharing (UNIQUE drop) | `src/db.ts` (`2fb4b72`) | `02-channel-customizations.md` § 2.6 | **Skipped intentionally.** v2's `session_mode='shared'` / `'agent-shared'` is the native pattern. Configure during channel setup. |
| Brave Search MCP | `container/Dockerfile`, `container/agent-runner/src/index.ts` (`96ff0a1`) | `03-container.md` § 3.1 | Add to v2 Dockerfile + agent-runner's MCP server config block. v2 agent-runner is on Bun — verify install command. |
| Product Hunt MCP | `container/Dockerfile`, `container/agent-runner/src/index.ts` (`716bb63`) | `03-container.md` § 3.2 | Same as Brave: Dockerfile + MCP block. |
| LibreOffice + send_file MCP tool | `container/Dockerfile`, `container/agent-runner/src/ipc-mcp-stdio.ts` (`1f57a3d`) | `03-container.md` § 3.3 | LibreOffice is OS deps. send_file MCP is part of the bidirectional-file feature — see §2.3. |
| Agent-runner model classifier (env-gated) | `container/agent-runner/src/index.ts` (`96ff0a1`) | `03-container.md` § 3.4 | v2 has per-group provider config. Use that instead of a runtime classifier; or implement the classifier as a v2 module if the provider config doesn't support runtime selection. |
| print_file MCP tool + IPC handler | `container/agent-runner/src/ipc-mcp-stdio.ts`, `src/ipc.ts` (`2fb4b72`) | `03-container.md` § 3.5 | Build on v2's outbound.db pattern instead of file-drop IPC. |
| Cross-chat `send_message` (`chat_jid` param) | `container/agent-runner/src/ipc-mcp-stdio.ts` (`5365cb4`) | `02-channel-customizations.md` § 2.3 | Owner role is the v2 equivalent of v1's `isMain` — owners can target any messaging group via the routing layer. |

## Notes from migration

From `logs/setup-migration/handoff.json`:

- **`groups/telegram_main/CLAUDE.local.md`** references v1-specific infrastructure (IPC file queue, central DB path). Julia will gradually update her own memory to match v2 reality. No urgent action — leave it.
- **WhatsApp** wasn't auto-installed (no v1 WhatsApp registered_groups entries). Run `/add-whatsapp` if needed.
- **`channel_name` column** absent from v1 DB — patched `setup/migrate-v1/db.ts` locally to fall back to jid-prefix detection (uncommitted change in v2 sibling clone).
