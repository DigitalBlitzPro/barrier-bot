// monthly_report (day 27 of each client month): compares this month's snapshot with last month's (or the baseline),
// counts the work done, writes the report fields on the client's contact in Digital Blitz's GHL and tags
// barrier-report-ready (C6 texts and emails it). Rules for milestones and at-risk: DECISIONS.md, Monthly report.

const { Ghl } = require('../shared/ghl');
const { alert } = require('../shared/alert');
const { loadClient, ensureDashToken, dashLink } = require('./measureJobs');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// Pure: the numbers and flags from two snapshots and the month's work. Tested.
function buildReport({ cur, prev, work, now = new Date() }) {
  const n = (v) => (v == null ? null : Number(v));
  const grid = n(cur.grid_pct) ?? 0;
  const prevGrid = n(prev?.grid_pct) ?? 0;
  const reviews = n(cur.reviews) ?? 0;
  const prevReviews = n(prev?.reviews) ?? reviews;
  const newReviews = Math.max(0, reviews - prevReviews);
  const aiHits = n(cur.ai_hits) ?? 0;
  const prevAi = n(prev?.ai_hits) ?? 0;
  const count = (kinds, statuses) => work.filter((w) => kinds.includes(w.kind) && statuses.includes(w.status)).length;
  const posts = count(['gbp_post'], ['scheduled', 'published']);
  const pages = count(['local_page', 'article'], ['published', 'ready']);

  // Milestones, best first. Only things the numbers prove.
  let milestone = null;
  for (const t of [75, 50, 25]) if (grid >= t && prevGrid < t) { milestone = `top 3 on Google Maps in ${t}%+ of the area`; break; }
  if (!milestone && aiHits > 0 && prevAi === 0) milestone = 'named in AI answers for the first time';
  if (!milestone && cur.center_rank === 1 && prev?.center_rank !== 1) milestone = '#1 on Google Maps in the center of town';

  const risks = [];
  if (prev && grid <= prevGrid - 10) risks.push(`map coverage fell from ${prevGrid}% to ${grid}%`);
  if (n(cur.rating) != null && n(cur.rating) < 4 && (n(prev?.rating) ?? 5) >= 4) risks.push(`rating dropped to ${n(cur.rating)}★`);
  if (posts === 0 && pages === 0) risks.push('no posts or pages went out this month');

  return {
    month: monthName(now), grid, prevGrid, newReviews, totalReviews: reviews, rating: n(cur.rating),
    aiHits, aiAsked: n(cur.ai_asked) ?? 0, posts, pages, replies: newReviews, milestone, risks,
  };
}

async function monthlyReport({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const cycle = Number(String(job.dedupe_key || '').split(':').pop()) || 0; // month number just finished (1 = month 1)
  const snaps = (await db.query(
    `select * from barrier.snapshots where client_id = $1 and ((kind = 'monthly' and cycle in ($2, $3)) or kind = 'baseline') order by created_at desc`,
    [c.id, cycle, cycle - 1])).rows;
  const cur = snaps.find((s) => s.kind === 'monthly' && s.cycle === cycle);
  if (!cur) throw new Error(`no snapshot yet for month ${cycle}; the monthly_snapshot job must finish first`);
  const prev = snaps.find((s) => s.kind === 'monthly' && s.cycle === cycle - 1) || snaps.find((s) => s.kind === 'baseline') || null;
  const centerRank = (s) => (s?.data?.points || []).find((p) => p.row === 3 && p.col === 3)?.rank ?? null;
  const work = (await db.query('select kind, status from barrier.work_items where client_id = $1 and cycle = $2', [c.id, cycle - 1])).rows;
  const r = buildReport({ cur: { ...cur, center_rank: centerRank(cur) }, prev: prev && { ...prev, center_rank: centerRank(prev) }, work, now: deps.now || new Date() });

  const token = await ensureDashToken(db, c);
  const ghl = deps.ghl || new Ghl();
  const fields = {
    'Barrier - Report Month': r.month,
    'Barrier - Grid Pct': String(r.grid),
    'Barrier - Prev Grid Pct': String(r.prevGrid),
    'Barrier - New Reviews': String(r.newReviews),
    'Barrier - Total Reviews': String(r.totalReviews),
    'Barrier - Rating': r.rating == null ? '' : String(r.rating),
    'Barrier - AI Hits': String(r.aiHits),
    'Barrier - Posts': String(r.posts),
    'Barrier - Pages': String(r.pages),
    'Barrier - Replies': String(r.replies),
    'Barrier - Dashboard Link': dashLink(token),
  };
  if (r.milestone) {
    fields['Barrier - Milestone City'] = c.registered_city || c.city || '';
    fields['Barrier - Milestone Keyword'] = r.milestone;
  }
  await ghl.setFieldsByName(c.ghl_contact_id, fields);
  const tags = ['barrier-report-ready'];
  if (r.milestone) tags.push('barrier-milestone');
  if (r.risks.length) tags.push('barrier-at-risk');
  await ghl.addTags(c.ghl_contact_id, tags);
  await db.query(`update barrier.snapshots set data = data || jsonb_build_object('report', $2::jsonb) where id = $1`, [cur.id, JSON.stringify(r)]);
  if (r.risks.length) {
    await (deps.notify || alert)('clients', `At risk: ${c.company} (month ${cycle}): ${r.risks.join('; ')}. Dashboard: ${dashLink(token)}`);
  }
  return { cycle, ...r };
}

module.exports = { monthlyReport, buildReport, monthName };
