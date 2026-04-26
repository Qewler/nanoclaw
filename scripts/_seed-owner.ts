/**
 * Phase A of /migrate-from-v1: seed the owner user and confirm strict policy.
 *
 * Run from /Users/qewler/Github/nanoclaw-v2:
 *   pnpm exec tsx /tmp/seed-owner.ts
 */
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { DATA_DIR } from '../src/config.js';
import { createUser } from '../src/modules/permissions/db/users.js';
import { grantRole } from '../src/modules/permissions/db/user-roles.js';
import path from 'path';

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

const userId = 'telegram:qewler';
const now = new Date().toISOString();

try {
  createUser({ id: userId, kind: 'telegram', display_name: 'qewler', created_at: now });
  console.log(`✓ Created user ${userId}`);
} catch (e) {
  if (String(e).includes('UNIQUE')) console.log(`= User ${userId} already exists, skipping`);
  else throw e;
}

try {
  grantRole({ user_id: userId, role: 'owner', agent_group_id: null, granted_by: null, granted_at: now });
  console.log(`✓ Granted role 'owner' to ${userId}`);
} catch (e) {
  if (String(e).includes('UNIQUE')) console.log(`= Role 'owner' already granted to ${userId}, skipping`);
  else throw e;
}

// Check policy
const rows = db.prepare("SELECT id, unknown_sender_policy, channel_type, platform_id FROM messaging_groups").all();
console.log('\nMessaging groups:');
for (const r of rows as any[]) {
  console.log(`  ${r.channel_type}:${r.platform_id} → policy=${r.unknown_sender_policy}`);
}
