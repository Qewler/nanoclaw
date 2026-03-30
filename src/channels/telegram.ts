import https from 'https';
import { Api, Bot } from 'grammy';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.csv', '.xml', '.html', '.htm', '.log',
  '.yaml', '.yml', '.toml', '.py', '.js', '.ts', '.jsx', '.tsx',
  '.sh', '.bash', '.cfg', '.ini', '.conf', '.rst', '.sql', '.env',
  '.gitignore', '.dockerignore', '.editorconfig', '.css', '.scss',
  '.less', '.go', '.rs', '.rb', '.php', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.r', '.m', '.lua', '.pl',
]);

const MAX_DOCUMENT_SIZE = 102_400; // 100KB

function isTextFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

/**
 * Send a message with Telegram Markdown parse mode, falling back to plain text.
 * Claude's output naturally matches Telegram's Markdown v1 format:
 *   *bold*, _italic_, `code`, ```code blocks```, [links](url)
 */
async function sendTelegramMessage(
  api: { sendMessage: Api['sendMessage'] },
  chatId: string | number,
  text: string,
  options: { message_thread_id?: number } = {},
): Promise<void> {
  try {
    await api.sendMessage(chatId, text, {
      ...options,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    // Fallback: send as plain text if Markdown parsing fails
    logger.debug({ err }, 'Markdown send failed, falling back to plain text');
    await api.sendMessage(chatId, text, options);
  }
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  private async transcribeVoice(fileId: string): Promise<string | null> {
    try {
      logger.info({ fileId }, 'Voice transcription started');

      const envVars = readEnvFile(['OPENROUTER_API_KEY']);
      const apiKey =
        process.env.OPENROUTER_API_KEY || envVars.OPENROUTER_API_KEY;
      if (!apiKey) {
        logger.warn('OPENROUTER_API_KEY not set, skipping voice transcription');
        return null;
      }

      // Get file path from Telegram
      const fileInfo = (await fetch(
        `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
      ).then((r) => r.json())) as {
        ok: boolean;
        result?: { file_path: string };
      };
      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        logger.warn({ fileId }, 'Failed to get voice file info from Telegram');
        return null;
      }

      // Download audio bytes
      const audioBuffer = await fetch(
        `https://api.telegram.org/file/bot${this.botToken}/${fileInfo.result.file_path}`,
      ).then((r) => r.arrayBuffer());

      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      logger.info(
        { fileId, audioSize: base64Audio.length },
        'Audio downloaded, calling OpenRouter',
      );

      // Transcribe via OpenRouter Gemini 3.1 Flash Lite
      // Use data URI in image_url field — OpenRouter's OpenAI-compatible API
      // passes multimodal content (including audio) this way for Gemini models
      const response = (await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-3.1-flash-lite-preview',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:audio/ogg;base64,${base64Audio}`,
                    },
                  },
                  {
                    type: 'text',
                    text: 'Transcribe this voice message accurately. Return only the transcription, nothing else.',
                  },
                ],
              },
            ],
          }),
        },
      ).then((r) => r.json())) as Record<string, unknown>;

      // Check for API error responses
      if ('error' in response) {
        logger.error(
          { error: response.error, fileId },
          'OpenRouter API error',
        );
        return null;
      }

      const choices = response.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;
      const transcription =
        choices?.[0]?.message?.content?.trim() ?? null;
      if (transcription) {
        logger.info({ fileId }, 'Voice message transcribed successfully');
      } else {
        logger.warn(
          { fileId, response: JSON.stringify(response).slice(0, 500) },
          'OpenRouter returned no transcription',
        );
      }
      return transcription;
    } catch (err) {
      logger.error({ err, fileId }, 'Voice transcription failed');
      return null;
    }
  }

  private async describePhoto(fileId: string): Promise<string | null> {
    try {
      logger.info({ fileId }, 'Photo description started');

      const envVars = readEnvFile(['OPENROUTER_API_KEY']);
      const apiKey =
        process.env.OPENROUTER_API_KEY || envVars.OPENROUTER_API_KEY;
      if (!apiKey) {
        logger.warn('OPENROUTER_API_KEY not set, skipping photo description');
        return null;
      }

      // Get file path from Telegram
      const fileInfo = (await fetch(
        `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
      ).then((r) => r.json())) as {
        ok: boolean;
        result?: { file_path: string };
      };
      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        logger.warn({ fileId }, 'Failed to get photo file info from Telegram');
        return null;
      }

      // Download image bytes
      const imageBuffer = await fetch(
        `https://api.telegram.org/file/bot${this.botToken}/${fileInfo.result.file_path}`,
      ).then((r) => r.arrayBuffer());

      const base64Image = Buffer.from(imageBuffer).toString('base64');
      logger.info(
        { fileId, imageSize: base64Image.length },
        'Photo downloaded, calling OpenRouter for description',
      );

      // Describe via OpenRouter Gemini (same approach as voice transcription)
      const response = (await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-3.1-flash-lite-preview',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${base64Image}`,
                    },
                  },
                  {
                    type: 'text',
                    text: 'Describe this image in detail. Include all visible text, content, and context. Be thorough and accurate.',
                  },
                ],
              },
            ],
          }),
        },
      ).then((r) => r.json())) as Record<string, unknown>;

      if ('error' in response) {
        logger.error(
          { error: response.error, fileId },
          'OpenRouter API error during photo description',
        );
        return null;
      }

      const choices = response.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;
      const description =
        choices?.[0]?.message?.content?.trim() ?? null;
      if (description) {
        logger.info({ fileId }, 'Photo described successfully');
      } else {
        logger.warn(
          { fileId, response: JSON.stringify(response).slice(0, 500) },
          'OpenRouter returned no description',
        );
      }
      return description;
    } catch (err) {
      logger.error({ err, fileId }, 'Photo description failed');
      return null;
    }
  }

  private async downloadDocument(fileId: string, fileName: string): Promise<string | null> {
    try {
      logger.info({ fileId, fileName }, 'Document download started');

      const fileInfo = (await fetch(
        `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
      ).then((r) => r.json())) as {
        ok: boolean;
        result?: { file_path: string; file_size?: number };
      };
      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        logger.warn({ fileId }, 'Failed to get document file info from Telegram');
        return null;
      }

      // Check file size before downloading
      if (fileInfo.result.file_size && fileInfo.result.file_size > MAX_DOCUMENT_SIZE) {
        logger.info({ fileId, size: fileInfo.result.file_size }, 'Document too large to inline');
        return null;
      }

      const buffer = await fetch(
        `https://api.telegram.org/file/bot${this.botToken}/${fileInfo.result.file_path}`,
      ).then((r) => r.arrayBuffer());

      if (buffer.byteLength > MAX_DOCUMENT_SIZE) {
        logger.info({ fileId, size: buffer.byteLength }, 'Document too large to inline');
        return null;
      }

      const content = Buffer.from(buffer).toString('utf-8');
      logger.info({ fileId, fileName, size: content.length }, 'Document downloaded successfully');
      return content;
    } catch (err) {
      logger.error({ err, fileId, fileName }, 'Document download failed');
      return null;
    }
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken, {
      client: {
        baseFetchConfig: { agent: https.globalAgent, compress: true },
      },
    });

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    // Telegram bot commands handled above — skip them in the general handler
    // so they don't also get stored as messages. All other /commands flow through.
    const TELEGRAM_BOT_COMMANDS = new Set(['chatid', 'ping']);

    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) {
        const cmd = ctx.message.text.slice(1).split(/[\s@]/)[0].toLowerCase();
        if (TELEGRAM_BOT_COMMANDS.has(cmd)) return;
      }

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();
      const threadId = ctx.message.message_thread_id;

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
      // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
      // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Store chat metadata for discovery
      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'telegram',
        isGroup,
      );

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
        thread_id: threadId ? threadId.toString() : undefined,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages with placeholders so the agent knows something was sent
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        undefined,
        'telegram',
        isGroup,
      );
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    this.bot.on('message:photo', async (ctx) => {
      // Use the highest-resolution photo (last in array)
      const photos = ctx.message.photo;
      const fileId = photos?.[photos.length - 1]?.file_id;
      if (fileId) {
        const description = await this.describePhoto(fileId);
        if (description) {
          const chatJid = `tg:${ctx.chat.id}`;
          const group = this.opts.registeredGroups()[chatJid];
          if (!group) return;
          const timestamp = new Date(ctx.message.date * 1000).toISOString();
          const senderName =
            ctx.from?.first_name ||
            ctx.from?.username ||
            ctx.from?.id?.toString() ||
            'Unknown';
          const caption = ctx.message.caption ? `\nCaption: ${ctx.message.caption}` : '';
          const isGroup =
            ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            undefined,
            'telegram',
            isGroup,
          );
          this.opts.onMessage(chatJid, {
            id: ctx.message.message_id.toString(),
            chat_jid: chatJid,
            sender: ctx.from?.id?.toString() || '',
            sender_name: senderName,
            content: `[Photo]: ${description}${caption}`,
            timestamp,
            is_from_me: false,
          });
          return;
        }
      }
      storeNonText(ctx, '[Photo]');
    });
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', async (ctx) => {
      const fileId = ctx.message.voice?.file_id;
      if (fileId) {
        const transcription = await this.transcribeVoice(fileId);
        if (transcription) {
          const chatJid = `tg:${ctx.chat.id}`;
          const group = this.opts.registeredGroups()[chatJid];
          if (!group) return;
          const timestamp = new Date(ctx.message.date * 1000).toISOString();
          const senderName =
            ctx.from?.first_name ||
            ctx.from?.username ||
            ctx.from?.id?.toString() ||
            'Unknown';
          const isGroup =
            ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            undefined,
            'telegram',
            isGroup,
          );
          this.opts.onMessage(chatJid, {
            id: ctx.message.message_id.toString(),
            chat_jid: chatJid,
            sender: ctx.from?.id?.toString() || '',
            sender_name: senderName,
            content: `[Voice]: ${transcription}`,
            timestamp,
            is_from_me: false,
          });
          return;
        }
      }
      storeNonText(ctx, '[Voice message]');
    });
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[Audio]'));
    this.bot.on('message:document', async (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      const fileId = ctx.message.document?.file_id;

      // Try to download and inline text files
      if (fileId && isTextFile(name)) {
        const content = await this.downloadDocument(fileId, name);
        if (content) {
          const chatJid = `tg:${ctx.chat.id}`;
          const group = this.opts.registeredGroups()[chatJid];
          if (!group) return;
          const timestamp = new Date(ctx.message.date * 1000).toISOString();
          const senderName =
            ctx.from?.first_name ||
            ctx.from?.username ||
            ctx.from?.id?.toString() ||
            'Unknown';
          const caption = ctx.message.caption ? `\n${ctx.message.caption}` : '';
          const isGroup =
            ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            undefined,
            'telegram',
            isGroup,
          );
          this.opts.onMessage(chatJid, {
            id: ctx.message.message_id.toString(),
            chat_jid: chatJid,
            sender: ctx.from?.id?.toString() || '',
            sender_name: senderName,
            content: `[Document: ${name}]\n\`\`\`\n${content}\n\`\`\`${caption}`,
            timestamp,
            is_from_me: false,
          });
          return;
        }
      }

      // Fallback: store placeholder for binary/large/failed downloads
      storeNonText(ctx, `[Document: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    // Handle errors gracefully
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
          );
          resolve();
        },
      });
    });
  }

  async sendMessage(
    jid: string,
    text: string,
    threadId?: string,
  ): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');
      const options = threadId
        ? { message_thread_id: parseInt(threadId, 10) }
        : {};

      // Telegram has a 4096 character limit per message — split if needed
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await sendTelegramMessage(this.bot.api, numericId, text, options);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await sendTelegramMessage(
            this.bot.api,
            numericId,
            text.slice(i, i + MAX_LENGTH),
            options,
          );
        }
      }
      logger.info(
        { jid, length: text.length, threadId },
        'Telegram message sent',
      );
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}

registerChannel('telegram', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['TELEGRAM_BOT_TOKEN']);
  const token =
    process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Telegram: TELEGRAM_BOT_TOKEN not set');
    return null;
  }
  return new TelegramChannel(token, opts);
});
