#!/usr/bin/env node
/**
 * gmail-batch.mjs — Bulk Gmail operations via REST API.
 * Runs inside the NanoClaw container. Uses mounted OAuth credentials.
 * No npm dependencies — uses native fetch.
 *
 * Usage:
 *   node gmail-batch.mjs stats
 *   node gmail-batch.mjs list --from "newsletter@example.com" --max 50
 *   node gmail-batch.mjs list --query "is:unread older_than:30d" --max 100
 *   node gmail-batch.mjs archive --from "newsletter@example.com"
 *   node gmail-batch.mjs archive --query "older_than:90d -is:starred"
 *   node gmail-batch.mjs trash --from "spam@example.com"
 *   node gmail-batch.mjs trash --query "from:noreply older_than:60d"
 *   node gmail-batch.mjs label --add "ToReview" --query "is:unread from:boss@co.com"
 *   node gmail-batch.mjs label --remove "INBOX" --query "from:alerts@ci.com older_than:7d"
 *   node gmail-batch.mjs read --query "is:unread from:newsletter@co.com"
 *
 * Flags:
 *   --from <email>     Filter by sender email (combined with --query if both set)
 *   --query <q>        Raw Gmail search query (https://support.google.com/mail/answer/7190)
 *   --max <n>          Max messages to process (default: 100, cap: 500)
 *   --dry-run          Show what would happen without making changes
 *   --cred-dir <path>  Credentials directory (default: auto-detect)
 */

import fs from 'fs';
import path from 'path';

const API = 'https://gmail.googleapis.com';

// --- Auth ---

function findCredDir() {
  const dirs = [
    '/home/node/.gmail-mcp-qewler',
    '/home/node/.gmail-mcp',
    path.join(process.env.HOME || '/home/node', '.gmail-mcp-qewler'),
    path.join(process.env.HOME || '/home/node', '.gmail-mcp'),
  ];
  for (const d of dirs) {
    if (
      fs.existsSync(path.join(d, 'gcp-oauth.keys.json')) &&
      fs.existsSync(path.join(d, 'credentials.json'))
    ) return d;
  }
  return null;
}

