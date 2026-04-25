# Container customizations

v2 ports the agent-runner from Node to Bun and may have moved skill loading paths and Dockerfile structure. Each section below names what the v1 layout did; verify the v2 equivalent before applying.

---

## 3.1 Brave Search MCP

**Source commit:** `96ff0a1`

**Intent:** Web search capability inside container via `@modelcontextprotocol/server-brave-search`.

**Dockerfile:**

```dockerfile
# Add to the global npm/bun install line
# v1:
RUN npm install -g agent-browser @anthropic-ai/claude-code @modelcontextprotocol/server-brave-search

# v2 (Bun): adapt to whatever v2's global install is. If v2 still uses npm in the Dockerfile, just append the package. If v2 uses bun:
RUN bun install -g @modelcontextprotocol/server-brave-search
```

**Agent-runner MCP server config** (in the `query()` options.mcpServers block):

```typescript
brave_search: {
  command: 'mcp-server-brave-search',
  args: [],
  env: {
    BRAVE_API_KEY: process.env.BRAVE_API_KEY || '',
  },
},
```

**Allowed tools:**

```typescript
'mcp__brave_search__*',
```

**Env var:** `BRAVE_API_KEY` — store in OneCLI vault, inject via vault proxy (do NOT put in `.env`).

---

## 3.2 Product Hunt MCP

**Source commit:** `716bb63`

**Intent:** Product Hunt API access via Python `product-hunt-mcp` (uv-installed).

**Dockerfile:**

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin \
       /root/.local/bin/uv tool install product-hunt-mcp
