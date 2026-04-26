# Channel customizations (apply AFTER channel skills are reinstalled)

These are user-authored modifications on top of the merged channel skills. v2 may already include some of them — search the v2 source before reapplying each.

---

## 2.1 Discord: thread on trigger reply

**Source commit:** `571147c`

**Intent:** When the bot replies to a Discord message that contained the trigger (`@Julia` or her name), spawn a 1-day auto-archive thread on the trigger message and post the reply inside it. Falls back to channel send if thread creation fails.

**Files (v1):** `src/channels/discord.ts`

**Apply notes:**

1. Add to the Discord channel class:
   ```typescript
   private pendingThreadSource = new Map<string, string>();  // channelId -> trigger msgId
   ```

2. In the inbound `messages.create` (or whatever v2 calls the inbound message handler), when `isTrigger` is true and the message is NOT already in a thread, record:
   ```typescript
   if (isTrigger && !message.channel.isThread?.()) {
     this.pendingThreadSource.set(channelId, msgId);
   }
   ```

3. In `sendMessage(jid, text)`, before sending, check the map and create a thread:
   ```typescript
   const triggerMsgId = this.pendingThreadSource.get(channelId);
   if (triggerMsgId) {
     const triggerMsg = await channel.messages.fetch(triggerMsgId);
     try {
       const thread = await triggerMsg.startThread({
         name: this.threadName(text),
         autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
       });
       await thread.send(text);
       this.pendingThreadSource.delete(channelId);
       return;
     } catch (err) {
       // fall through to plain channel send
     }
   }
   ```

**v2 watch-out:** In v2, `sendMessage` is called via the new `messaging_group_agents` routing. Verify the trigger detection flag (`isTrigger`) is still surfaced to the channel. If v2 introduced its own threading per-channel option, prefer that over reapplying this code.

---

## 2.2 Discord + Telegram: name-based trigger detection

**Source commit:** `571147c`

**Intent:** Trigger should fire not only on `TRIGGER_PATTERN` but also when the bot's name (e.g. `Julia`) appears with a word boundary, case-insensitive.

**Apply notes:**

In each channel's inbound handler, augment trigger detection:

```typescript
const botName = this.assistantName.split(/[_\s]/)[0].toLowerCase();
const nameRegex = new RegExp(`\\b${botName}\\b`, 'i');
const isTrigger = TRIGGER_PATTERN.test(text) || nameRegex.test(text);
```

**v2 watch-out:** v2's per-group config may already expose name-based triggering. Prefer v2's mechanism if present.

---

## 2.3 Telegram: bidirectional binary file exchange

**Source commit:** `5172d20`

**Intent:** Allow Julia to receive binary documents (PDF, DOCX, XLSX, ZIP, etc.) inbound from Telegram (download to `groups/<group>/uploads/`), and to send files outbound via an MCP `send_file` tool. Path-traversal protection on both sides.

**Files (v1):**
- `src/channels/telegram.ts` — inbound binary download
- `src/types.ts` — Channel interface gets `sendFile`
- `src/ipc.ts` — outbound `send_file` IPC handler
- `src/router.ts` — `routeFile()` dispatch

**Apply notes:**

### Inbound binary download (Telegram)

