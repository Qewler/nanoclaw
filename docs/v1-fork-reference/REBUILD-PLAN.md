# Plan: Rebuild 12 v1 customizations on v2 primitives

## Context

The v1→v2 migration is complete (2026-04-26). The active install is `~/Github/nanoclaw-v2/` (branch `feat/migrate-from-v1`). Per the `/migrate-from-v1` skill, 12 v1 customizations were intentionally **not translated** mechanically — they sit in `~/Github/nanoclaw-v2/docs/v1-fork-reference/` as intent reference, to be rebuilt on v2 primitives.

Exploration shows **5 of the 12 are already native in v2** (config-only, no code). 3 are container/Dockerfile additions. 4 require new code on v2 primitives. This plan groups them in three tiers so each can land as its own session without breaking the others.

**Outcome:** Julia regains every v1 capability, but on the v2 entity model + outbound.db pattern + Bun runner, with no v1 IPC file-queue code carried over.

## What v2 already does — config only (Tier 1)

These five need no new code. Just enable them and verify behavior. Do these first to clear the easy wins.

| # | Feature | What to do |
|---|---------|------------|
| 8 | **Discord thread-on-trigger reply** | Already wired. `src/channels/discord.ts` declares `supportsThreads: true`; `src/delivery.ts` honors `threadId` in deliveries. **Verify**: send a triggered message in a Discord channel, watch delivery log for `threadId` and a thread spawning. No code change. |
| 9 | **Name-based triggers** (e.g. "@Julia") | Already wired via `messaging_group_agents.engage_pattern`. Currently set per migration: telegram_main=`.` (always), discord wirings use `@Julia` / `@Julia_general`. To add name-trigger to a chat: `UPDATE messaging_group_agents SET engage_mode='pattern', engage_pattern='(?i)\\bjulia\\b' WHERE messaging_group_id='<mg-id>'`. Pattern engine: `shouldEngageAgent()` in `src/router.ts:340`. |
| 11 | **Multi-channel group sharing** | Native via `messaging_group_agents.session_mode`. Values: `shared` (default) / `per-thread` / `agent-shared`. To share Julia's session across Telegram + Discord: wire both messaging groups to the same `agent_group_id` with `session_mode='agent-shared'`. Use `/manage-channels` skill or DB update. Schema: `src/db/schema.ts:52`, routing: `src/router.ts:385`. |
| 12 | **Cross-chat send_message** (was `chat_jid`) | Native. `send_message` MCP tool in `container/agent-runner/src/mcp-tools/core.ts:98` accepts `to=<destination>` (destination name, not chat_jid). Destinations seeded in session DB by `src/modules/agent-to-agent/write-destinations.ts`. To enable Julia to message another chat from her main one, add a destination row keyed to that chat's messaging_group + agent_group. |
| 5 | **send_file MCP tool + outbound delivery** | Already wired. MCP tool: `container/agent-runner/src/mcp-tools/core.ts:134`. Outbound persistence: `container/agent-runner/src/db/messages-out.ts:writeMessageOut()`. Host delivery: `src/delivery.ts` reads `messages_out`. **Gap to verify**: each channel adapter's `deliver()` must handle file attachments. Telegram has it (used by `@chat-adapter/telegram`); confirm same for Discord. |

**Verification for Tier 1 (single session, ~30 min):**
- Send a Discord message containing "@Julia" — observe thread reply.
- Wire Telegram main + Discord boty-i-koty to `session_mode='agent-shared'`, send messages from both, confirm Julia's responses share context.
- From Telegram, ask Julia to "send the file /workspace/agent/test.txt" — confirm Telegram receives the document.

## Container additions — Dockerfile + per-group container.json (Tier 2)

These three add new capabilities that v2 doesn't ship by default. Each is one Dockerfile edit + one container.json edit + a rebuild.

### #1 — Brave Search MCP

**Files:**
- `container/Dockerfile` — extend existing global-install RUN line:
  ```dockerfile
  RUN bun install -g @modelcontextprotocol/server-brave-search
  # (Or apt-equivalent if v2 Dockerfile uses something other than bun -g)
  ```
- `groups/<folder>/container.json` — add to `mcpServers`:
  ```json
  "brave_search": {
    "command": "mcp-server-brave-search",
    "args": [],
    "env": { "BRAVE_API_KEY": "vault-managed" }
  }
  ```
- OneCLI vault — add `BRAVE_API_KEY` secret (same vault path mechanism that already works for Telegram/Discord/etc).