```

**Agent-runner MCP server config:**

```typescript
producthunt: {
  command: 'product-hunt-mcp',
  args: [],
  env: {
    PRODUCT_HUNT_TOKEN: process.env.PRODUCT_HUNT_TOKEN || 'vault-managed',
  },
},
```

**Allowed tools:** `'mcp__producthunt__*'`

**Env var:** `PRODUCT_HUNT_TOKEN` — OneCLI vault.

**v2 watch-out:** If v2 uses a multi-stage Dockerfile or moved system-package installs to `nanoclaw.sh` / installer-driven setup, adapt the apt+uv block to that pattern.

---

## 3.3 LibreOffice + send_file MCP tool

**Source commit:** `1f57a3d`

**Intent:** Container can convert DOC/DOCX/XLS/XLSX → PDF via headless LibreOffice; agent has an MCP `send_file` tool to push files outbound to channels.

**Dockerfile:**

```dockerfile
RUN apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*
```

**MCP `send_file` tool** (in `container/agent-runner/src/ipc-mcp-stdio.ts` — find the equivalent location in v2):

```typescript
server.tool(
  'send_file',
  'Send a file/document to the user or group via Telegram (or other channel that supports file sending).',
  {
    file_path: z.string().describe('Absolute path to the file inside the container'),
    file_name: z.string().optional().describe('Display name for the file'),
    caption: z.string().optional().describe('Optional caption/message'),
  },
  async (args) => {
    if (!fs.existsSync(args.file_path)) {
      return { content: [{ type: 'text', text: `File not found: ${args.file_path}` }], isError: true };
    }
    const data = {
      type: 'send_file',
      chatJid,
      filePath: args.file_path,
      fileName: args.file_name,
      caption: args.caption,
      groupFolder,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(MESSAGES_DIR, data);
    return { content: [{ type: 'text', text: `File queued: ${args.file_path}` }] };
  }
);
```

(Host-side IPC handler is in `02-channel-customizations.md` § 2.3.)

**v2 watch-out:** In v2, the IPC mechanism may use `outbound.db` writes instead of file-drops. Adapt `writeIpcFile` to whatever v2 calls (likely `writeOutbound` or similar). The `send_file` tool stays — just the persistence call changes.

---

## 3.4 Agent-runner model classifier (env-gated)

**Source commit:** `96ff0a1`

**Intent:** Route each query to opus / sonnet / haiku based on prompt complexity. **Env-gated** in v2 replay: only runs when `NANOCLAW_MODEL_ROUTER=1` is set per-group; otherwise v2's normal model config wins.

**File (v2 equivalent):** `container/agent-runner/src/index.ts` (likely renamed; agent-runner is now Bun)

**Function to insert** (verbatim from `96ff0a1`, with env-gate wrapped in `main()`):

```typescript
async function classifyModel(prompt: string): Promise<'opus' | 'sonnet' | 'haiku'> {
  const lowerPrompt = prompt.toLowerCase();
  const orchestrationSignals = [
    'in parallel', 'delegate to', 'spawn agent', 'use agents',
    'subagent', 'sub-agent', 'orchestrate', 'coordinate agents',
    'multiple agents', 'agent team', 'fan out',
  ];
  if (orchestrationSignals.some(s => lowerPrompt.includes(s))) {
    log('Orchestration keywords detected, forcing opus');
    return 'opus';
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Classify this task's required intelligence. Reply with EXACTLY one word — opus, sonnet, or haiku.

opus: complex reasoning, debugging, architecture, creative writing, multi-step analysis, planning, code review, ANY task requiring agent orchestration or delegation to subagents
sonnet: standard coding, explanations, moderate tasks, general conversation
haiku: quick lookups, status checks, simple Q&A, scanning/summarizing text, translations, reformatting

Task:
${prompt.slice(0, 1500)}`,
        }],
      }),
    });
    if (!response.ok) {
      log(`Model classification failed (HTTP ${response.status}), defaulting to sonnet`);
      return 'sonnet';
    }
    const data = await response.json() as { content?: Array<{ text?: string }> };
    const answer = data.content?.[0]?.text?.trim().toLowerCase();
    if (answer === 'opus' || answer === 'haiku') return answer;
    return 'sonnet';
  } catch (err) {
    log(`Model classification error: ${err instanceof Error ? err.message : String(err)}, defaulting to sonnet`);
    return 'sonnet';
  }
}
```

**Insertion in `main()`** (env-gated — this is the v2 change vs v1):

```typescript
let model: string | undefined;
if (process.env.NANOCLAW_MODEL_ROUTER === '1') {
  model = await classifyModel(prompt);
  log(`[model-router] Model selected: ${model}`);
}
// model is undefined when flag is off — v2 uses its own per-group provider config in that case
```

**`runQuery()` signature** — add `model?` parameter and thread through:

```typescript
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  // ... existing args ...
  resumeAt?: string,
  model?: string,   // ADD
): Promise<...>

// In query() options:
for await (const message of query({
  prompt: stream,
  options: {
    model,  // ADD — undefined means SDK uses v2 default
    // ... rest
  }
}))
```

**Per-group enablement:** Set `NANOCLAW_MODEL_ROUTER=1` in the per-group container environment (v2 should have a per-group env config; if not, set globally and gate via the env variable).

**v2 watch-out:** Bun's `fetch` is generally compatible but check error handling around streaming responses. The Haiku model ID (`claude-haiku-4-5-20251001`) is current as of April 2026 — pin a fresher model snapshot if v2 has bumped to a newer Haiku.

---

## 3.5 Print file MCP tool + IPC handler

**Source commit:** `2fb4b72`

**Intent:** Agent can print files via the host's `lp` / CUPS network printer. Main group only.

**MCP tool** (in agent-runner `ipc-mcp-stdio.ts` equivalent):

```typescript
server.tool(
  'print_file',
  "Print a file on the host's network printer. Main group only.",
  {
    file_path: z.string(),
    printer: z.string().optional(),
    copies: z.number().int().min(1).max(50).optional(),
    page_range: z.string().optional(),
    duplex: z.enum(['one-sided', 'two-sided-long-edge', 'two-sided-short-edge']).optional(),
    paper_size: z.string().optional(),
  },
  async (args) => {
    if (!isMain) {
      return { content: [{ type: 'text', text: 'Printing is only available from the main group.' }], isError: true };
    }
    if (!fs.existsSync(args.file_path)) {
      return { content: [{ type: 'text', text: `File not found: ${args.file_path}` }], isError: true };
    }
    writeIpcFile(MESSAGES_DIR, {
      type: 'print_file',
      chatJid,
      filePath: args.file_path,
      printer: args.printer,
      copies: args.copies,
      pageRange: args.page_range,
      duplex: args.duplex,
      paperSize: args.paper_size,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text', text: `Print job queued: ${args.file_path}` }] };
  }
);
```

**Host-side IPC handler** (in `src/ipc.ts` v2 equivalent):

```typescript
} else if (data.type === 'print_file' && data.filePath) {
  if (!isMain) {
    logger.warn({ sourceGroup }, 'Unauthorized IPC print_file attempt blocked');
    return;
  }
  const groupDir = resolveGroupFolderPath(sourceGroup);
  const hostPath = (data.filePath as string).replace(/^\/workspace\/group\//, groupDir + '/');
  const resolvedHost = path.resolve(hostPath);
  const resolvedGroup = path.resolve(groupDir);
  if (!resolvedHost.startsWith(resolvedGroup + '/')) {
    logger.warn({ filePath: data.filePath }, 'IPC print_file path traversal blocked');
    return;
  }
  if (!fs.existsSync(resolvedHost)) {
    await deps.sendMessage(data.chatJid as string, `Print failed: file not found ${resolvedHost}`);
    return;
  }

  const lpArgs: string[] = [];
  if (data.printer && /^[\w-]+$/.test(data.printer as string)) lpArgs.push('-d', data.printer as string);
  if (data.copies) lpArgs.push('-n', String(data.copies));
  if (data.pageRange) lpArgs.push('-P', data.pageRange as string);
  if (data.duplex && ['one-sided', 'two-sided-long-edge', 'two-sided-short-edge'].includes(data.duplex as string)) {
    lpArgs.push('-o', `sides=${data.duplex}`);
  }
  if (data.paperSize && /^[\w-]+$/.test(data.paperSize as string)) lpArgs.push('-o', `media=${data.paperSize}`);
  lpArgs.push('--', resolvedHost);

  try {
    const { stdout } = await execFileAsync('lp', lpArgs);
    await deps.sendMessage(data.chatJid as string, `Print job queued: ${path.basename(resolvedHost)} (${stdout.trim()})`);
  } catch (err) {
    await deps.sendMessage(data.chatJid as string, `Print failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

**`isMain` in v2:** v1 used a per-channel `isMain` flag. v2 retired this in favor of user-level roles (`owner` / `admin`). Replace `isMain` check with: "user attached to this messaging_group has owner role" — likely a method like `await isOwner(userId)` or `messagingGroup.owner.userId === currentUserId`. Find the equivalent in v2 and substitute.

---

## 3.6 Custom container skills (copy as-is)

**User-content directories to copy verbatim into the worktree:**

| Source (current main tree) | Destination (worktree) |
|---|---|
| `container/skills/gmail-batch/` | `container/skills/gmail-batch/` |
| `container/skills/home-assistant-manager/` | `container/skills/home-assistant-manager/` |
| `container/skills/printing/` | `container/skills/printing/` |

**If v2 moved the skill directory** (Bun runner may load skills from a different path):

```bash
# Check v2 skill load path
grep -rn "skills" container/agent-runner/src/ | head
```

If skills now load from e.g. `container/agent-skills/`, copy to that location instead. Skills are SKILL.md + supporting files (no compilation needed); the directory tree is portable as-is.

**Verify after copy:**

```bash
ls container/skills/  # or v2 equivalent
# Should include: gmail-batch, home-assistant-manager, printing
# Plus whatever v2 ships natively
```

---

## 3.7 Dockerfile consolidation

After 3.1–3.5, the v2 Dockerfile (or its installer equivalent) needs:

- `python3` + `uv` + `product-hunt-mcp` (3.2)
- `libreoffice-writer` `libreoffice-calc` `libreoffice-impress` (3.3)
- `@modelcontextprotocol/server-brave-search` (3.1)
- (already present in v2 trunk) chromium for agent-browser

If v2 split the Dockerfile into multi-stage or moved deps to `nanoclaw.sh` / a setup script, route each install to the right stage. Group the additions into ONE RUN block where possible to keep image layers minimal.
