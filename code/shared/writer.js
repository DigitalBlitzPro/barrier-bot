// Writes the monthly content: Google posts, local pages and articles. Voice rules (DECISIONS.md, Voice):
// full comic relief, facts straight; never invent prices, reviews, awards, stats, licenses or guarantees;
// absolute safety claims are swapped for friendly wording unless the client gave approved wording.

const { ask } = require('./claude');

// "100% safe" and friends -> friendly wording. Applied to everything before it's saved.
const SAFETY_SWAPS = [
  [/\b100\s?%\s?safe\b/gi, 'kid- and pet-friendly'],
  [/\bcompletely safe\b/gi, 'kid- and pet-friendly'],
  [/\btotally safe\b/gi, 'kid- and pet-friendly'],
  [/\bperfectly safe\b/gi, 'kid- and pet-friendly'],
  [/\bnon-?toxic\b/gi, 'family-friendly'],
  [/\bharmless\b/gi, 'family-friendly'],
  [/\bchemical-?free\b/gi, 'low-impact'],
  [/\bno chemicals\b/gi, 'low-impact products'],
];
function safeWording(text, approved) {
  if (approved && String(approved).trim()) return text; // client's own approved wording wins
  return SAFETY_SWAPS.reduce((t, [re, to]) => t.replace(re, to), String(text));
}

function facts(c) {
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
  return {
    company: c.company, city: c.registered_city || c.city, state: c.state || null, phone: c.phone || null, website: c.website || null,
    services: list(c.services_offered), growthServices: list(c.growth_services), serviceCities: list(c.service_cities),
    guarantees: c.guarantees || null, brandVoice: c.brand_voice || null, approvedSafetyWording: c.approved_safety_wording || null,
    humor: c.humor || 'full',
  };
}

const RULES = `Rules:
- Use ONLY the facts given. Never invent prices, discounts, review counts, star ratings, awards, years in business, licenses, certifications, guarantees, staff names or statistics.
- Guarantees: mention one only if it is in "guarantees", worded as given.
- No absolute safety claims ("100% safe", "non-toxic", "harmless", "chemical-free"). If approvedSafetyWording is given, use that wording; otherwise say "kid- and pet-friendly service".
- Humor level "full": puns, bug villains, a wink in every piece. "light": one light joke. "none": straight. Facts stay straight either way.
- Plain American English, short sentences, written for homeowners. No hashtags, no emojis.
- Never call the company's service "Barrier" or "Blitz Barrier"; that's our product name, not theirs.`;

// Keeps only simple tags (h2, h3, p, ul, ol, li, strong, em, br) and drops every attribute, script and style.
function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)[^>]*>/gi, (m, tag) => {
      const t = tag.toLowerCase();
      if (!['h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'br'].includes(t)) return '';
      return m.startsWith('</') ? `</${t}>` : `<${t}>`;
    });
}

function parseJson(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('writer: no JSON in answer');
  return JSON.parse(m[0]);
}

async function writeGbpPost(c, { topic, photoNote, season }, deps = {}) {
  const f = facts(c);
  const r = await (deps.ask || ask)({
    model: 'claude-haiku-5-5', maxTokens: 900,
    system: `You write Google Business Profile posts for a local pest control company. 80 to 180 words. End with a simple call to action that uses the phone number if given. ${RULES}`,
    prompt: `Company facts (JSON): ${JSON.stringify(f)}\nTopic: ${topic}\nSeason: ${season}\n${photoNote ? `The post goes with a job photo the tech described as: "${photoNote}". Refer to it naturally.` : 'No photo this time.'}\nWrite only the post text.`,
  });
  return { text: safeWording(r.text.trim(), f.approvedSafetyWording), usd: r.usd };
}

