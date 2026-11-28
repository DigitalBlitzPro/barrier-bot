// monthly_work (start of each client month): 4 Google posts scheduled a week apart (with the techs' job photos
// when there are any), 2 local pages and 1 article. Content rules: DECISIONS.md, Voice. Publishing:
//   Google posts -> the client's GHL Social Planner (sub-account token). Missing setup -> NeedsSetup (re-checks daily).
//   Pages/articles -> WordPress when a login is on file; otherwise 'ready' with a preview link and a Slack note.
// Safe to re-run: what already exists for this month is reused, never written twice.

const crypto = require('crypto');
const { loadClient, publicUrl } = require('./measureJobs');
const writer = require('../shared/writer');
const { SubGhl } = require('../shared/subGhl');
const { wpLogin, publishToWordPress } = require('../shared/wordpress');
const { NeedsSetup } = require('../shared/queue');
const { logSpend } = require('../shared/measure');
const { alert } = require('../shared/alert');
const { addMonths } = require('../scheduler');

const DAY = 86400000;
const POSTS = 4;

// Post times: 15:00 UTC (late morning in US time zones), on days 1, 8, 15 and 22 of the client month,
// moved forward if a date has already passed.
function postTimes(start, now = new Date()) {
  const s = new Date(start);
  const base = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 15);
  const soonest = now.getTime() + 2 * 3600000;
  let prev = 0;
  return Array.from({ length: POSTS }, (_, i) => {
    let t = Math.max(base + (1 + 7 * i) * DAY, soonest, prev + DAY);
    prev = t;
    return new Date(t);
  });
}

const token = () => crypto.randomBytes(12).toString('base64url');

