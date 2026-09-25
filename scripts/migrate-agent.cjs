const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const dotenv = require('dotenv');
const postgres = require('postgres');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MIGRATION_FILES = [
  '003_agent_control.sql',
  '005_platform_foundation.sql',
  '006_web_auth.sql',
  '007_sales_behavior_drafts.sql',
  '008_conversation_memory.sql',
  '009_followup_context_snapshot.sql',
  '010_followup_progress_assessment.sql',
];

const checksum = (content) => createHash('sha256')
  .update(content, 'utf8')
  .digest('hex');

const transactionBody = (content, filename) => {
  const match = content.match(/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/iu);
  if (!match) {
    throw new Error(
      `Migration ${filename} must contain one outer BEGIN/COMMIT block`,
    );
  }
  return match[1];
};

const loadEnvironment = () => {
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local'), quiet: true });
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
};

const run = async () => {
  if (process.argv.includes('--list')) {
    process.stdout.write(`${MIGRATION_FILES.join('\n')}\n`);
    return;
  }

  loadEnvironment();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS agent_schema_migrations (
        filename varchar(255) PRIMARY KEY,
        checksum varchar(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    for (const filename of MIGRATION_FILES) {
      const fullPath = path.join(PROJECT_ROOT, 'migrations', filename);
      const content = await readFile(fullPath, 'utf8');
      const digest = checksum(content);
      const existing = await sql`
        SELECT checksum
        FROM agent_schema_migrations
        WHERE filename = ${filename}
        LIMIT 1
      `;
      if (existing.length > 0) {
        if (existing[0].checksum !== digest) {
          throw new Error(
            `Migration checksum mismatch: ${filename}. ` +
            'Create a new migration instead of editing an applied file.',
          );
        }
        process.stdout.write(`skip ${filename}\n`);
        continue;
      }

      const body = transactionBody(content, filename);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(body);
        await transaction`
          INSERT INTO agent_schema_migrations (filename, checksum)
          VALUES (${filename}, ${digest})
        `;
      });
      process.stdout.write(`apply ${filename}\n`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Agent migration failed: ${message}\n`);
  process.exitCode = 1;
});
