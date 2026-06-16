const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  '';
const DATABASE_QUERY_TIMEOUT_MS = Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 10000);

let cachedPool = null;
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
  return isDatabaseConfigured() && Boolean(resolveDriver()?.neon || resolveDriver()?.Pool);
}

function getDatabaseConfigError() {
  if (!isDatabaseConfigured()) {
    return 'DATABASE_URL (or NEON_DATABASE_URL / POSTGRES_URL) is not configured.';
  }

  const driver = resolveDriver();
  if (!driver?.neon && !driver?.Pool) {
    return 'The @neondatabase/serverless package is not installed. Run npm install in tryinterview-backend once network access is available.';
  }

  return null;
}

function getPool() {
  if (cachedPool) {
    return cachedPool;
  }

  const databaseConfigError = getDatabaseConfigError();
  if (databaseConfigError) {
    if (!missingDriverLogged) {
      console.warn(`⚠️ Neon/Postgres disabled: ${databaseConfigError}`);
      missingDriverLogged = true;
    }

    throw new Error(databaseConfigError);
  }

  const driver = resolveDriver();

  // Prefer Pool (WebSocket / extended query protocol) so that Postgres can
  // resolve parameter types on NULL values.  This eliminates the
  // "could not determine data type of parameter $N" error that the HTTP
  // neon() client throws because it uses the simple query protocol.
  if (driver.Pool) {
    // Configure WebSocket for serverless environments
    if (driver.neonConfig) {
      // In Node.js (local dev / Vercel), try to use the built-in WebSocket or ws package
      try {
        driver.neonConfig.webSocketConstructor = require('ws');
      } catch (_e) {
        // ws not installed; Neon will use global WebSocket if available
      }
      driver.neonConfig.poolQueryViaFetch = false;
    }

    cachedPool = new driver.Pool({ connectionString: DATABASE_URL });
    return cachedPool;
  }

  // Fallback: use the HTTP neon() client (note: NULL params may fail)
  cachedPool = { _httpClient: driver.neon(DATABASE_URL), _isHttp: true };
  return cachedPool;
}

async function query(text, params = []) {
  const pool = getPool();

  // HTTP client fallback path
  if (pool._isHttp) {
    return pool._httpClient.query(text, params);
  }

  // WebSocket Pool path — supports full prepared-statement protocol
  if (!Number.isFinite(DATABASE_QUERY_TIMEOUT_MS) || DATABASE_QUERY_TIMEOUT_MS <= 0) {
    const result = await pool.query(text, params);
    return result.rows;
  }

  const client = await pool.connect();
  const timeout = setTimeout(() => {
    try { client.release(true); } catch (_e) { /* ignore */ }
  }, DATABASE_QUERY_TIMEOUT_MS);

  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    clearTimeout(timeout);
    try { client.release(); } catch (_e) { /* already released */ }
  }
}

// getSql kept as compatibility shim
function getSql() {
  const driver = resolveDriver();
  return driver.neon(DATABASE_URL);
}

module.exports = {
  DATABASE_URL,
  getDatabaseConfigError,
  getSql,
  isDatabaseConfigured,
  isDatabaseEnabled,
  query,
};
