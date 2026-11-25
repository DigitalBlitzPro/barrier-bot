// One short Anthropic call (no tools). Used for small writing jobs like the scan verdict.
const PRICES = { 'claude-haiku-5-5': { input: 0.1, output: 0.5 }, 'claude-sonnet-5-5': { input: 2, output: 10 } };

async function ask({ model = 'claude-haiku-5-5', system, prompt, maxTokens = 400, fetchImpl = fetch }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic: HTTP ${res.status} ${json.error?.message || ''}`.trim());
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const p = PRICES[model] || { input: 0, output: 0 };
  const usd = ((json.usage?.input_tokens || 0) * p.input + (json.usage?.output_tokens || 0) * p.output) / 1e6;
  return { text, usd };
}

module.exports = { ask };
