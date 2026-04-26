---
name: gmail-batch
description: Bulk Gmail operations — archive, trash, label, mark-read hundreds of emails in one call. Use instead of MCP gmail tools when processing more than a few emails. Triggers on email cleanup, inbox tidy, unsubscribe, bulk delete, newsletter cleanup.
---

# Gmail Batch Operations

Use this skill for **any task involving more than ~5 emails**. It processes hundreds of emails in a single Bash call instead of individual MCP tool calls.

## When to use

- User asks to clean up, tidy, or organize their inbox
- Archiving/deleting newsletters, notifications, or old emails
- Marking bulk emails as read
- Any email task where you'd otherwise make >5 MCP tool calls

## The script

Located at: `/home/node/.claude/skills/gmail-batch/gmail-batch.mjs`

Run via Bash:
```bash
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs <command> [flags]
```

## Workflow

**Always start with `stats`** to understand the inbox before making changes:

```bash
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs stats
```

Then **use `--dry-run` first** before any destructive operation:

```bash
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs archive --from "newsletter@co.com" --dry-run
```

Then run without `--dry-run` to apply.

## Commands

| Command | What it does |
|---------|-------------|
| `stats` | Inbox overview: top senders, age distribution |
| `list` | Show messages matching criteria |
| `archive` | Remove from inbox (keeps in All Mail) |
| `trash` | Move to trash |
| `read` | Mark as read |
| `label` | Add/remove labels |

## Key flags

| Flag | Description |
|------|-------------|
| `--from <email>` | Filter by sender email |
| `--query <q>` | Gmail search query (same syntax as the Gmail search bar) |
| `--max <n>` | Max messages to process (default 100, cap 500) |
| `--dry-run` | Preview without applying changes |
| `--add <label>` | Label to add (for `label` command) |
| `--remove <label>` | Label to remove (for `label` command) |

## Gmail query syntax

The `--query` flag accepts standard Gmail search operators:

- `older_than:30d` — older than 30 days
- `newer_than:7d` — newer than 7 days
- `from:user@example.com` — from a specific sender
- `category:promotions` — Gmail category
- `is:unread` / `is:starred` / `has:attachment`
- `-is:starred` — exclude starred (negate with `-`)
- `label:INBOX` — has specific label
- Combine freely: `from:alerts@ci.com older_than:7d -is:starred`

## Examples

```bash
# Overview first
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs stats

# Archive all newsletters from a sender
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs archive --from "newsletter@company.com" --max 500

# Trash old promotional emails
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs trash --query "category:promotions older_than:60d" --max 500

# Archive everything older than 90 days (except starred)
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs archive --query "older_than:90d -is:starred" --max 500

# Mark old unread as read
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs read --query "is:unread older_than:30d" --max 500

# List what GitHub sends you
node /home/node/.claude/skills/gmail-batch/gmail-batch.mjs list --from "notifications@github.com" --max 20
```

## Important

- **Always `--dry-run` first** for archive/trash/label operations
- The script handles OAuth token refresh automatically
- Uses Gmail's `batchModify` API — processes up to 1000 emails per API call
- No MCP overhead — direct REST API calls via native fetch
