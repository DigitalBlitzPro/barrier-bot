// Asks AI assistants (through DataForSEO LLM Responses) and checks whether a business is named or cited.
// evaluateAnswer and flattenAnswer are copied from the Tänder SEO agent (code/ranking-tracker/aiPanel.js).
const { strip, hostOf } = require('./dataforseo');

// Same pinned models as Tänder, so results compare. DataForSEO retires models; update here if a call fails with 40501.
const ENGINES = {
  chat_gpt: { label: 'ChatGPT', model: 'gpt-5.4-mini-2026-03-17' },
  gemini: { label: 'Gemini', model: 'gemini-3.8-flash' },
  perplexity: { label: 'Perplexity', model: 'sonar' },
  claude: { label: 'Claude', model: 'claude-haiku-5-5' },
};

function flattenAnswer(result) {
  const texts = [];
  const links = [];
  for (const item of result?.items || []) {
    for (const s of item.sections || []) {
      if (s.text) texts.push(s.text);
      for (const a of s.annotations || []) links.push({ title: a.title || '', url: a.url || '' });
    }
  }
  return { text: texts.join(' '), links };
}

function evaluateAnswer(result, { domain, nameMatchers }) {
  const { text, links } = flattenAnswer(result);
  const names = nameMatchers.map(strip).filter(Boolean);
  const target = domain ? hostOf(domain) : '';
  const textMention = names.some((n) => strip(text).includes(n));
  const cited = !!target && links.some((l) => hostOf(l.title).includes(target) || hostOf(l.url).includes(target));
  return { mentioned: textMention || cited, text };
}

// Which of the known local competitors an answer names (to show who the AI picked instead).
function competitorsNamed(text, competitorNames) {
  const t = strip(text);
  return competitorNames.filter((n) => n && t.includes(strip(simpleName(n))));
}

// "ABC Pest Control - Grand Rapids" -> "abc pest control": drop location tails so name matching works.
function simpleName(name) {
  return String(name || '').split(/\s[-|–]\s|,/)[0].replace(/\b(llc|inc|co)\.?$/i, '').trim();
}

async function askAll({ dfs, questions, brand, competitorNames = [], concurrency = 4, log = () => {} }) {
  const jobs = [];
  for (const q of questions) for (const [engine, e] of Object.entries(ENGINES)) jobs.push({ engine, model: e.model, question: q });
  const out = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const { engine, model, question } = jobs[i];
      const base = { user_prompt: question, model_name: model, web_search: true };
      const body = engine === 'chat_gpt' ? base : { ...base, max_output_tokens: 600 };
      try {
        let result;
        for (let attempt = 0; ; attempt++) {
          try { result = await dfs.post(`ai_optimization/${engine}/llm_responses/live`, body); break; } catch (e) {
            if (attempt >= 2 || !/Internal|rate_limit|50301|temporar|timeout/i.test(e.message)) throw e;
            await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
          }
        }
        const ev = evaluateAnswer(result, brand);
        out[i] = { engine, question, mentioned: ev.mentioned, named: competitorsNamed(ev.text, competitorNames).slice(0, 3) };
      } catch (e) {
        log(`AI check ${engine}: ${e.message}`);
        out[i] = { engine, question, error: e.message.slice(0, 160) };
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

module.exports = { ENGINES, askAll, evaluateAnswer, flattenAnswer, competitorsNamed, simpleName };
