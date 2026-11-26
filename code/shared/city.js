// Exclusivity: one pest company per registered city. Cities are compared loosely ("St. Petersburg, FL" = "saint petersburg").
const ABBR = { st: 'saint', ste: 'sainte', ft: 'fort', mt: 'mount', pt: 'port' };

function normCity(s) {
  let c = String(s || '').toLowerCase().split(',')[0];          // drop ", FL"
  c = c.replace(/\b(fl|florida|az|arizona|tx|texas|ca|mi|wa)\b\s*$/, ''); // "Tampa FL"
  c = c.replace(/[.']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return c.split(' ').map((w, i) => (i === 0 && ABBR[w] ? ABBR[w] : w)).join(' ');
}

const HOLDS_CITY = ['purchased', 'onboarded', 'active', 'paused'];

// Other clients that already hold this city (excluding clientId).
async function cityHolders(db, city, clientId = null) {
  const n = normCity(city);
  if (!n) return [];
  const r = await db.query(
    `select id, company, ghl_contact_id, coalesce(registered_city, city) as city from barrier.clients
     where status = any($1::text[]) and ($2::bigint is null or id <> $2) and coalesce(registered_city, city) is not null`,
    [HOLDS_CITY, clientId]);
  return r.rows.filter((row) => normCity(row.city) === n);
}

module.exports = { normCity, cityHolders, HOLDS_CITY };
