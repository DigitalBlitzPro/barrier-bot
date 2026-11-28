// What each GHL webhook path does. Every route: save the event, update the client, queue the work.
// Routes never do slow work themselves; the worker runs the jobs. GHL gets its answer in milliseconds.

const { parseGhlWebhook } = require('./shared/ghlPayload');
const { enqueue } = require('./shared/queue');
const { encrypt } = require('./shared/secrets');

const COLS = new Set(['company', 'owner_name', 'phone', 'email', 'website', 'website_platform', 'gbp_url', 'registered_city',
  'service_cities', 'services_offered', 'growth_services', 'job_software', 'has_phone_system', 'competitors', 'brand_voice',
  'guarantees', 'approved_safety_wording', 'review_requests_now', 'review_tool_name', 'ask_commercial', 'legal_name', 'ein',
  'business_type', 'street_address', 'city', 'state', 'postal_code', 'start_date', 'status', 'plan', 'humor']);

// Statuses only move forward through onboarding; pause and cancel can happen any time.
const ORDER = ['prospect', 'purchased', 'onboarded', 'active'];

async function upsertClient(db, contactId, fields, raw) {
  const cols = Object.keys(fields).filter((c) => COLS.has(c));
  const names = ['ghl_contact_id', ...cols, 'raw_fields'];
  const vals = [contactId, ...cols.map((c) => fields[c]), JSON.stringify(raw || {})];
  const sets = cols.map((c) => c === 'status'
    ? `status = case when array_position($${names.length + 1}::text[], excluded.status) > coalesce(array_position($${names.length + 1}::text[], barrier.clients.status), 0)
         or excluded.status in ('paused','cancelled') then excluded.status else barrier.clients.status end`
    : `${c} = excluded.${c}`);
  sets.push('raw_fields = barrier.clients.raw_fields || excluded.raw_fields', 'updated_at = now()');
  const r = await db.query(
    `insert into barrier.clients (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})
     on conflict (ghl_contact_id) do update set ${sets.join(', ')} returning id, status`,
    cols.includes('status') ? [...vals, ORDER] : vals);
  return r.rows[0];
}

async function saveEvent(db, path, contactId, locationId, body) {
  const r = await db.query(
    `insert into barrier.events (path, ghl_contact_id, ghl_location_id, payload) values ($1, $2, $3, $4) returning id`,
    [path, contactId, locationId, JSON.stringify(body || {})]);
  return r.rows[0].id;
}

function planFromTags(body) {
  const tags = String((body && body.tags) || '').toLowerCase();
  if (tags.includes('barrier-rebuild')) return 'new_website';
  if (tags.includes('barrier-ads-rate')) return 'ads_rate';
  return 'standard';
}

