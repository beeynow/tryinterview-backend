const dotenv = require('dotenv');

dotenv.config();
dotenv.config({
  path: '.env.local',
  override: true,
});

const { runMigrations } = require('../lib/db/migrations');
const { listQuestionBankCategories } = require('../lib/platformStore');

async function main() {
  const applied = await runMigrations();
  const categories = await listQuestionBankCategories();

  if (applied.length) {
    console.log('✅ Applied migrations:');
    applied.forEach((migrationId) => {
      console.log(`- ${migrationId}`);
    });
  } else {
    console.log('✅ Database schema is already up to date.');
  }

  console.log(`✅ Question bank ready with ${categories.length} categories.`);
}

main().catch((error) => {
  console.error('❌ Database setup failed:', error.message);
  process.exit(1);
});
