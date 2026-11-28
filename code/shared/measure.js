// Measures where a client stands: Google Maps rank at 49 points (7x7, 1 mile apart), AI assistant answers,
// and their own review count and rating. Used by the baseline audit (after purchase) and the monthly snapshot,
// with the same grid and questions every time so months compare.

const { DataForSeo } = require('./dataforseo');
const { askAll, simpleName } = require('./aiCheck');
const { gridPoints, summarizeGrid, pickBusiness, isClient } = require('../handlers/territoryScan');

const KEYWORD = 'pest control';

// 10 homeowner questions x 4 assistants = 40 answers a month (the number the monthly text reports).
function monthlyQuestions({ city, state, services = [] }) {
  const where = state ? `${city}, ${state}` : city;
  const s = services.map((x) => String(x).toLowerCase());
  const has = (re) => s.some((x) => re.test(x));
  const qs = [
    `Who is the best pest control company in ${where}?`,
    `What pest control company do people recommend in ${where}?`,
    `I keep finding ants in my kitchen in ${where}. Which exterminator should I call?`,
    `Can you recommend a reliable pest control service near ${where} for mice in the garage?`,
    `Which pest control companies in ${where} have the best reviews?`,
    `Who should I hire for quarterly pest control in ${where}?`,
    has(/termite/) ? `Who does termite inspections and treatment in ${where}?` : `Who is a good exterminator for spiders in ${where}?`,
    has(/mosquito/) ? `Which company does mosquito treatment for yards in ${where}?` : `Who can get rid of wasps and hornets near ${where}?`,
    has(/rodent|rat|mice/) ? `Who is the best rodent control company in ${where}?` : `I have roaches in my apartment in ${where}. Who should I call?`,
    `Is there a pest control company in ${where} that is safe for kids and pets?`,
  ];
  return qs;
}

function dfsClient(budgetUsd) {
  return new DataForSeo({ login: process.env.DATAFORSEO_LOGIN, password: process.env.DATAFORSEO_PASSWORD, budgetUsd });
}

// Finds the client's own Maps listing and the grid center. A saved center (from an earlier run) is reused so the
// grid never drifts between months.
async function locate(dfs, { company, city, website, saved }) {
  const found = await dfs.post('serp/google/maps/live/advanced', { keyword: `${company} ${city}`, location_code: 2840, language_code: 'en', depth: 20 });
  const own = pickBusiness(found.items, { company, website });
  let center = saved?.center || (own ? { lat: own.latitude, lng: own.longitude } : null);
  if (!center) {
    const area = await dfs.post('serp/google/maps/live/advanced', { keyword: `${KEYWORD} ${city}`, location_code: 2840, language_code: 'en', depth: 10 });
    const first = (area.items || []).find((i) => i.latitude);
    if (!first) throw new Error(`could not place "${city}" on the map`);
    center = { lat: first.latitude, lng: first.longitude };
  }
  const state = saved?.state || own?.address_info?.region || (found.items || []).map((i) => i.address_info?.region).find(Boolean) || null;
  const business = {
    name: own?.title || company, cid: own?.cid || saved?.cid || null, domain: own?.domain || website || null,
    rating: own?.rating?.value ?? null, reviews: own?.rating?.votes_count ?? null, onMaps: !!own,
    category: own?.category || null, address: own?.address || null, phone: own?.phone || null,
  };
  return { business, center, state };
}

async function runGrid(dfs, center, business, log = () => {}) {
  const points = gridPoints(center.lat, center.lng);
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const p = points[next++];
      try {
        const r = await dfs.post('serp/google/maps/live/advanced', { keyword: KEYWORD, location_coordinate: `${p.lat},${p.lng},14z`, language_code: 'en', depth: 20 });
        const items = (r.items || []).filter((i) => i.type === 'maps_search');
        const hit = items.find((i) => isClient(i, business));
        p.rank = hit ? hit.rank_group : null;
        p.top3 = items.slice(0, 3).map((i) => ({ title: i.title, rating: i.rating?.value ?? null, reviews: i.rating?.votes_count ?? null, isClient: isClient(i, business) }));
      } catch (e) { p.error = e.message.slice(0, 120); log(`grid point ${p.row},${p.col}: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { points, grid: summarizeGrid(points) };
}

// Full measurement for a client row. Returns the data to store in barrier.snapshots plus the cost.
async function measureClient(c, { dfs, saved, log = () => {}, questions } = {}) {
  dfs = dfs || dfsClient(6);
  const city = c.registered_city || c.city;
  if (!c.company || !city) throw new Error(`measuring needs a company and a city (company=${!!c.company}, city=${!!city})`);
  const { business, center, state } = await locate(dfs, { company: c.company, city, website: c.website, saved });
  const { points, grid } = await runGrid(dfs, center, business, log);
  const qs = questions || monthlyQuestions({ city, state, services: c.services_offered || [] });
  const answers = await askAll({
    dfs, questions: qs, log,
    brand: { domain: business.domain, nameMatchers: [simpleName(business.name), simpleName(c.company)] },
    competitorNames: grid.leaders.map((l) => l.name),
  });
  const ok = answers.filter((a) => !a.error);
  const ai = { asked: ok.length, mentioned: ok.filter((a) => a.mentioned).length, answers };
  return {
    data: { version: 1, keyword: KEYWORD, city, state, center, cid: business.cid, business, grid, points, ai, measuredAt: new Date().toISOString() },
    usd: dfs.spent,
  };
}

// Columns for barrier.snapshots from measured data.
function snapshotRow(data) {
  return {
    grid_pct: data.grid.top3Pct, avg_rank: data.grid.avgRank, ai_hits: data.ai.mentioned, ai_asked: data.ai.asked,
    reviews: data.business.reviews, rating: data.business.rating,
  };
}

async function saveSnapshot(db, { clientId, kind, cycle, data }) {
  const r = snapshotRow(data);
  const out = await db.query(
    `insert into barrier.snapshots (client_id, kind, cycle, grid_pct, avg_rank, ai_hits, ai_asked, reviews, rating, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [clientId, kind, cycle, r.grid_pct, r.avg_rank, r.ai_hits, r.ai_asked, r.reviews, r.rating, JSON.stringify(data)]);
  return out.rows[0].id;
}

async function latestSnapshot(db, clientId) {
  return (await db.query('select * from barrier.snapshots where client_id = $1 order by created_at desc limit 1', [clientId])).rows[0] || null;
}

async function logSpend(db, { clientId, jobId, vendor, usd }) {
  if (!usd) return;
  await db.query('insert into barrier.spend (client_id, job_id, vendor, usd) values ($1, $2, $3, $4)', [clientId, jobId, vendor, usd]);
}

module.exports = { measureClient, monthlyQuestions, snapshotRow, saveSnapshot, latestSnapshot, logSpend, dfsClient, locate };
