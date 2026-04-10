const dotenv = require('dotenv');

dotenv.config();
dotenv.config({
  path: '.env.local',
  override: true,
});

const { runMigrations } = require('../lib/db/migrations');

async function main() {
  const applied = await runMigrations();

  if (!applied.length) {
    console.log('✅ Database schema is already up to date.');
    return;
  }

  console.log('✅ Applied migrations:');
  applied.forEach((migrationId) => {
    console.log(`- ${migrationId}`);
  });
}

main().catch((error) => {
  console.error('❌ Failed to run migrations:', error.message);
  process.exit(1);
});
