// Quick website check for the month-1 audit: is the site up, on https, fast enough, and does the home page say
// what Google and AI assistants need (title, description, one H1, phone, city, mobile viewport, LocalBusiness schema)?
// Plain fetch, no browser. Findings are written in plain words for the client report.

async function fetchPage(url, fetchImpl = fetch) {
  const started = Date.now();
  const res = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlitzBarrierBot/1.0)' }, signal: AbortSignal.timeout(25000) });
  const html = await res.text();
  return { status: res.status, finalUrl: res.url || url, ms: Date.now() - started, html: html.slice(0, 600000) };
}

const tag = (html, re) => { const m = re.exec(html); return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null; };

function analyze(page, { city, phone, company }) {
  const html = page.html || '';
  const lower = html.toLowerCase();
  const title = tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = (/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) || /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html) || [])[1] || null;
  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  const pageDigits = html.replace(/\D/g, '');
  const cityName = String(city || '').split(',')[0].trim().toLowerCase();
  const checks = [
    { id: 'up', ok: page.status >= 200 && page.status < 400, fix: `The home page answered with an error (${page.status}).` },
    { id: 'https', ok: /^https:/i.test(page.finalUrl), fix: 'The site does not load on a secure (https) address.' },
    { id: 'speed', ok: page.ms < 3000, fix: `The home page took ${(page.ms / 1000).toFixed(1)} seconds to load; under 3 is the goal.` },
    { id: 'title', ok: !!title && title.length >= 15 && title.length <= 65, fix: title ? `The page title is ${title.length} characters ("${title.slice(0, 70)}"); 15 to 65 with the city in it works best.` : 'The home page has no title.' },
    { id: 'title_city', ok: !!title && !!cityName && title.toLowerCase().includes(cityName), fix: `The page title doesn't mention ${city}.` },
    { id: 'description', ok: !!description && description.length >= 70, fix: 'The home page has no proper Google description (meta description).' },
    { id: 'h1', ok: h1s === 1, fix: h1s ? `The home page has ${h1s} main headings (H1); it should have one.` : 'The home page has no main heading (H1).' },
    { id: 'phone', ok: !digits || pageDigits.includes(digits), fix: 'Your phone number is not on the home page as text.' },
    { id: 'city', ok: !cityName || lower.includes(cityName), fix: `The home page never mentions ${city}.` },
    { id: 'viewport', ok: /<meta[^>]+name=["']viewport["']/i.test(html), fix: 'The site is not set up for phones (no mobile viewport).' },
    { id: 'schema', ok: /"@type"\s*:\s*"(LocalBusiness|PestControl|HomeAndConstructionBusiness|ProfessionalService)"/i.test(html), fix: 'The site has no business details for Google (LocalBusiness schema).' },
  ];
  const passed = checks.filter((c) => c.ok).length;
  return { url: page.finalUrl, status: page.status, ms: page.ms, title, description, h1s, company, score: Math.round((passed / checks.length) * 100), checks };
}

async function checkSite({ website, city, phone, company }, fetchImpl = fetch) {
  if (!website) return { skipped: 'no website on file' };
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try {
    return analyze(await fetchPage(url, fetchImpl), { city, phone, company });
  } catch (e) {
    return { url, error: e.message.slice(0, 200), score: 0, checks: [{ id: 'up', ok: false, fix: `The site could not be reached (${e.message.slice(0, 80)}).` }] };
  }
}

module.exports = { checkSite, analyze };
