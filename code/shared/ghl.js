// Writes back to the Digital Blitz GHL account: custom fields and tags on a contact.
// Token: GHL_LOCATION_TOKEN (Private Integration in the Digital Blitz sub-account: Contacts view/edit, Custom Fields view).

const BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = () => process.env.GHL_LOCATION_ID || 'SLKT3cS69kwK14GJePYt';

class Ghl {
  constructor({ token = process.env.GHL_LOCATION_TOKEN, fetchImpl = fetch } = {}) {
    if (!token) throw new Error('GHL_LOCATION_TOKEN is not set');
    this.token = token;
    this.fetch = fetchImpl;
    this.fieldIds = null;
  }

  async call(method, path, body) {
    const res = await this.fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GHL ${method} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  // fieldKey (contact.barrier_scan_link) -> id, read once per run.
  async fieldId(key) {
    if (!this.fieldIds) {
      const r = await this.call('GET', `/locations/${LOCATION_ID()}/customFields`);
      this.fieldIds = Object.fromEntries((r.customFields || []).map((f) => [f.fieldKey, f.id]));
    }
    const id = this.fieldIds[key];
    if (!id) throw new Error(`GHL custom field ${key} not found`);
    return id;
  }

  // fields: { 'contact.barrier_scan_link': 'https://...' }
  async setFields(contactId, fields) {
    const customFields = [];
    for (const [key, value] of Object.entries(fields)) customFields.push({ id: await this.fieldId(key), field_value: value });
    return this.call('PUT', `/contacts/${contactId}`, { customFields });
  }

  // Same as setFields, but by the field's name as shown in GHL ("Barrier - Term End"), for fields whose key we don't know.
  async setFieldsByName(contactId, fields) {
    if (!this.fieldsByName) {
      const r = await this.call('GET', `/locations/${LOCATION_ID()}/customFields`);
      this.fieldsByName = Object.fromEntries((r.customFields || []).map((f) => [String(f.name).trim().toLowerCase(), f.id]));
    }
    const customFields = [];
    for (const [name, value] of Object.entries(fields)) {
      const id = this.fieldsByName[name.trim().toLowerCase()];
      if (!id) throw new Error(`GHL custom field "${name}" not found. Create it in GHL (Settings > Custom Fields) as a text field.`);
      customFields.push({ id, field_value: value });
    }
    return this.call('PUT', `/contacts/${contactId}`, { customFields });
  }

  async addTags(contactId, tags) {
    return this.call('POST', `/contacts/${contactId}/tags`, { tags });
  }
}

module.exports = { Ghl };
