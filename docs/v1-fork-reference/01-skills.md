# Skills to install / reapply on v2

In v2, channels and most integrations live on the `channels` and `providers` branches. Each has a corresponding `/add-*` skill that handles the install. Run these in the worktree after `git worktree add`.

## Channels (must reinstall)

| v2 skill | Notes |
|---|---|
| `/add-telegram` | Primary channel — Julia. Hosts main-group permission. |
| `/add-whatsapp` | With local-whisper voice transcription path (see 02). |
| `/add-discord` | With threading on trigger reply (see 02). |
| `/add-gmail` | Gmail-as-channel + tool. Depends on OneCLI vault for OAuth. |

After running each `/add-*`, re-authenticate or restore credentials from OneCLI vault. The vault content already exists (was set up during v1 OneCLI migration) — no need to re-OAuth from scratch.

## Tools / agent capabilities

| v2 skill | Why |
|---|---|
| `/add-voice-transcription` | OpenRouter-based path used by Telegram. Pairs with Telegram skill. |
| `/use-local-whisper` | Local fallback for WhatsApp voice messages. Apply AFTER `/add-whatsapp`. |
| `/add-image-vision` | Image multimodal handling — Claude vision for inline image attachments. |
| `/add-pdf-reader` | PDF text extraction via `pdftotext` for binary inbound docs. |
| `/add-reactions` | Emoji reaction support in WhatsApp / Telegram. |

## Host-side / dev experience

| v2 skill | Why |
|---|---|
| `/add-macos-statusbar` | Existing menu-bar indicator for service state. |
| `/add-compact` | `/compact` slash for context compaction in long sessions. |

## Skills NOT to reinstall

These are ALREADY in the v2 trunk or the user has explicitly skipped:

- `/setup` — handled by v2's `bash nanoclaw.sh` installer flow
- `/init-onecli` — not needed; OneCLI already configured at `~/.onecli/config.json`
- `/convert-to-apple-container` — user is on Docker, no migration needed
- `/add-parallel`, `/add-emacs`, `/add-slack`, `/add-telegram-swarm` — never installed in v1, not requested
- `/add-ollama-tool`, `/add-codex`, `/add-opencode` — alt providers, not requested

## Custom skills (user-created — copy as-is)

| Path | Action |
|---|---|
| `container/skills/gmail-batch/` | Copy directory verbatim into worktree |
| `container/skills/home-assistant-manager/` | Copy directory verbatim into worktree |
| `container/skills/printing/` | Copy directory verbatim into worktree |

The `container/skills/` directory in v2 may be at a different path (the agent-runner is now Bun-based and may have repositioned the skill loading dir). Verify the v2 skill mount path before copying:

```bash
# Inside worktree:
grep -r "skills" container/agent-runner/src/index.ts | grep -i mount
```

If skill loading has moved, copy to the new path. Each SKILL.md content is preserved as-is.

## Reapply order

1. `/add-telegram` (primary channel — get Julia online first)
2. `/add-voice-transcription` (Telegram voice)
3. `/add-pdf-reader` (binary doc support)
4. `/add-image-vision` (image multimodal)
5. `/add-discord`
6. `/add-gmail`
7. `/add-whatsapp` (last — WhatsApp QR pairing is interactive)
8. `/use-local-whisper` (depends on `/add-whatsapp`)
9. `/add-reactions`
10. `/add-compact`
11. `/add-macos-statusbar`
12. Copy custom container skills