async function getAccessToken(credDir) {
  const keys = JSON.parse(fs.readFileSync(path.join(credDir, 'gcp-oauth.keys.json'), 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(path.join(credDir, 'credentials.json'), 'utf-8'));

  const cfg = keys.installed || keys.web || keys;
  const { client_id, client_secret } = cfg;

  // Refresh the token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = await res.json();

  // Persist refreshed tokens
  try {
    const updated = { ...tokens, access_token: data.access_token };
    if (data.expiry_date) updated.expiry_date = data.expiry_date;
    fs.writeFileSync(path.join(credDir, 'credentials.json'), JSON.stringify(updated, null, 2));
  } catch { /* non-fatal */ }

  return data.access_token;
}

// --- Gmail API helpers ---

async function gmailGet(token, endpoint, params = {}) {
  const url = new URL(`${API}/gmail/v1/users/me/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function gmailPost(token, endpoint, body = {}) {
  const res = await fetch(`${API}/gmail/v1/users/me/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function listMessages(token, query, maxResults = 100) {
  const ids = [];
  let pageToken;
  while (ids.length < maxResults) {
    const batchSize = Math.min(maxResults - ids.length, 100);
    const params = { q: query, maxResults: batchSize };
    if (pageToken) params.pageToken = pageToken;
    const data = await gmailGet(token, 'messages', params);
    if (!data.messages) break;
    ids.push(...data.messages.map(m => m.id));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return ids.slice(0, maxResults);
}

async function getMessageMeta(token, id) {
  const data = await gmailGet(token, `messages/${id}`, { format: 'metadata', metadataHeaders: 'From,Subject,Date' });
  const headers = data.payload?.headers || [];
  const get = name => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
  return {
    id,
    from: get('From'),
    subject: get('Subject'),
    date: get('Date'),
    labels: data.labelIds || [],
    snippet: data.snippet || '',
  };
}

async function batchGetMeta(token, ids) {
  // Fetch in parallel batches of 20
  const results = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const metas = await Promise.all(batch.map(id => getMessageMeta(token, id)));
    results.push(...metas);
  }
  return results;
}

async function batchModify(token, ids, addLabels = [], removeLabels = []) {
  if (ids.length === 0) return;
  // Gmail batchModify accepts up to 1000 IDs
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    await gmailPost(token, 'messages/batchModify', {
      ids: batch,
      addLabelIds: addLabels,
      removeLabelIds: removeLabels,
    });
  }
}

async function batchTrash(token, ids) {
  // No batch trash endpoint — use batchModify to add TRASH label
  // Actually, trash needs individual calls or we move to TRASH
  // Use batchModify with TRASH label
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    await gmailPost(token, 'messages/batchModify', {
      ids: batch,
      addLabelIds: ['TRASH'],
      removeLabelIds: ['INBOX', 'UNREAD'],
    });
  }
}

// --- Commands ---

async function cmdStats(token) {
  const profile = await gmailGet(token, 'profile');
  console.log(`Email: ${profile.emailAddress}`);
  console.log(`Total messages: ${profile.messagesTotal}`);
  console.log(`Total threads: ${profile.threadsTotal}`);
  console.log('');

  // Top senders in inbox
  const ids = await listMessages(token, 'in:inbox', 200);
  if (ids.length === 0) { console.log('Inbox is empty.'); return; }

  const metas = await batchGetMeta(token, ids);
  const senderCounts = {};
  for (const m of metas) {
    const email = m.from.match(/<(.+?)>/)?.[1] || m.from;
    senderCounts[email] = (senderCounts[email] || 0) + 1;
  }

  const sorted = Object.entries(senderCounts).sort((a, b) => b[1] - a[1]);
  console.log(`Inbox sample: ${ids.length} messages`);
  console.log('');
  console.log('Top senders:');
  for (const [email, count] of sorted.slice(0, 20)) {
    console.log(`  ${String(count).padStart(4)}  ${email}`);
  }

  // Age distribution
  const now = Date.now();
  const ages = { '< 1 day': 0, '1-7 days': 0, '7-30 days': 0, '30-90 days': 0, '> 90 days': 0 };
  for (const m of metas) {
    const age = now - new Date(m.date).getTime();
    const days = age / (1000 * 60 * 60 * 24);
    if (days < 1) ages['< 1 day']++;
    else if (days < 7) ages['1-7 days']++;
    else if (days < 30) ages['7-30 days']++;
    else if (days < 90) ages['30-90 days']++;
    else ages['> 90 days']++;
  }
  console.log('');
  console.log('Age distribution:');
  for (const [range, count] of Object.entries(ages)) {
    if (count > 0) console.log(`  ${String(count).padStart(4)}  ${range}`);
  }
}

async function cmdList(token, query, max) {
  const ids = await listMessages(token, query, max);
  if (ids.length === 0) { console.log('No messages found.'); return; }

  const metas = await batchGetMeta(token, ids);
  console.log(`Found ${ids.length} message(s) matching: ${query}\n`);
  for (const m of metas) {
    const from = m.from.length > 40 ? m.from.slice(0, 40) + '...' : m.from;
    const subj = m.subject.length > 50 ? m.subject.slice(0, 50) + '...' : m.subject;
    console.log(`  ${m.date?.slice(0, 16) || '?'}  ${from.padEnd(43)}  ${subj}`);
  }
}

async function cmdArchive(token, query, max, dryRun) {
  const ids = await listMessages(token, query, max);
  if (ids.length === 0) { console.log('No messages to archive.'); return; }

  if (dryRun) {
    const metas = await batchGetMeta(token, ids.slice(0, 10));
    console.log(`DRY RUN: Would archive ${ids.length} message(s) matching: ${query}`);
    console.log('Sample:');
    for (const m of metas) console.log(`  ${m.from} — ${m.subject}`);
    return;
  }

  await batchModify(token, ids, [], ['INBOX']);
  console.log(`Archived ${ids.length} message(s) matching: ${query}`);
}

async function cmdTrash(token, query, max, dryRun) {
  const ids = await listMessages(token, query, max);
  if (ids.length === 0) { console.log('No messages to trash.'); return; }

  if (dryRun) {
    const metas = await batchGetMeta(token, ids.slice(0, 10));
    console.log(`DRY RUN: Would trash ${ids.length} message(s) matching: ${query}`);
    console.log('Sample:');
    for (const m of metas) console.log(`  ${m.from} — ${m.subject}`);
    return;
  }

  await batchTrash(token, ids);
  console.log(`Trashed ${ids.length} message(s) matching: ${query}`);
}

async function cmdMarkRead(token, query, max, dryRun) {
  const ids = await listMessages(token, query, max);
  if (ids.length === 0) { console.log('No unread messages found.'); return; }

  if (dryRun) {
    console.log(`DRY RUN: Would mark ${ids.length} message(s) as read matching: ${query}`);
    return;
  }

  await batchModify(token, ids, [], ['UNREAD']);
  console.log(`Marked ${ids.length} message(s) as read matching: ${query}`);
}

async function cmdLabel(token, query, max, addLabel, removeLabel, dryRun) {
  const ids = await listMessages(token, query, max);
  if (ids.length === 0) { console.log('No messages found.'); return; }

  const add = addLabel ? [addLabel] : [];
  const remove = removeLabel ? [removeLabel] : [];

  if (dryRun) {
    console.log(`DRY RUN: Would modify labels on ${ids.length} message(s)`);
    if (add.length) console.log(`  Add: ${add.join(', ')}`);
    if (remove.length) console.log(`  Remove: ${remove.join(', ')}`);
    return;
  }

  await batchModify(token, ids, add, remove);
  console.log(`Modified labels on ${ids.length} message(s)`);
  if (add.length) console.log(`  Added: ${add.join(', ')}`);
  if (remove.length) console.log(`  Removed: ${remove.join(', ')}`);
}

// --- CLI ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  const opts = { max: 100, dryRun: false, from: null, query: null, add: null, remove: null, credDir: null };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--from': opts.from = args[++i]; break;
      case '--query': opts.query = args[++i]; break;
      case '--max': opts.max = Math.min(parseInt(args[++i]) || 100, 500); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--add': opts.add = args[++i]; break;
      case '--remove': opts.remove = args[++i]; break;
      case '--cred-dir': opts.credDir = args[++i]; break;
    }
  }

  // Build combined query
  let q = opts.query || '';
  if (opts.from) {
    const fromClause = `from:${opts.from}`;
    q = q ? `${fromClause} ${q}` : fromClause;
  }
  opts.combinedQuery = q;

  return { cmd, opts };
}

