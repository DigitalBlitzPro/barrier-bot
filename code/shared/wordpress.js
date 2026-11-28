// Publishes a written page or article to a client's WordPress site with an Application Password
// (stored encrypted in barrier.clients.website_login_enc via the client/website-login route).
// Sites that aren't WordPress, or with no login on file, get a preview link instead (see monthlyWork.js).

const { decrypt } = require('./secrets');

function wpLogin(c) {
  if (!c.website_login_enc) return null;
  try {
    const l = JSON.parse(decrypt(c.website_login_enc));
    if (!l.user || !l.appPassword) return null;
    const site = String(l.url || c.website || '').replace(/\/wp-admin.*$/i, '').replace(/\/$/, '');
    return { site: /^https?:\/\//i.test(site) ? site : `https://${site}`, user: l.user, appPassword: l.appPassword };
  } catch { return null; }
}

async function publishToWordPress(login, { kind, page }, fetchImpl = fetch) {
  const auth = Buffer.from(`${login.user}:${String(login.appPassword).replace(/\s+/g, '')}`).toString('base64');
  const type = kind === 'article' ? 'posts' : 'pages';
  const res = await fetchImpl(`${login.site}/wp-json/wp/v2/${type}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: page.title, slug: page.slug, content: page.html, excerpt: page.metaDescription, status: 'publish' }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WordPress ${type}: HTTP ${res.status} ${j.code || ''} ${String(j.message || '').slice(0, 150)}`.trim());
  return { id: String(j.id), url: j.link };
}

module.exports = { wpLogin, publishToWordPress };