async function monthlyWork({ db, job, deps = {} }) {
  const c = await loadClient(db, job.client_id);
  const cycle = Number(String(job.dedupe_key || '').split(':').pop()) || 0;
  const now = deps.now || new Date();
  const ask = deps.ask ? { ask: deps.ask } : {};
  const notify = deps.notify || alert;
  let usd = 0;
  const items = (await db.query('select * from barrier.work_items where client_id = $1 and cycle = $2 order by id', [c.id, cycle])).rows;
  const have = (kind) => items.filter((w) => w.kind === kind);

  // 1. Write the Google posts (saved as drafts first, so a failure later never loses paid-for writing).
  const season = writer.seasonOf(now);
  const topics = writer.POST_TOPICS[season];
  const photos = (await db.query('select id, url, note from barrier.photos where client_id = $1 and used_in is null order by received_at desc limit $2', [c.id, POSTS])).rows;
  for (let i = have('gbp_post').length; i < POSTS; i++) {
    const photo = photos[i] || null;
    const r = await writer.writeGbpPost(c, { topic: topics[i % topics.length], photoNote: photo && (photo.note || 'a job photo'), season }, ask);
    usd += r.usd;
    const row = (await db.query(
      `insert into barrier.work_items (client_id, cycle, kind, status, title, body) values ($1, $2, 'gbp_post', 'draft', $3, $4) returning *`,
      [c.id, cycle, topics[i % topics.length], JSON.stringify({ text: r.text, imageUrl: photo ? photo.url : null, photoId: photo ? photo.id : null })])).rows[0];
    if (photo) await db.query('update barrier.photos set used_in = $2 where id = $1', [photo.id, row.id]);
    items.push(row);
  }

  // 2. Write the local pages and the article.
  const done = (await db.query(`select body from barrier.work_items where client_id = $1 and kind in ('local_page','article') and status <> 'failed'`, [c.id])).rows.map((r) => r.body || {});
  const wantPages = 2 - have('local_page').length;
  if (wantPages > 0) {
    for (const p of writer.pickPages(c, done.filter((b) => b.service).map((b) => ({ service: b.service, city: b.city })), wantPages)) {
      const r = await writer.writePage(c, { kind: 'local_page', service: p.service, city: p.city }, ask);
      usd += r.usd;
      items.push((await db.query(
        `insert into barrier.work_items (client_id, cycle, kind, status, title, body, token) values ($1, $2, 'local_page', 'draft', $3, $4, $5) returning *`,
        [c.id, cycle, r.page.title, JSON.stringify({ ...r.page, service: p.service, city: p.city }), token()])).rows[0]);
    }
  }
  if (!have('article').length) {
    const question = writer.pickQuestion(done.filter((b) => b.question).map((b) => b.question));
    const r = await writer.writePage(c, { kind: 'article', question }, ask);
    usd += r.usd;
    items.push((await db.query(
      `insert into barrier.work_items (client_id, cycle, kind, status, title, body, token) values ($1, $2, 'article', 'draft', $3, $4, $5) returning *`,
      [c.id, cycle, r.page.title, JSON.stringify({ ...r.page, question }), token()])).rows[0]);
  }
  await logSpend(db, { clientId: c.id, jobId: job.id, vendor: 'anthropic', usd });

  // 3. Pages and article: WordPress if we can, otherwise a preview link for Kenny.
  const login = wpLogin(c);
  const waiting = [];
  for (const w of items.filter((x) => ['local_page', 'article'].includes(x.kind) && ['draft', 'ready'].includes(x.status))) {
    if (login) {
      try {
        const out = await (deps.publishToWordPress || publishToWordPress)(login, { kind: w.kind, page: w.body }, deps.fetchImpl);
        await db.query(`update barrier.work_items set status = 'published', published_at = now(), external_id = $2, body = body || jsonb_build_object('url', $3::text), updated_at = now() where id = $1`, [w.id, out.id, out.url]);
        w.status = 'published';
        continue;
      } catch (e) {
        await db.query(`update barrier.work_items set error = $2, updated_at = now() where id = $1`, [w.id, e.message.slice(0, 300)]);
      }
    }
    if (w.status === 'draft') await db.query(`update barrier.work_items set status = 'ready', updated_at = now() where id = $1`, [w.id]);
    w.status = 'ready';
    waiting.push(w);
  }
  if (waiting.length) {
    const first = !items.some((x) => x.body && x.body.noted);
    if (first) {
      await notify('clients', `${c.company}: ${waiting.length} new page${waiting.length > 1 ? 's' : ''} ready to put on ${c.website || 'their site'} ` +
        `(${login ? 'WordPress publishing failed' : 'no WordPress login on file'}):\n${waiting.map((w) => `• ${w.title}: ${publicUrl()}/work/${w.token}`).join('\n')}`);
      await db.query(`update barrier.work_items set body = body || '{"noted":true}'::jsonb where id = any($1::bigint[])`, [waiting.map((w) => w.id)]);
    }
  }

  // 4. Google posts: schedule in the client's Social Planner.
  const drafts = items.filter((x) => x.kind === 'gbp_post' && x.status === 'draft');
  let scheduled = items.filter((x) => x.kind === 'gbp_post' && x.status === 'scheduled').length;
  if (drafts.length) {
    const sub = deps.sub || SubGhl.forClient(c, { fetchImpl: deps.fetchImpl }); // throws NeedsSetup if not set up
    const account = await sub.googleAccount();
    const monthStart = c.activated_at ? addMonths(c.activated_at, cycle) : now;
    const times = postTimes(monthStart, now).slice(POSTS - drafts.length);
    for (const [i, w] of drafts.entries()) {
      const id = await sub.schedulePost({ accountId: account.id || account._id, text: w.body.text, imageUrl: w.body.imageUrl, when: times[i], phone: c.phone });
      await db.query(`update barrier.work_items set status = 'scheduled', scheduled_for = $2, external_id = $3, error = null, updated_at = now() where id = $1`, [w.id, times[i], id]);
      scheduled++;
    }
  }
  return { cycle, posts: scheduled, pagesPublished: items.filter((x) => x.status === 'published').length, pagesWaiting: waiting.length, usd: Math.round(usd * 1000) / 1000 };
}

module.exports = { monthlyWork, postTimes, NeedsSetup };
