/**
 * Telegram voice-message transcription via OpenRouter (Gemini Flash Lite).
 *
 * Hooks into the chat-sdk bridge's already-downloaded audio attachments
 * (base64 in `content.attachments[i].data`) and inlines the transcription
 * into the message text before it reaches the router.
 *
 * Requires OPENROUTER_API_KEY. Failures are logged and pass through silently
 * — a transcription outage shouldn't drop the original message.
 */
import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import type { InboundMessage } from './adapter.js';

interface AudioAttachment {
  type?: string;
  mimeType?: string;
  data?: string;
  name?: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TRANSCRIPTION_MODEL = 'google/gemini-3.1-flash-lite-preview';

async function postTranscription(base64Audio: string, mimeType: string, apiKey: string): Promise<string | null> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TRANSCRIPTION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Audio}` } },
            {
              type: 'text',
              text: 'Transcribe this voice message accurately. Return only the transcription, nothing else.',
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    log.warn('OpenRouter transcription non-OK', { status: res.status });
    return null;
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}

/**
 * Mutate the inbound message in place: transcribe each audio attachment and
 * append `[Voice transcription: ...]` markers to the message text. Pure side
 * effect on `content.text`.
 */
export async function transcribeAudioAttachments(message: InboundMessage): Promise<void> {
  if (message.kind !== 'chat-sdk' || !message.content || typeof message.content !== 'object') return;

  const env = readEnvFile(['OPENROUTER_API_KEY']);
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return;

  const content = message.content as Record<string, unknown>;
  const attachments = content.attachments as AudioAttachment[] | undefined;
  if (!Array.isArray(attachments)) return;

  const audio = attachments.filter((a) => a.type === 'audio' && typeof a.data === 'string');
  if (audio.length === 0) return;

  const transcriptions: string[] = [];
  for (const att of audio) {
    try {
      const mime = att.mimeType ?? 'audio/ogg';
      const text = await postTranscription(att.data!, mime, apiKey);
      if (text) transcriptions.push(text);
    } catch (err) {
      log.warn('Voice transcription failed', { err });
    }
  }

  if (transcriptions.length === 0) return;

  const existingText = typeof content.text === 'string' ? content.text : '';
  const marker = transcriptions.map((t) => `[Voice transcription: ${t}]`).join('\n');
  content.text = existingText ? `${existingText}\n${marker}` : marker;
}
