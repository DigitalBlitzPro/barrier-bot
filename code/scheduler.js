// The monthly rhythm. Every hour it looks at each live client and queues what's due. Queuing is idempotent
// (enqueueOnce), so running it twice never doubles the work.
//
// A client's months count from their kickoff (activated_at): month 1 starts that day, month 2 one month later ...
//   day 0 of each month  -> monthly_work      (4 Google posts scheduled weekly, 2 local pages, 1 article)
//   day 26 of each month -> monthly_snapshot  (map grid, AI answers, reviews)
//   day 27 of each month -> monthly_report    (fills the report fields in GHL and tags barrier-report-ready; C6 texts it)
// Clients with a connected job software also get a software_sync every 2 hours (finished jobs -> review asks).

const { enqueueOnce } = require('./shared/queue');

const DAY = 86400000;

function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

// Which client month (0 = month 1) "now" falls in, and when it started.
function currentCycle(activatedAt, now = new Date()) {
  const start = new Date(activatedAt);
  let k = 0;
  while (addMonths(start, k + 1) <= now) k++;
  return { cycle: k, start: addMonths(start, k) };
}

// What should be queued for one client at "now". Pure, so it can be tested.
function dueFor(client, now = new Date()) {
  if (client.status !== 'active' || !client.activated_at) return [];
  const { cycle, start } = currentCycle(client.activated_at, now);
  const out = [{ type: 'monthly_work', dedupeKey: `${client.id}:work:${cycle}`, runAfter: start }];
  const snapAt = new Date(start.getTime() + 26 * DAY);
  const reportAt = new Date(start.getTime() + 27 * DAY);
  if (now >= snapAt) out.push({ type: 'monthly_snapshot', dedupeKey: `${client.id}:snap:${cycle + 1}`, runAfter: snapAt });
  if (now >= reportAt) out.push({ type: 'monthly_report', dedupeKey: `${client.id}:report:${cycle + 1}`, runAfter: reportAt });
  return out;
}

async function tick(db, now = new Date()) {
  const clients = (await db.query(`select id, status, activated_at from barrier.clients where status = 'active'`)).rows;
  let queued = 0;
  for (const c of clients) {
    for (const j of dueFor(c, now)) if (await enqueueOnce(db, { type: j.type, clientId: c.id, dedupeKey: j.dedupeKey, runAfter: j.runAfter })) queued++;
  }
  // Software sync for connected clients, every 2 hours (the key includes the 2-hour slot).
  const slot = Math.floor(now.getTime() / (2 * 3600000));
  const synced = (await db.query(
    `select c.id from barrier.clients c join barrier.client_connections cc on cc.client_id = c.id
     where c.status in ('onboarded','active') and cc.status = 'connected'`)).rows;
  for (const c of synced) if (await enqueueOnce(db, { type: 'software_sync', clientId: c.id, dedupeKey: `${c.id}:sync:${slot}`, maxAttempts: 1 })) queued++;
  return { clients: clients.length, queued };
}

function startScheduler(withDb, { everyMs = 3600000 } = {}) {
  const run = () => withDb((db) => tick(db)).then((r) => r && r.queued && console.log(`[schedule] queued ${r.queued}`)).catch((e) => console.error('[schedule]', e.message));
  setTimeout(run, 30000);
  setInterval(run, everyMs);
}

module.exports = { tick, dueFor, currentCycle, addMonths, startScheduler };
