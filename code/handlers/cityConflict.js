// After a purchase (C1) or onboarding form (C3): if another client already holds this city, tag the contact
// barrier-city-conflict so GHL texts Kenny (workflow C14). Kenny decides on the refund; the bot never refunds.
const { cityHolders } = require('../shared/city');
const { Ghl } = require('../shared/ghl');

async function cityConflictCheck({ db, job, deps = {} }) {
  const c = (await db.query('select id, ghl_contact_id, company, registered_city, city from barrier.clients where id = $1', [job.client_id])).rows[0];
  if (!c) throw new Error(`client ${job.client_id} not found`);
  const city = c.registered_city || c.city;
  if (!city) return { checked: false, reason: 'no city yet' };
  const holders = await cityHolders(db, city, c.id);
  if (!holders.length) return { checked: true, conflict: false };
  if (!deps.skipGhl) await (deps.ghl || new Ghl()).addTags(c.ghl_contact_id, ['barrier-city-conflict']);
  return { checked: true, conflict: true, city, heldBy: holders.map((h) => h.company) };
}

module.exports = { cityConflictCheck };
