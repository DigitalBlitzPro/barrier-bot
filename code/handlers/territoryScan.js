// Territory Scan: the free scan a prospect asks for on /territory-scan (GHL workflow S4).
// 1. Find the business on Google Maps.  2. Check "pest control" at 49 points around it (7x7 grid).
// 3. Ask four AI assistants three homeowner questions.  4. Compare reviews with the competitors that hold the map.
// 5. Save the scan, set the scan link and offer deadline in GHL, and add barrier-scan-ready (S5 texts the link).

const crypto = require('crypto');
const { DataForSeo, strip, hostOf } = require('../shared/dataforseo');
const { askAll, simpleName, ENGINES } = require('../shared/aiCheck');
const { Ghl } = require('../shared/ghl');
const { ask } = require('../shared/claude');

const GRID = 7;            // 7x7 = 49 points
const SPACING_MILES = 1;   // 6 miles edge to edge
const KEYWORD = 'pest control';
const BUDGET_USD = 3;      // hard cap on DataForSEO for one scan
const OFFER_DAYS = 14;

// 49 points around a center, row by row from the north-west corner.
function gridPoints(lat, lng, size = GRID, spacingMiles = SPACING_MILES) {
  const dLat = spacingMiles / 69;
  const dLng = spacingMiles / (69 * Math.cos((lat * Math.PI) / 180));
  const half = (size - 1) / 2;
  const pts = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    pts.push({ row: r, col: c, lat: +(lat + (half - r) * dLat).toFixed(6), lng: +(lng + (c - half) * dLng).toFixed(6) });
  }
  return pts;
}

function isClient(item, biz) {
  if (biz.cid && item.cid && String(item.cid) === String(biz.cid)) return true;
  const title = strip(item.title);
  const site = hostOf(item.domain || '');
  return (biz.name && title.includes(strip(simpleName(biz.name)))) || (biz.domain && site && site.includes(hostOf(biz.domain)));
}

