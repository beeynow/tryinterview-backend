const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  '';

let cachedSql = null;
let driverResolutionAttempted = false;
let resolvedDriver = null;
let missingDriverLogged = false;

function resolveDriver() {
  if (driverResolutionAttempted) {
    return resolvedDriver;
  }

  driverResolutionAttempted = true;

  try {
    resolvedDriver = require('@neondatabase/serverless');
  } catch (error) {
    resolvedDriver = null;
  }

  return resolvedDriver;
}

function isDatabaseConfigured() {
  return Boolean(DATABASE_URL);
}

function isDatabaseEnabled() {
  return isDatabaseConfigured() && Boolean(resolveDriver()?.neon);
}

function getDatabaseConfigError() {
  if (!isDatabaseConfigured()) {
    return 'DATABASE_URL (or NEON_DATABASE_URL / POSTGRES_URL) is not configured.';
  }

  if (!resolveDriver()?.neon) {
    return 'The @neondatabase/serverless package is not installed. Run npm install in tryinterview-backend once network access is available.';
  }

  return null;
}

function getSql() {
  if (cachedSql) {
    return cachedSql;
  }

  const databaseConfigError = getDatabaseConfigError();
  if (databaseConfigError) {
    if (!missingDriverLogged) {
      console.warn(`⚠️ Neon/Postgres disabled: ${databaseConfigError}`);
      missingDriverLogged = true;
    }

    throw new Error(databaseConfigError);
  }

  const { neon } = resolveDriver();
  cachedSql = neon(DATABASE_URL);

  return cachedSql;
}

async function query(text, params = []) {
  const sql = getSql();
  return sql.query(text, params);
}

module.exports = {
  DATABASE_URL,
  getDatabaseConfigError,
  getSql,
  isDatabaseConfigured,
  isDatabaseEnabled,
  query,
};
