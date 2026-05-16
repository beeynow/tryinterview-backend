const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
dotenv.config({
  path: '.env.local',
  override: true,
});

const {
  DATABASE_URL,
  getDatabaseConfigError,
  query,
} = require('../lib/db/client');

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

function parseDatabaseUrl(connectionString) {
  const parsedUrl = new URL(connectionString);

  return {
    host: parsedUrl.hostname,
    database: parsedUrl.pathname.replace(/^\/+/, '') || null,
    sslmode: parsedUrl.searchParams.get('sslmode') || null,
    channelBinding: parsedUrl.searchParams.get('channel_binding') || null,
  };
}

async function getAppliedMigrationIds() {
  const [{ relationExists } = {}] = await query(`
    SELECT to_regclass('public.schema_migrations') IS NOT NULL AS "relationExists"
  `);

  if (!relationExists) {
    return [];
  }

  const rows = await query('SELECT id FROM schema_migrations ORDER BY id ASC');
  return rows.map((row) => row.id);
}

async function main() {
  const databaseConfigError = getDatabaseConfigError();
  if (databaseConfigError) {
    throw new Error(databaseConfigError);
  }

  const connectionInfo = parseDatabaseUrl(DATABASE_URL);
  const [databaseInfo] = await query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      version() AS postgres_version
  `);
  const migrationFiles = getMigrationFiles();
  const appliedMigrationIds = await getAppliedMigrationIds();
  const pendingMigrationIds = migrationFiles.filter((fileName) => !appliedMigrationIds.includes(fileName));

  console.log('✅ Database connection successful.');
  console.log(`Host: ${connectionInfo.host}`);
  console.log(`Database: ${databaseInfo?.database_name || connectionInfo.database || 'unknown'}`);
  console.log(`User: ${databaseInfo?.database_user || 'unknown'}`);
  console.log(`SSL Mode: ${connectionInfo.sslmode || 'not set'}`);
  console.log(`Channel Binding: ${connectionInfo.channelBinding || 'not set'}`);
  console.log(`Strict DB Mode: ${process.env.REQUIRE_DATABASE || 'false'}`);
  console.log(`Applied migrations: ${appliedMigrationIds.length}`);
  console.log(`Pending migrations: ${pendingMigrationIds.length}`);

  if (connectionInfo.sslmode !== 'require') {
    console.warn('⚠️ sslmode=require is recommended for production Neon/Postgres connections.');
  }

  if (pendingMigrationIds.length) {
    console.log('Pending migration files:');
    pendingMigrationIds.forEach((migrationId) => {
      console.log(`- ${migrationId}`);
    });
  } else {
    console.log('✅ No pending migrations.');
  }
}

main().catch((error) => {
  console.error('❌ Database check failed:', error.message);
  process.exit(1);
});