async function writePage(c, { kind, service, city, question }, deps = {}) {
  const f = facts(c);
  const what = kind === 'article'
    ? `a helpful blog article (700-1000 words) answering the homeowner question: "${question}". Mention ${f.company} and its area naturally, near the end.`
    : `a local landing page (600-900 words) titled like "${service} in ${city}${f.state ? `, ${f.state}` : ''}" for ${f.company}. Cover: what the problem looks like in ${city}, how the company handles it (only services given), what to expect, a short FAQ (3 questions) specific to ${city}, and a call to action with the phone number if given.`;
  const r = await (deps.ask || ask)({
    model: 'claude-sonnet-5-5', maxTokens: 6000,
    system: `You write website content for a local pest control company. ${RULES}\nReturn JSON only: {"title": "...", "slug": "lowercase-hyphens", "metaDescription": "under 155 characters", "h1": "...", "html": "body HTML using <h2>, <p>, <ul>, <li>, <strong> only"}`,
    prompt: `Company facts (JSON): ${JSON.stringify(f)}\nWrite ${what}`,
  });
  const page = parseJson(r.text);
  for (const k of ['title', 'metaDescription', 'h1', 'html']) page[k] = safeWording(String(page[k] || ''), f.approvedSafetyWording);
  page.html = sanitizeHtml(page.html);
  page.slug = String(page.slug || page.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!page.title || page.html.length < 500) throw new Error('writer: page came back too short');
  return { page, usd: r.usd };
}

// Picks this month's two local pages: growth services first, then the rest; registered city first, then service cities.
// Skips any (service, city) already written.
function pickPages(c, done = [], n = 2) {
  const f = facts(c);
  const services = [...new Set([...f.growthServices, ...f.services].filter((s) => !/^(other|lawn)$/i.test(s)))];
  if (!services.length) services.push('Pest Control');
  const cities = [...new Set([f.city, ...f.serviceCities].filter(Boolean))];
  const seen = new Set(done.map((d) => `${d.service}|${d.city}`.toLowerCase()));
  const out = [];
  for (const city of cities) for (const service of services) {
    if (out.length >= n) return out;
    const key = `${service}|${city}`.toLowerCase();
    if (!seen.has(key)) { out.push({ service, city }); seen.add(key); }
  }
  return out;
}

const ARTICLE_QUESTIONS = [
  'How often should I get pest control service?',
  'Why do ants keep coming back after I spray?',
  'What attracts mice into a house in the fall?',
  'Are pest control treatments safe for kids and pets?',
  'What are the signs of termites in a house?',
  'How do I keep spiders out of my garage?',
  'What should I do before the exterminator comes?',
  'Why do I see more bugs after pest control?',
  'How do I get rid of wasps around my house?',
  'What bugs come out after it rains?',
  'How do I keep mosquitoes out of my yard?',
  'Is it worth getting quarterly pest control?',
];
function pickQuestion(done = []) {
  const used = new Set(done.map((q) => q.toLowerCase()));
  return ARTICLE_QUESTIONS.find((q) => !used.has(q.toLowerCase())) || ARTICLE_QUESTIONS[done.length % ARTICLE_QUESTIONS.length];
}

function seasonOf(date = new Date()) {
  const m = date.getUTCMonth();
  return m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'fall';
}

const POST_TOPICS = {
  winter: ['rodents looking for warm spots', 'keeping pests out while the house is closed up', 'pre-spring prevention', 'why winter service still matters'],
  spring: ['ants waking up', 'termite swarm season', 'spring perimeter treatment', 'wasps building nests'],
  summer: ['mosquitoes in the yard', 'summer ant invasions', 'stinging insects at cookouts', 'keeping bugs out of the kitchen'],
  fall: ['mice moving indoors', 'spiders and fall invaders', 'sealing entry points before winter', 'stink bugs and boxelder bugs'],
};

module.exports = { sanitizeHtml, safeWording, writeGbpPost, writePage, pickPages, pickQuestion, seasonOf, POST_TOPICS, facts, ARTICLE_QUESTIONS };
