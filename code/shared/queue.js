// The job queue in barrier.jobs. A pending job with the same type and dedupe_key is not added twice,
// so GHL retrying a webhook never doubles the work.

async function enqueue(db, { type, clientId = null, eventId = null, dedupeKey = null, runAfter = null, maxAttempts = 3 }) {
  const r = await db.query(
    `insert into barrier.jobs (type, client_id, event_id, dedupe_key, run_after, max_attempts)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6)
     on conflict (type, dedupe_key) where status in ('pending','running') and dedupe_key is not null do nothing
     returning id`,
    [type, clientId, eventId, dedupeKey, runAfter, maxAttempts]);
  return r.rows[0] ? r.rows[0].id : null;
}

// Claims the oldest due job. Returns null when there is nothing to do.
async function claim(db) {
  const r = await db.query(
    `update barrier.jobs set status = 'running', started_at = now(), attempts = attempts + 1
     where id = (select id from barrier.jobs where status = 'pending' and run_after <= now()
                 order by run_after, id limit 1 for update skip locked)
     returning *`);
  return r.rows[0] || null;
}

async function finish(db, id, result) {
  await db.query(`update barrier.jobs set status = 'done', result = $2, error = null, finished_at = now() where id = $1`, [id, result || null]);
}

// A failed job retries with a growing wait (5, 20, 45 minutes ...) until max_attempts, then stays failed.
async function fail(db, job, err) {
  const retry = job.attempts < job.max_attempts;
  await db.query(
    `update barrier.jobs set status = $2, error = $3, finished_at = case when $2 = 'failed' then now() end,
       run_after = now() + ($4 || ' minutes')::interval where id = $1`,
    [job.id, retry ? 'pending' : 'failed', String(err && err.stack || err).slice(0, 4000), String(5 * job.attempts * job.attempts)]);
  return retry;
}

// Queues a job only if one with this type and key has never existed (any status). For scheduled monthly work.
async function enqueueOnce(db, { type, clientId = null, dedupeKey, runAfter = null, maxAttempts = 3 }) {
  const r = await db.query(
    `insert into barrier.jobs (type, client_id, dedupe_key, run_after, max_attempts)
     select $1, $2, $3, coalesce($4::timestamptz, now()), $5
     where not exists (select 1 from barrier.jobs where type = $1 and dedupe_key = $3)
     returning id`,
    [type, clientId, dedupeKey, runAfter, maxAttempts]);
  return r.rows[0] ? r.rows[0].id : null;
}

// Thrown by a bot when something only Kenny can set up is missing (a token, a GHL field, a connected account).
// The worker alerts once and checks again the next day, without using up the job's tries.
class NeedsSetup extends Error {}

module.exports = { enqueue, enqueueOnce, claim, finish, fail, NeedsSetup };
