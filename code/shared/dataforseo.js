// Copied from the Tänder SEO agent (code/shared/dataforseo.js), unchanged.
// DataForSEO client with a hard spend cap, plus pure helpers that find the client's position in a result set.
// The cap lives here, in code: once the month's budget is spent, every further call is refused.

class BudgetExceeded extends Error {}

class DataForSeo {
  constructor({ login, password, budgetUsd, fetchImpl = fetch }) {
    this.auth = Buffer.from(`${login}:${password}`).toString('base64');
    this.budgetUsd = budgetUsd;
    this.spent = 0;
    this.calls = [];
    this.fetch = fetchImpl;
  }

  // Returns the first result object (SERP, Maps, LLM answers and Labs wrap their data in result[0]).
  async post(path, body) {
    return (await this.postAll(path, body))[0] || {};
  }

  // Returns the whole result array (Google Ads search volume returns one item per keyword).
  async postAll(path, body) {
    if (this.budgetUsd != null && this.spent >= this.budgetUsd) {
      throw new BudgetExceeded(`DataForSEO budget of $${this.budgetUsd} reached; refusing ${path}`);
    }
    const res = await this.fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${this.auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(130000),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const cost = Number(json.cost) || 0;
    this.spent += cost;
    this.calls.push({ path, cost });
    const task = json.tasks?.[0];
    if (!res.ok || !task || task.status_code !== 20000) {
      const why = task ? `${task.status_code} ${task.status_message}` : `${json.status_code ?? ''} ${json.status_message ?? ''}`.trim() || `HTTP ${res.status}`;
      throw new Error(`${path}: ${why}`);
    }
    return task.result || [];
  }
}

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hostOf = (domain) => strip(domain).replace(/^www\./, '');

// Position of the client's domain among organic results (null = not found).
function organicPosition(items, domain) {
  const target = hostOf(domain);
  const hit = (items || []).find((i) => i.type === 'organic' && (hostOf(i.domain) === target || hostOf(i.domain).endsWith(`.${target}`)));
  return hit ? hit.rank_group : null;
}

// Position of the client's listing in the Map Pack results (null = not found). Matches on name or website.
function mapPackPosition(items, { domain, nameMatchers }) {
  const target = hostOf(domain);
  const names = nameMatchers.map(strip);
  const hit = (items || []).find((i) => {
    const title = strip(i.title);
    const site = hostOf(i.domain || i.url || '');
    return names.some((n) => title.includes(n)) || (site && site.includes(target));
  });
  return hit ? hit.rank_group : null;
}

module.exports = { DataForSeo, BudgetExceeded, organicPosition, mapPackPosition, strip, hostOf };
