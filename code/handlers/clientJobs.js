// Onboarding and review-engine jobs: start_month1, access_check, create_subaccount, software_test, software_sync,
// review_done, review_do_not_ask, review_approval, photo_intake. Rules: DECISIONS.md (Onboarding, Review engine).

const { loadClient, ensureDashToken, dashLink } = require('./measureJobs');
const { enqueueOnce, NeedsSetup } = require('../shared/queue');
const { checkSite } = require('../shared/siteCheck');
const { alert } = require('../shared/alert');
const { Ghl } = require('../shared/ghl');
const { SubGhl } = require('../shared/subGhl');
const { decrypt } = require('../shared/secrets');
const { connectorFor } = require('../shared/software');
const { parseGhlWebhook } = require('../shared/ghlPayload');

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// C5b: kickoff done. Month 1's work starts now (the scheduler would also queue it within the hour; same key, so never twice).
async function startMonth1({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const id = await enqueueOnce(db, { type: 'monthly_work', clientId: c.id, dedupeKey: `${c.id}:work:0` });
  const token = await ensureDashToken(db, c);
  await (deps.notify || alert)('onboarding', `${c.company} is live. Month 1 work is queued (4 Google posts, 2 local pages, 1 article). Dashboard: ${dashLink(token)}`);
  return { queued: !!id };
}

// C3: after the onboarding form. Checks what the bot can check on its own and tells Kenny what's missing.
async function accessCheck({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const problems = [];
  const site = await checkSite({ website: c.website, city: c.registered_city || c.city, phone: c.phone, company: c.company }, deps.fetchImpl);
  if (site.skipped) problems.push('no website on file');
  else if (site.error || (site.checks || []).some((x) => x.id === 'up' && !x.ok)) problems.push(`website not reachable (${site.error || site.status})`);
  if (!c.gbp_url) problems.push('no Google Business Profile link on file');
  if (!c.registered_city) problems.push('no registered city');
  if (!c.services_offered || !c.services_offered.length) problems.push('no services listed');
  if (problems.length) await (deps.notify || alert)('onboarding', `Access check for ${c.company}: ${problems.join('; ')}.`);
  return { ok: !problems.length, problems, siteScore: site.score ?? null };
}

// C3: make the client's GHL sub-account from the template snapshot. Needs the agency token (Railway variables).
// If Kenny makes the sub-account by hand instead, submitting its id + token (client/ghl-token) finishes this job.
async function createSubaccount({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  if (c.ghl_location_id) return { exists: c.ghl_location_id };
  const env = deps.env || process.env;
  if (!env.GHL_AGENCY_TOKEN || !env.GHL_COMPANY_ID || !env.GHL_SNAPSHOT_ID) {
    throw new NeedsSetup(`make ${c.company}'s GHL sub-account from the Barrier template (or add GHL_AGENCY_TOKEN, GHL_COMPANY_ID and GHL_SNAPSHOT_ID in Railway so the bot can), then submit the sub-account id and token.`);
  }
  const [first, ...rest] = String(c.owner_name || '').split(' ');
  const res = await (deps.fetchImpl || fetch)('https://services.leadconnectorhq.com/locations/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GHL_AGENCY_TOKEN}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name: c.company, phone: c.phone || undefined, companyId: env.GHL_COMPANY_ID, address: c.street_address || undefined, city: c.city || undefined,
      state: c.state || undefined, country: 'US', postalCode: c.postal_code || undefined, website: c.website || undefined,
      prospectInfo: { firstName: first || c.company, lastName: rest.join(' ') || '-', email: c.email || undefined }, snapshotId: env.GHL_SNAPSHOT_ID,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GHL create sub-account: HTTP ${res.status} ${text.slice(0, 200)}`);
  const loc = JSON.parse(text);
  const locationId = loc.id || loc.location?.id;
  await db.query('update barrier.clients set ghl_location_id = $2, updated_at = now() where id = $1', [c.id, locationId]);
  await (deps.notify || alert)('onboarding', `Sub-account made for ${c.company} (${locationId}). Next: in it, make a Private Integration token (Social Planner, Users, Contacts, Custom Fields), connect Google Business Profile in Social Planner, and submit the token through the sub-account token form.`);
  return { locationId };
}

// C12: test the job software key, then tell GHL (Software Status) so C10/C11 can text the client.
async function softwareTest({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const conn = (await db.query('select * from barrier.client_connections where client_id = $1', [c.id])).rows[0];
  if (!conn) throw new Error('no software connection saved');
  const secret = JSON.parse(decrypt(conn.secret_enc));
  let status, reason = null;
  let kind;
  try {
    const k = connectorFor(conn.software, secret, deps.fetchImpl);
    kind = k.kind;
    if (k.kind === 'jobber') status = 'Jobber Link';
    else if (!k.api) { status = 'Failed'; reason = `${conn.software} isn't connected automatically yet`; }
    else { await k.api.test(); status = 'Connected'; }
  } catch (e) { status = 'Failed'; reason = e.message.slice(0, 200); }
  await db.query(`update barrier.client_connections set status = $2, updated_at = now() where client_id = $1`,
    [c.id, status === 'Connected' ? 'connected' : 'failed']);
  const ghl = deps.ghl || new Ghl();
  await ghl.setFieldsByName(c.ghl_contact_id, { 'Barrier - Software Status': status });
  await ghl.addTags(c.ghl_contact_id, ['barrier-software-update']);
  if (status === 'Failed') await (deps.notify || alert)('onboarding', `Software connection failed for ${c.company} (${conn.software}): ${reason}.`);
  return { software: conn.software, kind, status, reason };
}

// Every 2 hours: finished jobs -> customers in the client's sub-account tagged review-eligible (the template's
// Review Engine sends the asks). Skips customers who already left a review, asked not to be asked, or already got this job's ask.
async function softwareSync({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const conn = (await db.query(`select * from barrier.client_connections where client_id = $1 and status = 'connected'`, [c.id])).rows[0];
  if (!conn) return { skipped: 'not connected' };
  const k = connectorFor(conn.software, JSON.parse(decrypt(conn.secret_enc)), deps.fetchImpl);
  if (!k.api) return { skipped: k.kind };
  const sub = deps.sub || SubGhl.forClient(c, { fetchImpl: deps.fetchImpl });
  const since = new Date((deps.now || new Date()).getTime() - 2 * 86400000);
  const jobs = await k.api.finishedJobs(since);
  const seen = (await db.query(
    `select kind, data->>'jobId' as job_id, data->>'phone' as phone from barrier.review_events where client_id = $1 and (kind in ('done','do_not_ask') or at > now() - interval '30 days')`,
    [c.id])).rows;
  const doneJobs = new Set(seen.filter((s) => s.kind === 'asked').map((s) => s.job_id));
  const blocked = new Set(seen.filter((s) => s.kind !== 'asked').map((s) => digits(s.phone)).filter(Boolean));
  let asked = 0, skipped = 0;
  for (const j of jobs) {
    const phone = digits(j.phone);
    if (doneJobs.has(j.jobId) || (phone && blocked.has(phone)) || (!phone && !j.email) || (j.commercial && c.ask_commercial === false)) { skipped++; continue; }
    const contactId = await sub.upsertContact({ firstName: j.firstName, lastName: j.lastName, phone: j.phone, email: j.email, tags: ['review-eligible'] });
    await db.query(`insert into barrier.review_events (client_id, ghl_location_id, ghl_contact_id, tech, kind, data) values ($1, $2, $3, $4, 'asked', $5)`,
      [c.id, c.ghl_location_id, contactId, j.tech || null, JSON.stringify({ jobId: j.jobId, phone, at: j.at })]);
    doneJobs.add(j.jobId);
    asked++;
  }
  return { found: jobs.length, asked, skipped };
}

// Events from client sub-accounts carry the sub-account's location id.
async function eventContext(db, job) {
  const ev = (await db.query('select * from barrier.events where id = $1', [job.event_id])).rows[0];
  if (!ev) throw new Error(`event ${job.event_id} not found`);
  const parsed = parseGhlWebhook(ev.payload);
  const locationId = parsed.locationId || ev.ghl_location_id;
  const c = locationId ? (await db.query('select * from barrier.clients where ghl_location_id = $1', [locationId])).rows[0] : null;
  if (!c) throw new Error(`no client has sub-account ${locationId}`);
  const raw = parsed.raw || {};
  const pick = (...names) => { for (const n of names) { const k = Object.keys(raw).find((x) => x.toLowerCase() === n.toLowerCase()); if (k && raw[k] !== '') return raw[k]; } return null; };
  return { c, parsed, raw, pick, locationId };
}

async function reviewDone({ db, job }) {
  const { c, parsed, pick, locationId } = await eventContext(db, job);
  const asked = (await db.query(
    `select tech, data from barrier.review_events where client_id = $1 and ghl_contact_id = $2 and kind = 'asked' order by at desc limit 1`, [c.id, parsed.contactId])).rows[0];
  const tech = asked?.tech || pick('tech', 'Tech Name', 'Technician', 'Barrier - Tech') || null;
  await db.query(`insert into barrier.review_events (client_id, ghl_location_id, ghl_contact_id, tech, kind, data) values ($1, $2, $3, $4, 'done', $5)`,
    [c.id, locationId, parsed.contactId, tech, JSON.stringify({ phone: digits(pick('phone')), jobId: asked?.data?.jobId || null })]);
  return { client: c.id, tech };
}

async function reviewDoNotAsk({ db, job }) {
  const { c, parsed, pick, locationId } = await eventContext(db, job);
  await db.query(`insert into barrier.review_events (client_id, ghl_location_id, ghl_contact_id, kind, data) values ($1, $2, $3, 'do_not_ask', $4)`,
    [c.id, locationId, parsed.contactId, JSON.stringify({ phone: digits(pick('phone')) })]);
  return { client: c.id };
}

// A review under 4 stars: the template sends the drafted reply to the client for approval; this records it and tells Kenny.
async function reviewApproval({ db, job, deps = {} }) {
  const { c, parsed, pick, locationId } = await eventContext(db, job);
  const rating = pick('rating', 'Review Rating', 'Barrier - Review Rating');
  const text = pick('review_text', 'Review Text', 'review', 'Barrier - Review Text');
  const reviewer = pick('reviewer', 'Reviewer Name', 'full_name', 'name');
  await db.query(`insert into barrier.review_events (client_id, ghl_location_id, ghl_contact_id, kind, data) values ($1, $2, $3, 'approval', $4)`,
    [c.id, locationId, parsed.contactId, JSON.stringify({ rating, text, reviewer })]);
  await (deps.notify || alert)('clients', `${c.company} got a ${rating || 'low'}★ review${reviewer ? ` from ${reviewer}` : ''}. The draft reply went to the client to approve.${text ? `\n"${String(text).slice(0, 300)}"` : ''}`);
  return { client: c.id, rating };
}

// Tech photo form in the client sub-account -> photos for Google posts.
async function photoIntake({ db, job }) {
  const { c, raw, pick, locationId } = await eventContext(db, job);
  const urls = new Set();
  const scan = (v) => {
    if (Array.isArray(v)) return v.forEach(scan);
    if (v && typeof v === 'object') return Object.values(v).forEach(scan);
    for (const m of String(v || '').matchAll(/https:\/\/[^\s"',]+/g)) if (/\.(jpe?g|png|webp|heic)(\?|$)/i.test(m[0]) || /photo|image|upload|storage|filesafe|msgsndr/i.test(m[0])) urls.add(m[0]);
  };
  const ev = (await db.query('select payload from barrier.events where id = $1', [job.event_id])).rows[0];
  scan(ev.payload);
  const tech = pick('tech', 'Tech Name', 'Technician', 'Barrier - Tech') || null;
  const note = pick('note', 'Photo Note', 'Note', 'Job Note', 'What was done', 'Barrier - Photo Note') || null;
  for (const url of urls) {
    await db.query(`insert into barrier.photos (client_id, ghl_location_id, url, tech, note) select $1, $2, $3, $4, $5 where not exists (select 1 from barrier.photos where client_id = $1 and url = $3)`,
      [c.id, locationId, url, tech, note]);
  }
  return { client: c.id, photos: urls.size, fields: Object.keys(raw).length };
}

// C1 with "Barrier - Referred By" (a Client ID or company name): the referrer earns a free month.
// Like refunds, credits are Kenny's to apply (DECISIONS.md, Referrals); the bot finds the referrer and tells him.
async function referral({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const ref = String((c.raw_fields || {})['Barrier - Referred By'] || '').trim();
  if (!ref) return { skipped: 'no referrer' };
  const byId = /^\d+$/.test(ref) ? (await db.query('select * from barrier.clients where id = $1', [Number(ref)])).rows[0] : null;
  const byName = byId ? null : (await db.query(`select * from barrier.clients where lower(company) = lower($1) and id <> $2 order by id limit 2`, [ref, c.id])).rows;
  const who = byId || (byName && byName.length === 1 ? byName[0] : null);
  await (deps.notify || alert)('clients', who
    ? `Referral: ${c.company} signed up, referred by ${who.company} (client ${who.id}, ${who.status}). Apply one free month to ${who.company}'s subscription.`
    : `Referral: ${c.company} signed up and named "${ref}" as their referrer, but no single client matches. Check who it is and apply their free month.`);
  return { referrer: who ? who.id : null, given: ref };
}

module.exports = { referral, startMonth1, accessCheck, createSubaccount, softwareTest, softwareSync, reviewDone, reviewDoNotAsk, reviewApproval, photoIntake };
