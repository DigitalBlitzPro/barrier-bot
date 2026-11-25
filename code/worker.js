// Runs queued jobs one at a time. Each job type has a handler in code/handlers/<type>.js.
// A type with no handler yet stays pending, so nothing is lost while bots are still being built.

const { withDb } = require('./shared/db');
const { claim, finish, fail } = require('./shared/queue');
const handlers = require('./handlers');

async function runOne(db) {
  const job = await claim(db);
  if (!job) return false;
  const handler = handlers[job.type];
  if (!handler) {
    // Not built yet: put it back for later and stop looking this round.
    await db.query(`update barrier.jobs set status = 'pending', attempts = attempts - 1, run_after = now() + interval '1 hour' where id = $1`, [job.id]);
    return false;
  }
  try {
    const result = await handler({ db, job });
    await finish(db, job.id, result);
  } catch (e) {
    const retry = await fail(db, job, e);
    console.error(`[job ${job.id} ${job.type}] ${retry ? 'will retry' : 'FAILED'}: ${e.message}`);
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

module.exports = { startWorker, runOne };