// path -> async (ctx) => result. ctx: { db, body, parsed, eventId }
const ROUTES = {
  // S4: a prospect asked for a Territory Scan.
  'territory-scan': async ({ db, parsed, eventId }) => {
    const c = await upsertClient(db, parsed.contactId, { ...parsed.fields, status: 'prospect' }, parsed.raw);
    await enqueue(db, { type: 'territory_scan', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    return { clientId: c.id };
  },
  // C1: paid. Start the baseline audit so it's ready before the kickoff call.
  'client/create': async ({ db, body, parsed, eventId }) => {
    const c = await upsertClient(db, parsed.contactId, { ...parsed.fields, status: 'purchased', plan: planFromTags(body) }, parsed.raw);
    await enqueue(db, { type: 'baseline_audit', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    await enqueue(db, { type: 'city_conflict_check', clientId: c.id, eventId, dedupeKey: `${parsed.contactId}:create` });
    await enqueue(db, { type: 'set_term', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    return { clientId: c.id };
  },
  // C3: onboarding form in. Now there is an EIN, so the client's GHL sub-account can be made.
  'client/update': async ({ db, parsed, eventId }) => {
    const c = await upsertClient(db, parsed.contactId, { ...parsed.fields, status: 'onboarded' }, parsed.raw);
    await enqueue(db, { type: 'create_subaccount', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    await enqueue(db, { type: 'access_check', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    await enqueue(db, { type: 'city_conflict_check', clientId: c.id, eventId, dedupeKey: `${parsed.contactId}:update` });
    return { clientId: c.id };
  },
  // C5b: kickoff call done. Month 1 starts.
  'client/activate': async ({ db, parsed, eventId }) => {
    const c = await upsertClient(db, parsed.contactId, { status: 'active' }, parsed.raw);
    await enqueue(db, { type: 'start_month1', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    return { clientId: c.id };
  },
  'client/pause': async ({ db, parsed }) => {
    const c = await upsertClient(db, parsed.contactId, { status: 'paused' }, parsed.raw);
    return { clientId: c.id };
  },
  // C8b: a paused client's payment went through. Back to active.
  'client/resume': async ({ db, parsed, eventId }) => {
    const c = await upsertClient(db, parsed.contactId, { status: 'active' }, parsed.raw);
    await enqueue(db, { type: 'resume', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    return { clientId: c.id };
  },
  'client/offboard': async ({ db, parsed, eventId }) => {
    const c = await upsertClient(db, parsed.contactId, { status: 'cancelled' }, parsed.raw);
    await enqueue(db, { type: 'offboard', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    return { clientId: c.id };
  },
  // C12: software API key from the Software Connect form. Encrypted before it touches the database.
  'client/software': async ({ db, parsed, eventId, original }) => {
    const c = await upsertClient(db, parsed.contactId, {}, {});
    const f = parseGhlWebhook(original).raw; // the keys themselves are only in the unredacted body
    const software = f['Barrier - Job Software'] || 'Other';
    const secret = JSON.stringify({ key: f['Barrier - Software API Key'] || null, token: f['Barrier - Software API Token'] || null });
    await db.query(
      `insert into barrier.client_connections (client_id, software, secret_enc, status) values ($1, $2, $3, 'untested')
       on conflict (client_id) do update set software = excluded.software, secret_enc = excluded.secret_enc, status = 'untested', updated_at = now()`,
      [c.id, software, encrypt(secret)]);
    await enqueue(db, { type: 'software_test', clientId: c.id, eventId, dedupeKey: parsed.contactId });
    return { clientId: c.id, software };
  },
  // Client sub-account workflows (template): reviews and photos. Keyed by the sub-account's location id.
  'review/done': async ({ db, parsed, eventId }) => {
    await enqueue(db, { type: 'review_done', eventId, dedupeKey: `${parsed.locationId}:${parsed.contactId}` });
    return {};
  },
  'review/approval': async ({ db, parsed, eventId }) => {
    await enqueue(db, { type: 'review_approval', eventId, dedupeKey: `${parsed.locationId}:${parsed.contactId}:${eventId}` });
    return {};
  },
  'review/do-not-ask': async ({ db, parsed, eventId }) => {
    await enqueue(db, { type: 'review_do_not_ask', eventId, dedupeKey: `${parsed.locationId}:${eventId}` });
    return {};
  },
  photo: async ({ db, eventId }) => {
    await enqueue(db, { type: 'photo_intake', eventId, dedupeKey: String(eventId) });
    return {};
  },
};

// GHL sends EVERY custom field on the contact, including fields from Kenny's other offers (logins, passwords,
// license photos). Only standard contact fields, "Barrier - " fields, customData and workflow info are kept.
// Software API keys are never kept in plain text, not even in the event log.
// The job-software login (Barrier - Software Username/Password) goes to Kenny's password manager, never to the bot.
const SECRET_FIELDS = ['Barrier - Software API Key', 'Barrier - Software API Token', 'Barrier - Software Username', 'Barrier - Software Password'];
const KEEP = new Set(['contact_id', 'first_name', 'last_name', 'full_name', 'name', 'email', 'phone', 'company_name', 'tags',
  'address1', 'city', 'state', 'postal_code', 'country', 'timezone', 'contact_source', 'contact_type', 'date_created',
  'location', 'workflow', 'customData']);
function redact(body) {
  const copy = {};
  for (const [k, v] of Object.entries(body || {})) if (KEEP.has(k) || k.startsWith('Barrier - ')) copy[k] = v;
  if (copy.customData) copy.customData = { ...copy.customData };
  for (const obj of [copy, copy.customData]) if (obj && typeof obj === 'object') for (const k of SECRET_FIELDS) if (k in obj) obj[k] = '[redacted]';
  return JSON.parse(JSON.stringify(copy));
}

async function handle(db, path, body) {
  const route = ROUTES[path];
  if (!route) {
    // Keep it, so a call we can't place is never lost and can be looked at.
    const clean = redact(body);
    const p0 = parseGhlWebhook(clean);
    const eventId = await saveEvent(db, '_unknown', p0.contactId, p0.locationId, clean);
    return { status: 404, body: { error: 'unknown path', path, eventId } };
  }
  const original = body;
  body = redact(body);
  const parsed = parseGhlWebhook(body);
  const needsContact = !['photo', 'review/do-not-ask'].includes(path);
  if (needsContact && !parsed.contactId) return { status: 400, body: { error: 'no contact_id' } };
  const eventId = await saveEvent(db, path, parsed.contactId, parsed.locationId, body);
  const result = await route({ db, body, parsed, eventId, original });
  return { status: 200, body: { ok: true, eventId, ...result } };
}

module.exports = { handle, ROUTES, upsertClient, planFromTags, redact };
