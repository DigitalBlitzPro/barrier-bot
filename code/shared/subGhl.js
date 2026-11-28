// Calls into a client's own GHL sub-account with that sub-account's Private Integration token
// (stored encrypted in barrier.clients.ghl_location_token_enc via the client/ghl-token route).
// Scopes the token needs: Social Planner (post write, account read), Users (read), Contacts (read/write), Custom Fields (read).

const { decrypt } = require('./secrets');
const { NeedsSetup } = require('./queue');

const BASE = 'https://services.leadconnectorhq.com';

class SubGhl {
  constructor({ locationId, token, fetchImpl = fetch }) {
    this.locationId = locationId;
    this.token = token;
    this.fetch = fetchImpl;
  }

  static forClient(c, { fetchImpl } = {}) {
    if (!c.ghl_location_id) throw new NeedsSetup(`${c.company} has no GHL sub-account id on file yet. Create the sub-account, then submit its id and token through the sub-account token form.`);
    if (!c.ghl_location_token_enc) throw new NeedsSetup(`${c.company}'s sub-account token is missing. In the sub-account: Settings > Private Integrations > new token (Social Planner, Users, Contacts, Custom Fields), then submit it through the sub-account token form.`);
    return new SubGhl({ locationId: c.ghl_location_id, token: decrypt(c.ghl_location_token_enc), fetchImpl });
  }

  async call(method, path, body, version = '2021-07-28') {
    const res = await this.fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Version: version, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new NeedsSetup(`the sub-account token was refused (HTTP ${res.status}). Make a new token with the right scopes and submit it again.`);
    if (!res.ok) throw new Error(`GHL sub-account ${method} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  // The client's Google Business Profile account in the Social Planner.
  async googleAccount() {
    let r;
    try { r = await this.call('GET', `/social-media-posting/oauth/${this.locationId}/accounts`, null, '2023-02-21'); }
    catch (e) { if (e instanceof NeedsSetup) throw e; r = await this.call('GET', `/social-media-posting/${this.locationId}/accounts`, null, '2023-02-21'); }
    const list = r.results?.accounts || r.accounts || r.results || [];
    const g = (Array.isArray(list) ? list : []).find((a) => /google|gmb|gbp/i.test(String(a.platform || a.type || '')) && !a.isExpired && a.deleted !== true);
    if (!g) throw new NeedsSetup('Google Business Profile is not connected in the client\'s Social Planner. In the sub-account: Marketing > Social Planner > Settings > connect Google Business Profile.');
    return g;
  }

  // A user to post as (required by GHL for posts to OAuth channels).
  async userId() {
    if (this._userId) return this._userId;
    const r = await this.call('GET', `/users/?locationId=${this.locationId}`);
    const users = r.users || [];
    const pick = users.find((u) => /digitalblitzpro\.com$/i.test(u.email || '')) || users.find((u) => (u.roles?.role || u.role) === 'admin') || users[0];
    if (!pick) throw new NeedsSetup('the sub-account has no users to post as.');
    this._userId = pick.id;
    return pick.id;
  }

  // Adds or updates a customer in the client's sub-account and tags them (review-eligible starts the review ask).
  async upsertContact({ firstName, lastName, phone, email, tags = [], source = 'Blitz Barrier' }) {
    const r = await this.call('POST', '/contacts/upsert', {
      locationId: this.locationId, firstName: firstName || undefined, lastName: lastName || undefined,
      phone: phone || undefined, email: email || undefined, tags, source,
    });
    return r.contact?.id || r.id || null;
  }

  async schedulePost({ accountId, text, imageUrl, when, phone }) {
    const media = imageUrl ? [{ url: imageUrl, type: /\.png(\?|$)/i.test(imageUrl) ? 'image/png' : 'image/jpeg' }] : [];
    const r = await this.call('POST', `/social-media-posting/${this.locationId}/posts`, {
      accountIds: [accountId], summary: text, media, type: 'post', status: 'scheduled',
      scheduleDate: new Date(when).toISOString(), userId: await this.userId(),
      gmbPostDetails: { gmbEventType: 'STANDARD', actionType: phone ? 'call' : 'none' },
    }, '2023-02-21');
    return r.results?.post?._id || r.results?._id || r.post?._id || r.id || r._id || null;
  }
}

module.exports = { SubGhl };
