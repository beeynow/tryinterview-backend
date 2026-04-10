const fs = require('fs');
const path = require('path');
const { getDatabaseConfigError, query } = require('./client');

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const STATEMENT_BREAKPOINT = /\n-- statement-breakpoint\n/g;

async function ensureMigrationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

async function getAppliedMigrationIds() {
  const rows = await query('SELECT id FROM schema_migrations ORDER BY id ASC');
  return new Set(rows.map((row) => row.id));
}

function parseMigrationStatements(fileContents) {
  return fileContents
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigration(fileName) {
  const absolutePath = path.join(MIGRATIONS_DIR, fileName);
  const fileContents = fs.readFileSync(absolutePath, 'utf8');
  const statements = parseMigrationStatements(fileContents);

  for (const statement of statements) {
    await query(statement);
  }

  await query('INSERT INTO schema_migrations (id) VALUES ($1)', [fileName]);
}

async function runMigrations() {
  const databaseConfigError = getDatabaseConfigError();
  if (databaseConfigError) {
    throw new Error(databaseConfigError);
  }

  await ensureMigrationTable();

  const files = getMigrationFiles();
  const appliedMigrationIds = await getAppliedMigrationIds();
  const applied = [];

  for (const fileName of files) {
    if (appliedMigrationIds.has(fileName)) {
      continue;
    }

    await applyMigration(fileName);
    applied.push(fileName);
  }

  return applied;
}

module.exports = {
  MIGRATIONS_DIR,
  runMigrations,
};
