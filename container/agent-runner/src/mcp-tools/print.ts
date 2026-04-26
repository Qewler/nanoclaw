/**
 * print_file MCP tool — fire-and-forget physical printing via the host's
 * `lp` command. Owner-gated on the host: non-owner sessions are dropped
 * silently. The tool itself just writes a system action to outbound.db.
 */
import { writeMessageOut } from '../db/messages-out.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools] ${msg}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

export const printFile: McpToolDefinition = {
  tool: {
    name: 'print_file',
    description:
      'Send a file to a physical printer on the host via `lp`. Owner-only — silently dropped for non-owner sessions. Path must be inside YOUR group folder (e.g. /workspace/group/...).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute container path of the file to print, must be under /workspace/group/',
        },
        printer: { type: 'string', description: 'Optional printer name (defaults to the host default printer)' },
        copies: { type: 'integer', description: 'Number of copies (default 1)' },
        pageRange: { type: 'string', description: 'Optional page range, e.g. "1-3" or "1,3,5"' },
        duplex: {
          type: 'string',
          enum: ['one-sided', 'two-sided-long-edge', 'two-sided-short-edge'],
          description: 'Duplex mode (default: one-sided)',
        },
        paperSize: { type: 'string', description: 'Optional paper size, e.g. "A4" or "Letter"' },
      },
      required: ['file_path'],
    },
  },
  async handler(args) {
    const filePath = args.file_path as string;
    if (!filePath) return err('file_path is required');

    const requestId = generateId();
    writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({
        action: 'print_file',
        file_path: filePath,
        printer: (args.printer as string) || null,
        copies: typeof args.copies === 'number' ? args.copies : 1,
        pageRange: (args.pageRange as string) || null,
        duplex: (args.duplex as string) || null,
        paperSize: (args.paperSize as string) || null,
      }),
    });

    log(`print_file: ${requestId} → ${filePath}`);
    return ok(`Print request submitted (${filePath}). Owner-gated on the host.`);
  },
};

registerTools([printFile]);
