// baseline_audit (after C1 purchase) and monthly_snapshot (near the end of every client month).
// Both measure the map grid, AI answers and reviews the same way, so the monthly report can compare.

const crypto = require('crypto');
const { measureClient, saveSnapshot, latestSnapshot, logSpend } = require('../shared/measure');
const { checkSite } = require('../shared/siteCheck');
const { alert } = require('../shared/alert');

const publicUrl = () => (process.env.BARRIER_PUBLIC_URL || 'https://barrier-bot-production.up.railway.app').replace(/\/$/, '');

async function loadClient(db, id) {
  const c = (await db.query('select * from barrier.clients where id = $1', [id])).rows[0];
  if (!c) throw new Error(`client ${id} not found`);
  return c;
}

// Every client gets one private dashboard link, made the first time it's needed.
async function ensureDashToken(db, c) {
  if (c.dash_token) return c.dash_token;
  const token = crypto.randomBytes(12).toString('base64url');
  await db.query('update barrier.clients set dash_token = coalesce(dash_token, $2) where id = $1', [c.id, token]);
  return (await db.query('select dash_token from barrier.clients where id = $1', [c.id])).rows[0].dash_token;
}

const dashLink = (token) => `${publicUrl()}/dash/${token}`;

// The earlier scan (Territory Scan) or snapshot gives the grid center, so the baseline matches what the prospect saw.
async function savedPlace(db, c) {
  const snap = await latestSnapshot(db, c.id);
  if (snap) return { center: snap.data.center, state: snap.data.state, cid: snap.data.cid };
  const scan = (await db.query('select data from barrier.scans where client_id = $1 order by created_at desc limit 1', [c.id])).rows[0];
  if (scan && scan.data.points && scan.data.points.length) {
    const mid = scan.data.points.find((p) => p.row === 3 && p.col === 3);
    if (mid) return { center: { lat: mid.lat, lng: mid.lng }, state: scan.data.state, cid: scan.data.business?.cid };
  }
  return null;
}

async function baselineAudit({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const measured = await measureClient(c, { dfs: deps.dfs, saved: await savedPlace(db, c), log: deps.log });
  const site = await checkSite({ website: c.website, city: c.registered_city || c.city, phone: c.phone, company: c.company }, deps.fetchImpl);
  measured.data.site = site;
  const snapId = await saveSnapshot(db, { clientId: c.id, kind: 'baseline', cycle: 0, data: measured.data });
  await db.query(
    `insert into barrier.work_items (client_id, cycle, kind, status, title, body) values ($1, 0, 'site_audit', 'ready', $2, $3)`,
    [c.id, `Website check: ${site.score ?? 0}/100`, JSON.stringify(site)]);
  await logSpend(db, { clientId: c.id, jobId: job.id, vendor: 'dataforseo', usd: measured.usd });
  const token = await ensureDashToken(db, c);
  const d = measured.data;
  const fixes = (site.checks || []).filter((x) => !x.ok).map((x) => `• ${x.fix}`).slice(0, 6).join('\n');
  await (deps.notify || alert)('onboarding',
    `Baseline ready for ${c.company} (${d.city}): top 3 on Maps in ${d.grid.top3Pct}% of the area, AI named them in ${d.ai.mentioned} of ${d.ai.asked} answers, ` +
    `${d.business.reviews ?? 0} reviews (${d.business.rating ?? 'no'}★). Website ${site.score ?? 'n/a'}/100.` +
    (fixes ? `\nWebsite fixes:\n${fixes}` : '') + `\nDashboard: ${dashLink(token)}`);
  return { snapshotId: snapId, top3Pct: d.grid.top3Pct, ai: `${d.ai.mentioned}/${d.ai.asked}`, siteScore: site.score ?? null, usd: Math.round(measured.usd * 1000) / 1000 };
}

async function monthlySnapshot({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const cycle = Number(String(job.dedupe_key || '').split(':').pop()) || 0;
  const measured = await measureClient(c, { dfs: deps.dfs, saved: await savedPlace(db, c), log: deps.log });
  const snapId = await saveSnapshot(db, { clientId: c.id, kind: 'monthly', cycle, data: measured.data });
  await logSpend(db, { clientId: c.id, jobId: job.id, vendor: 'dataforseo', usd: measured.usd });
  return { snapshotId: snapId, cycle, top3Pct: measured.data.grid.top3Pct, ai: `${measured.data.ai.mentioned}/${measured.data.ai.asked}` };
}

module.exports = { baselineAudit, monthlySnapshot, ensureDashToken, dashLink, loadClient, publicUrl };
