const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  '';
const DATABASE_QUERY_TIMEOUT_MS = Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 10000);

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

  if (!Number.isFinite(DATABASE_QUERY_TIMEOUT_MS) || DATABASE_QUERY_TIMEOUT_MS <= 0) {
    return sql.query(text, params);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort(`Database query timed out after ${DATABASE_QUERY_TIMEOUT_MS}ms.`);
  }, DATABASE_QUERY_TIMEOUT_MS);

  try {
    return await sql.query(text, params, {
      fetchOptions: {
        signal: abortController.signal,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DATABASE_URL,
  getDatabaseConfigError,
  getSql,
  isDatabaseConfigured,
  isDatabaseEnabled,
  query,
};