**Verify:** rebuild container, ask Julia to search the web for something, confirm she calls `mcp__brave_search__*` tool.

### #2 — Product Hunt MCP

**Files:**
- `container/Dockerfile` — Python+uv layer + `uv tool install product-hunt-mcp` (v2 may not yet have python; check Dockerfile, add if missing).
- `groups/<folder>/container.json` — `mcpServers.producthunt` block, command `product-hunt-mcp`, env `PRODUCT_HUNT_TOKEN`.
- OneCLI vault — add `PRODUCT_HUNT_TOKEN`.

### #3 — LibreOffice system deps

**Files:**
- `container/Dockerfile` — append to existing `apt-get install` block:
  ```dockerfile
  libreoffice-writer libreoffice-calc libreoffice-impress
  ```

LibreOffice itself is no-config — Julia uses it via Bash (`libreoffice --headless --convert-to pdf …`). Pairs with `send_file` (Tier 1 #5) for converted-document delivery.

**Verification for Tier 2 (single session, container rebuild ~5 min):**
1. Edit Dockerfile (add #1 + #2 + #3 in one RUN block to minimize layers).
2. `./container/build.sh` (image already 3GB, expect +200-400 MB for LibreOffice).
3. Add MCP servers to `groups/telegram_main/container.json`.
4. Restart `com.nanoclaw` service.
5. Round-trip test each of the three.

## New code on v2 primitives (Tier 3)

These four require actual implementation work. Each warrants its own session with build/test gates.

### #4 — Env-gated model classifier (`NANOCLAW_MODEL_ROUTER=1`)

**Where to hook:** `container/agent-runner/src/index.ts` — find where the provider is instantiated (around line 89) and where `runPollLoop()` runs queries. Wrap the `provider.query()` call with classifier logic gated on env var.

**Reuse:** Provider factory `container/agent-runner/src/providers/factory.ts:createProvider()`. Look for the per-message hook in the poll loop.

**Notes:**
- v2 already supports per-group provider config via `container.json:provider` — the user could just set `provider: 'claude-haiku'` per group instead of runtime classification. This is the "v2-native" alternative the explore agent flagged.
- If runtime routing is still wanted (e.g. orchestration keywords forcing Opus): build it as a small wrapper inside `providers/claude.ts` that reads `process.env.NANOCLAW_MODEL_ROUTER` and short-circuits the model field per query.

**Decision point at execution time:** Pick "v2-native per-group provider" OR "runtime classifier". Don't ship both.

**Verify:** spawn container with the env set, send Julia a one-line "what time is it?" → confirms haiku in logs; then "delegate research to subagents on X topic" → confirms opus.

### #6 — print_file MCP tool + owner-gated host handler

**Container side (new tool):**
- `container/agent-runner/src/mcp-tools/core.ts` — add `print_file` tool alongside existing `send_file` (line 134+). Args: `file_path`, `printer?`, `copies?`, `pageRange?`, `duplex?`, `paperSize?`. Writes to outbound.db via `writeMessageOut()` with kind `'print_file'`.
- `container/agent-runner/src/mcp-tools/core.instructions.md` — add a small section so the agent knows when to use it.

**Host side (new handler):**
- `src/delivery.ts` — extend the message-loop switch to handle `kind: 'print_file'`. Gate with `isOwner(senderUserId)` from `src/modules/permissions/db/user-roles.ts`. On owner pass: validate path is under `groups/<folder>/`, then `execFile('lp', [...])`.

**Reuse:**
- `isOwner()` at `src/modules/permissions/db/user-roles.ts`
- `writeMessageOut()` at `container/agent-runner/src/db/messages-out.ts`
- Path-traversal guard pattern from existing `send_file` host code (already in `src/delivery.ts` for file deliveries)

**Verify:** From Julia's main Telegram chat, "print my latest invoice" → lp gets called and Julia confirms. From a non-owner chat, same prompt → silently dropped or "owner only" reply.

### #7 — Bidirectional Telegram files (inbound binary download)

**Where to hook:** `src/channels/telegram.ts` (the host-side adapter shim) — augment the message-construction pipeline that processes incoming Telegram updates. When `update.message.document` is a binary doc (PDF, DOCX, XLSX, etc.):
1. Pull file_id, fetch file_path via Telegram getFile API.
2. Download to `groups/<folder>/uploads/<sanitized-name>`.
3. Inline a marker into the chat-sdk message content: `[Document: <name> saved to /workspace/group/uploads/<name>]`.

**Reuse:**
- Whatever path-resolution helper v2 uses for `groups/<folder>/` (search for `groupsDir` / `GROUPS_DIR` in `src/config.ts:GROUPS_DIR`).
- Set of binary extensions + max-size constants (~20 MB) — port from v1 verbatim, they're not v1-specific.
- Sanitization regex `[^a-zA-Z0-9._-]/g` → `_`.

**Note:** The outbound side (Julia sending files back) is Tier 1 #5 — already works. This is the inbound complement.

**Verify:** Send Julia a PDF in Telegram. She should be able to read it via Bash (`cat /workspace/group/uploads/<name>` or pdftotext).

### #10 — Voice transcription routes

**First step:** Search v2 for an existing transcription module:
```bash
grep -rn "transcrib\|whisper\|audio.*ogg" /Users/qewler/Github/nanoclaw-v2/src/ /Users/qewler/Github/nanoclaw-v2/.claude/skills/
```
If `/add-voice-transcription` skill exists or v2 ships transcription natively, install/configure it and stop. The v1 OpenRouter Gemini Flash Lite path may already be obsoleted.

**If not present:** Build as a per-channel hook in the adapter shim:
- `src/channels/telegram.ts` — when `update.message.voice` arrives, fetch the OGG, base64-encode, POST to OpenRouter `/chat/completions` with `google/gemini-3.1-flash-lite-preview` model, audio passed via image_url data URI. Inline result into message content. Env: `OPENROUTER_API_KEY`.
- For WhatsApp (after `/add-whatsapp` is run): build a local-Whisper.cpp helper. ffmpeg → 16kHz WAV → `whisper-cli -m <model> -nt`. Env: `WHISPER_BIN`, `WHISPER_MODEL`.

**Reuse:** Any v2 helper for downloading attachments from Telegram (look for `bot.api.getFile` usage in v2's chat-sdk-bridge or telegram adapter).

**Verify:** Send Julia a Telegram voice note. Confirm transcription text inlined in the prompt she receives.

## Suggested execution order

1. **Tier 1** (single session, mostly verification + a few DB updates) — clears 5/12 immediately, biggest "you-already-have-this" win.
2. **Tier 2 #3** (LibreOffice) — small, low risk, valuable.
3. **Tier 2 #1 + #2** (Brave + Product Hunt MCP) — single Dockerfile edit + container.json edits + vault keys.
4. **Tier 3 #6** (print_file) — clean v2 primitive (outbound.db + isOwner), no agent-runner runtime hooks.
5. **Tier 3 #7** (Telegram inbound files) — adapter shim only, isolated.
6. **Tier 3 #10** (voice transcription) — check skill first, build only if needed.
7. **Tier 3 #4** (model classifier) — last because it touches the inner provider loop. Consider whether per-group provider config is enough before writing code.

## Files to know

| Purpose | Path |
|---|---|
| Per-group container config schema | `src/container-config.ts` |
| Container Dockerfile | `container/Dockerfile` |
| Bun agent-runner entry | `container/agent-runner/src/index.ts` |
| Provider factory | `container/agent-runner/src/providers/factory.ts` |
| MCP tools (send_message, send_file) | `container/agent-runner/src/mcp-tools/core.ts` |
| Outbound write helper | `container/agent-runner/src/db/messages-out.ts` |
| Host outbound delivery | `src/delivery.ts` |
| Owner role helper | `src/modules/permissions/db/user-roles.ts` (`isOwner`) |
| Engage routing | `src/router.ts` (`shouldEngageAgent`) |
| Telegram adapter shim | `src/channels/telegram.ts` |
| Discord adapter shim | `src/channels/discord.ts` |
| Mount allowlist (already configured) | `~/.config/nanoclaw/mount-allowlist.json` |

## System-wide verification after each tier

After landing each feature:
```bash
cd /Users/qewler/Github/nanoclaw-v2
pnpm run build && pnpm test
# (if changed agent-runner) ./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```
Then live test the specific feature via Telegram or Discord.

## Rollback

Each feature is additive. To roll back any single feature:
- Tier 1: revert the DB row(s) modified.
- Tier 2: remove the Dockerfile lines, rebuild container; remove container.json mcpServers entry, redeploy.
- Tier 3: revert the source file(s) on the working branch (`git checkout <file>`), rebuild + restart.

If a tier breaks Julia's main flow: `git -C ~/Github/nanoclaw-v2 reset --hard <pre-feature-tag>` and rebuild. Always tag before each tier.