function printUsage() {
  console.log(`gmail-batch — Bulk Gmail operations

Commands:
  stats                           Inbox overview: top senders, age distribution
  list   [--from X] [--query Q]   List messages matching criteria
  archive [--from X] [--query Q]  Remove from inbox (keeps in All Mail)
  trash  [--from X] [--query Q]   Move to trash
  read   [--from X] [--query Q]   Mark as read
  label  --add/--remove LABEL     Modify labels on matching messages

Flags:
  --from <email>     Filter by sender
  --query <q>        Gmail search query (same syntax as Gmail search bar)
  --max <n>          Max messages to process (default: 100, cap: 500)
  --dry-run          Preview changes without applying

Examples:
  node gmail-batch.mjs stats
  node gmail-batch.mjs list --from "notifications@github.com" --max 20
  node gmail-batch.mjs archive --from "newsletter@company.com" --dry-run
  node gmail-batch.mjs archive --query "older_than:90d -is:starred"
  node gmail-batch.mjs trash --query "from:noreply category:promotions older_than:30d"
  node gmail-batch.mjs read --query "is:unread older_than:7d"`);
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    printUsage();
    process.exit(0);
  }

  const credDir = opts.credDir || findCredDir();
  if (!credDir) {
    console.error('No Gmail credentials found. Expected ~/.gmail-mcp/ or ~/.gmail-mcp-qewler/');
    process.exit(1);
  }

  const token = await getAccessToken(credDir);

  switch (cmd) {
    case 'stats':
      await cmdStats(token);
      break;
    case 'list':
      if (!opts.combinedQuery) { console.error('Need --from or --query'); process.exit(1); }
      await cmdList(token, opts.combinedQuery, opts.max);
      break;
    case 'archive':
      if (!opts.combinedQuery) { console.error('Need --from or --query'); process.exit(1); }
      await cmdArchive(token, opts.combinedQuery, opts.max, opts.dryRun);
      break;
    case 'trash':
      if (!opts.combinedQuery) { console.error('Need --from or --query'); process.exit(1); }
      await cmdTrash(token, opts.combinedQuery, opts.max, opts.dryRun);
      break;
    case 'read':
      if (!opts.combinedQuery) { console.error('Need --from or --query'); process.exit(1); }
      await cmdMarkRead(token, opts.combinedQuery, opts.max, opts.dryRun);
      break;
    case 'label':
      if (!opts.combinedQuery) { console.error('Need --from or --query'); process.exit(1); }
      if (!opts.add && !opts.remove) { console.error('Need --add or --remove'); process.exit(1); }
      await cmdLabel(token, opts.combinedQuery, opts.max, opts.add, opts.remove, opts.dryRun);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
