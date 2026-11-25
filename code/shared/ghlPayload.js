// Turns a GHL "Webhook" action body into a clean client record.
// GHL sends standard contact fields at the top level (contact_id, full_name, phone ...) and custom fields
// under their display names ("Barrier - Registered City"). Values can also arrive inside customData.
// Unknown fields are kept in raw_fields, so a renamed field never loses data.

const FIELD_MAP = {
  company: ['company_name', 'Company Name', 'company'],
  owner_name: ['full_name', 'name'],
  phone: ['phone'],
  email: ['email'],
  website: ['Barrier - Website URL', 'website'],
  website_platform: ['Barrier - Website Platform'],
  gbp_url: ['Barrier - GBP URL', 'gbp_url', 'gbp'],
  registered_city: ['Barrier - Registered City'],
  service_cities: ['Barrier - Service Cities'],
  services_offered: ['Barrier - Services Offered'],
  growth_services: ['Barrier - Growth Services'],
  job_software: ['Barrier - Job Software'],
  has_phone_system: ['Barrier - Has Business Phone System'],
  competitors: ['Barrier - Main Competitors'],
  brand_voice: ['Barrier - Brand Voice'],
  guarantees: ['Barrier - Guarantees'],
  approved_safety_wording: ['Barrier - Approved Safety Wording'],
  review_requests_now: ['Barrier - Current Review Requests'],
  review_tool_name: ['Barrier - Review Tool Name'],
  ask_commercial: ['Barrier - Ask Commercial Customers'],
  legal_name: ['Barrier - Legal Business Name'],
  ein: ['Barrier - EIN'],
  business_type: ['Barrier - Business Type'],
  street_address: ['address1', 'street_address', 'Street Address'],
  city: ['city'],
  state: ['state'],
  postal_code: ['postal_code', 'Postal Code'],
  start_date: ['Barrier - Start Date'],
};

const LIST_FIELDS = new Set(['service_cities', 'services_offered', 'growth_services']);
const YES_NO_FIELDS = new Set(['has_phone_system', 'ask_commercial']);

function flatten(body) {
  const out = {};
  const add = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined && v !== '' && typeof v !== 'object') out[k] = v;
    for (const [k, v] of Object.entries(obj)) if (Array.isArray(v)) out[k] = v;
  };
  add(body);
  add(body && body.customData);
  return out;
}

function toList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v).split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
}

function toYesNo(v) {
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return null;
}

function digitsOnly(v) {
  return String(v).replace(/\D/g, '');
}

// Returns { contactId, locationId, fields } where fields only holds values that were actually sent.
function parseGhlWebhook(body) {
  const flat = flatten(body || {});
  const fields = {};
  for (const [col, keys] of Object.entries(FIELD_MAP)) {
    const key = keys.find((k) => flat[k] !== undefined);
    if (key === undefined) continue;
    let v = flat[key];
    if (LIST_FIELDS.has(col)) v = toList(v);
    else if (YES_NO_FIELDS.has(col)) v = toYesNo(v);
    else if (col === 'ein') v = digitsOnly(v);
    else v = String(v).trim();
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    fields[col] = v;
  }
  if (fields.ein && fields.ein.length !== 9) delete fields.ein; // an EIN is always 9 digits; keep junk out
  const contactId = flat.contact_id || flat.contactId || (body && body.contact && body.contact.id) || null;
  const locationId = (body && body.location && body.location.id) || flat.location_id || flat.locationId || null;
  return { contactId, locationId, fields, raw: flat };
}

module.exports = { parseGhlWebhook, FIELD_MAP };