```typescript
const BINARY_DOCUMENT_EXTENSIONS = new Set([
  'docx', 'doc', 'pdf', 'xlsx', 'xls', 'pptx', 'ppt',
  'odt', 'ods', 'odp', 'zip', 'tar', 'gz', '7z',
]);
const MAX_BINARY_DOCUMENT_SIZE = 20 * 1024 * 1024;

async saveBinaryDocument(fileId: string, fileName: string, groupFolder: string): Promise<string | null> {
  const fileInfo = await this.bot.api.getFile(fileId);
  if (!fileInfo.file_path) return null;
  if (fileInfo.file_size && fileInfo.file_size > MAX_BINARY_DOCUMENT_SIZE) return null;

  const url = `https://api.telegram.org/file/bot${this.token}/${fileInfo.file_path}`;
  const resp = await fetch(url);
  const buffer = Buffer.from(await resp.arrayBuffer());

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadsDir = path.join(resolveGroupFolderPath(groupFolder), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const dest = path.join(uploadsDir, safeName);
  fs.writeFileSync(dest, buffer);
  return `/workspace/group/uploads/${safeName}`;  // container-side path
}
```

In the document message handler:
```typescript
if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
  const containerPath = await this.saveBinaryDocument(msg.document.file_id, fileName, groupFolder);
  if (containerPath) {
    contentParts.push(`[Document: ${fileName} saved to ${containerPath}]`);
  }
}
```

### Channel interface

```typescript
// src/types.ts (v2 equivalent — likely src/channels/types.ts or a similar location)
export interface Channel {
  // ... existing methods ...
  sendFile?(jid: string, filePath: string, fileName?: string, caption?: string): Promise<void>;
}
```

### Outbound IPC handler

```typescript
// In src/ipc.ts (or v2 equivalent), inside the IPC message dispatch:
} else if (data.type === 'send_file' && data.chatJid && data.filePath) {
  const targetGroup = registeredGroups[data.chatJid];
  const allowed = isMain || (targetGroup && targetGroup.folder === sourceGroup);
  if (!allowed) {
    logger.warn({ chatJid: data.chatJid, sourceGroup }, 'IPC send_file authorization denied');
    return;
  }
  const groupDir = resolveGroupFolderPath(sourceGroup);
  const hostPath = (data.filePath as string).replace(/^\/workspace\/group\//, groupDir + '/');
  const resolvedHost = path.resolve(hostPath);
  const resolvedGroup = path.resolve(groupDir);
  if (!resolvedHost.startsWith(resolvedGroup + '/')) {
    logger.warn({ filePath: data.filePath, sourceGroup }, 'IPC send_file path traversal blocked');
    return;
  }
  if (!fs.existsSync(resolvedHost)) {
    logger.warn({ filePath: resolvedHost }, 'IPC send_file: file not found');
    return;
  }
  await deps.sendFile(data.chatJid, resolvedHost, data.fileName, data.caption);
}
```

### Router

```typescript
// src/router.ts
export async function routeFile(jid: string, filePath: string, fileName?: string, caption?: string) {
  const channel = findChannelForJid(jid);
  if (!channel?.sendFile) {
    logger.warn({ jid }, 'No channel supports sendFile for this JID');
    return;
  }
  await channel.sendFile(jid, filePath, fileName, caption);
}
```

### Container-side MCP `send_file` tool

(See `03-container.md` — MCP tool wiring lives in agent-runner.)

**v2 watch-out:** v2 introduces `inbound.db` / `outbound.db` separation. The `send_file` IPC may now route through `outbound.db` rather than the file-watcher pattern. Search for the IPC dispatch site in v2 first:

```bash
grep -rn "type === 'send_message'" src/ container/
```

Reapply the `send_file` case in the same dispatch pattern v2 uses for `send_message`.

---

## 2.4 Telegram: OpenRouter voice transcription

**Source commit:** `571147c`

**Intent:** Transcribe Telegram voice messages via OpenRouter (`google/gemini-3.1-flash-lite-preview`) by base64-encoding audio into a data URI and submitting via the chat completions API. Required env: `OPENROUTER_API_KEY`.

This is what `/add-voice-transcription` (v2 skill) likely already does. **First check** what `/add-voice-transcription` ships before adding any custom code. If it covers this, just install the skill and skip this section.

If it does NOT cover OpenRouter (e.g. v2 ships only Whisper API), reapply:

```typescript
async transcribeVoice(fileId: string): Promise<string | null> {
  const fileInfo = await this.bot.api.getFile(fileId);
  if (!fileInfo.file_path) return null;
  const url = `https://api.telegram.org/file/bot${this.token}/${fileInfo.file_path}`;
  const audioBuffer = Buffer.from(await (await fetch(url)).arrayBuffer());
  const base64Audio = audioBuffer.toString('base64');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3.1-flash-lite-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:audio/ogg;base64,${base64Audio}` } },
          { type: 'text', text: 'Transcribe this voice message accurately. Return only the transcription, nothing else.' },
        ],
      }],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}
```

**v2 watch-out:** Voice transcription module likely lives in `src/transcription.ts`. Match v2's surface (the channel calls a transcription helper, not a method on itself).

---

## 2.5 WhatsApp: local Whisper.cpp fallback

**Source commit:** `1506a0c` (whatsapp/skill/local-whisper merge)

**Intent:** Transcribe WhatsApp voice notes using local `whisper-cli` instead of OpenRouter. Keeps voice data on-host.

This is exactly what `/use-local-whisper` (v2 skill) provides. **Just install the skill** — no custom code needed beyond what the skill ships.

If `/use-local-whisper` is not present in v2, reapply (excerpt; full code in v1's `src/transcription.ts`):

```typescript
async function transcribeWithWhisperCpp(audioBuffer: Buffer): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const id = `nanoclaw-voice-${Date.now()}`;
  const tmpOgg = path.join(tmpDir, `${id}.ogg`);
  const tmpWav = path.join(tmpDir, `${id}.wav`);
  try {
    fs.writeFileSync(tmpOgg, audioBuffer);
    await execFileAsync('ffmpeg', ['-i', tmpOgg, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', tmpWav], { timeout: 30_000 });
    const { stdout } = await execFileAsync(
      process.env.WHISPER_BIN || 'whisper-cli',
      ['-m', process.env.WHISPER_MODEL || './data/models/ggml-large-v3-turbo.bin', '-f', tmpWav, '--no-timestamps', '-nt'],
      { timeout: 60_000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  } finally {
    for (const f of [tmpOgg, tmpWav]) { try { fs.unlinkSync(f); } catch {} }
  }
}
```

Required env: `WHISPER_BIN`, `WHISPER_MODEL`. Dependency: `ffmpeg` on host (already installed; `brew install ffmpeg`).

---

## 2.6 SKIP: multi-channel group sharing

**Source commit:** `2fb4b72` (UNIQUE drop on `registered_groups.folder`)

**Intent (v1):** Allow Telegram + Discord to share one group folder for unified memory.

**Decision:** **Do NOT replay the schema mod.** v2 supports this natively via `session_mode: 'shared'` or `'agent-shared'` set per channel during `/manage-channels` or `/add-*` setup. After channels are reinstalled in Phase 3, configure shared sessions through v2's UI.

The user-confirmed shared-session combos to set up post-upgrade:
- Telegram main + Discord main → share Julia's session (if applicable; user to confirm during channel re-add)
