// Runs queued jobs one at a time. Each job type has a handler in code/handlers/<type>.js.
// A type with no handler yet stays pending, so nothing is lost while bots are still being built.
// Paused clients: their work waits (checked again daily). Cancelled clients: their work is skipped.
// The lifecycle jobs themselves (resume, offboard) always run.
// A job that fails for good posts a Slack alert (scan failures to #barrier-prospects, the rest to #barrier-client-management).

const { withDb } = require('./shared/db');
const { claim, finish, fail } = require('./shared/queue');
const { alert } = require('./shared/alert');
const handlers = require('./handlers');

const ALWAYS_RUN = new Set(['resume', 'offboard']);

async function clientOf(db, job) {
  if (!job.client_id) return null;
  return (await db.query('select id, status, company, ghl_contact_id from barrier.clients where id = $1', [job.client_id])).rows[0] || null;
}

async function failureAlert(job, client, err, notify) {
  const who = client ? `${client.company || 'unknown company'} (contact ${client.ghl_contact_id})` : 'no client';
  const why = String((err && err.message) || err).split('\n')[0].slice(0, 300);
  if (job.type === 'territory_scan') {
    return notify('prospects', `Territory Scan failed for ${who} after ${job.attempts} tries. The prospect has NOT been sent a scan. Reason: ${why}`);
  }
  return notify('clients', `Bot job failed: ${job.type} for ${who} (job ${job.id}, ${job.attempts} tries). Reason: ${why}`);
}

async function runOne(db, { notify = alert, list = handlers } = {}) {
  const job = await claim(db);
  if (!job) return false;
  const handler = list[job.type];
  if (!handler) {
    // Not built yet: put it back for later and stop looking this round.
    await db.query(`update barrier.jobs set status = 'pending', attempts = attempts - 1, run_after = now() + interval '1 hour' where id = $1`, [job.id]);
    return false;
  }
  const client = await clientOf(db, job);
  if (client && !ALWAYS_RUN.has(job.type)) {
    if (client.status === 'cancelled') {
      await finish(db, job.id, { skipped: 'client cancelled' });
      return true;
    }
    if (client.status === 'paused') {
      await db.query(`update barrier.jobs set status = 'pending', attempts = attempts - 1, run_after = now() + interval '1 day' where id = $1`, [job.id]);
      return true;
    }
  }
  try {
    const result = await handler({ db, job });
    await finish(db, job.id, result);
  } catch (e) {
    const retry = await fail(db, job, e);
    console.error(`[job ${job.id} ${job.type}] ${retry ? 'will retry' : 'FAILED'}: ${e.message}`);
    if (!retry) await failureAlert(job, client, e, notify);
  }
  return true;
}

function startWorker({ everyMs = 15000 } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { while (await withDb(runOne)) { /* keep going while there is work */ } }
    catch (e) { console.error('[worker]', e.message); }
    finally { busy = false; }
  };
  setInterval(tick, everyMs);
  tick();
}

module.exports = { startWorker, runOne, failureAlert };