// Picks the prospect's own listing from a Maps search for their name.
function pickBusiness(items, { company, website }) {
  const name = strip(simpleName(company));
  const domain = website ? hostOf(String(website).replace(/^https?:\/\//, '').split('/')[0]) : '';
  const list = (items || []).filter((i) => i.type === 'maps_search');
  return list.find((i) => domain && hostOf(i.domain || '').includes(domain))
    || list.find((i) => name && strip(i.title).includes(name))
    || null;
}

function summarizeGrid(points) {
  const done = points.filter((p) => !p.error);
  const ranks = done.map((p) => p.rank);
  const top3 = ranks.filter((r) => r && r <= 3).length;
  const found = ranks.filter(Boolean);
  const comp = {};
  for (const p of done) for (const t of p.top3 || []) {
    if (t.isClient) continue;
    const c = (comp[t.title] = comp[t.title] || { name: t.title, spots: 0, rating: t.rating, reviews: t.reviews });
    c.spots++;
  }
  return {
    checked: done.length,
    top3,
    top3Pct: done.length ? Math.round((top3 / done.length) * 100) : 0,
    avgRank: found.length ? Math.round((found.reduce((a, b) => a + b, 0) / found.length) * 10) / 10 : null,
    notFound: done.length - found.length,
    leaders: Object.values(comp).sort((a, b) => b.spots - a.spots).slice(0, 3),
  };
}

function questionsFor(city, state) {
  const where = state ? `${city}, ${state}` : city;
  return [
    `Who is the best pest control company in ${where}?`,
    `I keep finding ants in my kitchen in ${where}. Which exterminator should I call?`,
    `Can you recommend a reliable pest control service near ${where} for mice in the garage?`,
  ];
}

const addDays = (d, n) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);

async function writeVerdict(scan) {
  const facts = {
    ownerFirstName: scan.firstName || null, company: scan.business.name, city: scan.city,
    mapTop3Pct: scan.grid.top3Pct, avgRank: scan.grid.avgRank, notFoundPoints: scan.grid.notFound,
    mapLeader: scan.grid.leaders[0]?.name || null, mapLeaderSpots: scan.grid.leaders[0]?.spots || 0,
    aiMentioned: scan.ai.mentioned, aiAsked: scan.ai.asked,
    yourReviews: scan.business.reviews, yourRating: scan.business.rating,
    leaderReviews: scan.grid.leaders[0]?.reviews || null,
  };
  try {
    const r = await ask({
      system: 'You write the 2-3 sentence verdict at the top of a pest control company\'s Territory Scan. Voice: funny, punchy, pest-control humor (bugs, barriers, infestations), talking to the owner. Use only the numbers given; never invent a number, name or claim. If ownerFirstName is given, address the owner by that first name; otherwise use the company name. No hashtags, no emojis. Name a competitor only if mapLeader is given. End on what they could win, not doom.',
      prompt: `Facts (JSON): ${JSON.stringify(facts)}\nWrite the verdict.`,
      maxTokens: 1000,
    });
    return { text: r.text, usd: r.usd };
  } catch (e) {
    console.log(`[scan] verdict fell back to the template: ${e.message}`);
    return { text: `${facts.company} shows up in the top 3 on Google Maps at ${facts.mapTop3Pct}% of the 49 spots we checked around ${facts.city}, and AI assistants named you in ${facts.aiMentioned} of ${facts.aiAsked} answers. That's a lot of territory still up for grabs.`, usd: 0 };
  }
}

async function territoryScan({ db, job, deps = {} }) {
  const c = (await db.query('select * from barrier.clients where id = $1', [job.client_id])).rows[0];
  if (!c) throw new Error(`client ${job.client_id} not found`);
  const company = c.company;
  const city = c.registered_city || c.city;
  if (!company || !city) throw new Error(`scan needs a company and a city (got company=${!!company}, city=${!!city})`);

  const dfs = deps.dfs || new DataForSeo({ login: process.env.DATAFORSEO_LOGIN, password: process.env.DATAFORSEO_PASSWORD, budgetUsd: BUDGET_USD });
  const log = deps.log || ((m) => console.log(`[scan ${c.id}] ${m}`));

  // 1. The business itself.
  const found = await dfs.post('serp/google/maps/live/advanced', { keyword: `${company} ${city}`, location_code: 2840, language_code: 'en', depth: 20 });
  const own = pickBusiness(found.items, { company, website: c.website });
  let center = own ? { lat: own.latitude, lng: own.longitude } : null;
  if (!center) {
    // Not on Maps (or not findable): center the grid on the pest companies Google shows for the city.
    const area = await dfs.post('serp/google/maps/live/advanced', { keyword: `${KEYWORD} ${city}`, location_code: 2840, language_code: 'en', depth: 10 });
    const first = (area.items || []).find((i) => i.latitude);
    if (!first) throw new Error(`could not place "${city}" on the map`);
    center = { lat: first.latitude, lng: first.longitude };
  }
  // Service-area businesses hide their address, so the state may come from other listings in the same search.
  const state = own?.address_info?.region || (found.items || []).map((i) => i.address_info?.region).find(Boolean) || null;
  const business = {
    name: own?.title || company, cid: own?.cid || null, domain: own?.domain || c.website || null,
    rating: own?.rating?.value ?? null, reviews: own?.rating?.votes_count ?? null, onMaps: !!own,
  };

  // 2. The 7x7 grid.
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
  const grid = summarizeGrid(points);

  // 3. AI assistants.
  const questions = questionsFor(city, state);
  const answers = await askAll({
    dfs, questions, log,
    brand: { domain: business.domain, nameMatchers: [simpleName(business.name), simpleName(company)] },
    competitorNames: grid.leaders.map((l) => l.name),
  });
  const ok = answers.filter((a) => !a.error);
  const ai = { asked: ok.length, mentioned: ok.filter((a) => a.mentioned).length, answers };

  // 4. Verdict, save, hand back to GHL.
  const firstName = (c.raw_fields && c.raw_fields.first_name) || (c.owner_name ? String(c.owner_name).split(' ')[0] : null);
  const scan = { version: 1, firstName, company, city, state, keyword: KEYWORD, business, grid, points, ai, engines: ENGINES, createdAt: new Date().toISOString() };
  const verdict = await writeVerdict(scan);
  scan.verdict = verdict.text;
  const offerDeadline = addDays(new Date(), OFFER_DAYS);
  scan.offerDeadline = offerDeadline;

  const token = crypto.randomBytes(12).toString('base64url');
  await db.query('insert into barrier.scans (token, client_id, job_id, data) values ($1, $2, $3, $4)', [token, c.id, job.id, JSON.stringify(scan)]);
  const usd = dfs.spent + verdict.usd;
  await db.query('insert into barrier.spend (client_id, job_id, vendor, usd) values ($1, $2, $3, $4), ($1, $2, $5, $6)', [c.id, job.id, 'dataforseo', dfs.spent, 'anthropic', verdict.usd]);

  const link = `${(process.env.BARRIER_PUBLIC_URL || 'https://barrier-bot-production.up.railway.app').replace(/\/$/, '')}/scan/${token}`;
  if (!deps.skipGhl) {
    const ghl = deps.ghl || new Ghl();
    await ghl.setFields(c.ghl_contact_id, { 'contact.barrier_scan_link': link, 'contact.barrier_offer_deadline': offerDeadline });
    await ghl.addTags(c.ghl_contact_id, ['barrier-scan-ready']);
  }
  return { link, top3Pct: grid.top3Pct, aiMentioned: ai.mentioned, aiAsked: ai.asked, onMaps: business.onMaps, usd: Math.round(usd * 1000) / 1000 };
}

module.exports = { territoryScan, gridPoints, summarizeGrid, pickBusiness, questionsFor, isClient };
