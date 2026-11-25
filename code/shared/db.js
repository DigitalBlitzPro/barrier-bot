// One short-lived database connection per call. Returns null when no connection string is set (for dry runs and tests).
async function withDb(fn) {
  if (!process.env.SUPABASE_DB_URL) return null;
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}
module.exports = { withDb };
