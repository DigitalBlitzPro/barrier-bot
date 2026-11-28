// Client lifecycle jobs: what the bot does when a client buys, comes back from a pause, or cancels.
// GHL does the texting and tagging; these keep the bot's own work in step.

const { Ghl } = require('../shared/ghl');

const PLAN_NAMES = {
  standard: 'Blitz Barrier Plan',
  new_website: 'Blitz Barrier + New Website',
  ads_rate: 'Blitz Barrier Plan (Ads Client Rate)',
};

// Minimum term (DECISIONS.md): New Website plan 12 months; the others 90 days, then month to month.
function termEnd(startDate, plan) {
  const d = new Date(`${String(startDate).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad start date ${startDate}`);
  if (plan === 'new_website') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 12);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else {
    d.setUTCDate(d.getUTCDate() + 90);
  }
  return d;
}

const pretty = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// After C1: write the plan name and the minimum-term end date onto the contact, so GHL's cancel-request
// workflow can quote them ("You're on the Blitz Barrier Plan; your minimum term runs through May 3, 2027").
async function setTerm({ db, job, deps = {} }) {
  const c = (await db.query('select id, ghl_contact_id, plan, start_date from barrier.clients where id = $1', [job.client_id])).rows[0];
  if (!c) throw new Error(`client ${job.client_id} not found`);
  const plan = c.plan || 'standard';
  const start = c.start_date ? new Date(c.start_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const end = termEnd(start, plan);
  const fields = { 'Barrier - Plan Name': PLAN_NAMES[plan] || PLAN_NAMES.standard, 'Barrier - Term End': pretty(end) };
  if (!deps.skipGhl) await (deps.ghl || new Ghl()).setFieldsByName(c.ghl_contact_id, fields);
  return { plan, start, termEnd: end.toISOString().slice(0, 10), fields };
}

// C8b: a paused client paid. Anything that was waiting because of the pause runs now.
async function resume({ db, job }) {
  const r = await db.query(
    `update barrier.jobs set run_after = now() where client_id = $1 and status = 'pending' and id <> $2 returning id`,
    [job.client_id, job.id]);
  return { released: r.rows.length };
}

// C9: cancelled. Drop any work still waiting for this client. (The city is free again because the status is cancelled.)
async function offboard({ db, job }) {
  const r = await db.query(
    `update barrier.jobs set status = 'done', result = '{"skipped":"client cancelled"}'::jsonb, finished_at = now()
     where client_id = $1 and status = 'pending' and id <> $2 returning id`,
    [job.client_id, job.id]);
  return { dropped: r.rows.length };
}

module.exports = { setTerm, resume, offboard, termEnd, PLAN_NAMES };
