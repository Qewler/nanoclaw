/**
 * Print module — owner-gated `lp` invocation triggered by the container's
 * `print_file` MCP tool.
 *
 * Container writes a system action with kind='system', action='print_file'.
 * Host resolves the latest chat sender for the session, isOwner-gates,
 * validates the path is inside the agent group's folder, then shells out
 * to `lp` (CUPS) on the host.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { GROUPS_DIR } from '../../config.js';
import { getAgentGroup } from '../../db/agent-groups.js';
import { registerDeliveryAction } from '../../delivery.js';
import { log } from '../../log.js';
import { isOwner } from '../permissions/db/user-roles.js';
import type Database from 'better-sqlite3';
import type { Session } from '../../types.js';

const execFileAsync = promisify(execFile);

interface InboundChatRow {
  content: string;
}

function latestSenderId(inDb: Database.Database): string | null {
  const row = inDb
    .prepare("SELECT content FROM messages_in WHERE kind = 'chat' OR kind = 'chat-sdk' ORDER BY timestamp DESC LIMIT 1")
    .get() as InboundChatRow | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.content) as { senderId?: string; sender_id?: string };
    return parsed.senderId ?? parsed.sender_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Translate `/workspace/group/...` → host `groups/<folder>/...` and ensure the
 * resolved path is inside the agent group's folder. Returns null on traversal.
 */
function resolveGroupPath(containerPath: string, folder: string): string | null {
  const groupDir = path.resolve(GROUPS_DIR, folder);
  const stripped = containerPath.replace(/^\/workspace\/group\//, '').replace(/^\/workspace\/agent\//, '');
  const candidate = path.resolve(groupDir, stripped);
  if (!candidate.startsWith(groupDir + path.sep) && candidate !== groupDir) return null;
  return candidate;
}

function buildLpArgs(content: Record<string, unknown>, hostPath: string): string[] {
  const args: string[] = [];
  if (typeof content.printer === 'string' && content.printer) {
    args.push('-d', content.printer);
  }
  const copies = typeof content.copies === 'number' ? content.copies : 1;
  if (copies > 1) args.push('-n', String(copies));
  if (typeof content.pageRange === 'string' && content.pageRange) {
    args.push('-P', content.pageRange);
  }
  if (typeof content.duplex === 'string' && content.duplex) {
    args.push('-o', `sides=${content.duplex}`);
  }
  if (typeof content.paperSize === 'string' && content.paperSize) {
    args.push('-o', `media=${content.paperSize}`);
  }
  args.push(hostPath);
  return args;
}

async function handlePrintFile(
  content: Record<string, unknown>,
  session: Session,
  inDb: Database.Database,
): Promise<void> {
  const senderId = latestSenderId(inDb);
  if (!senderId || !isOwner(senderId)) {
    log.info('print_file dropped — not invoked by owner', {
      sessionId: session.id,
      senderId,
    });
    return;
  }

  const agentGroup = getAgentGroup(session.agent_group_id);
  if (!agentGroup) {
    log.warn('print_file: agent group missing', { sessionId: session.id });
    return;
  }

  const filePath = content.file_path as string;
  if (!filePath) {
    log.warn('print_file: missing file_path');
    return;
  }

  const hostPath = resolveGroupPath(filePath, agentGroup.folder);
  if (!hostPath) {
    log.warn('print_file: path traversal blocked', { filePath, folder: agentGroup.folder });
    return;
  }
  if (!fs.existsSync(hostPath)) {
    log.warn('print_file: file not found', { hostPath });
    return;
  }

  const args = buildLpArgs(content, hostPath);
  try {
    const { stdout } = await execFileAsync('lp', args, { timeout: 30_000 });
    log.info('print_file dispatched', { sessionId: session.id, hostPath, lp: stdout.trim() });
  } catch (e) {
    log.error('print_file: lp failed', { hostPath, err: e });
  }
}

registerDeliveryAction('print_file', handlePrintFile);
