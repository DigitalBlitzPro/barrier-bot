// Alerts to Kenny's private Slack channels, posted by the "Barrier Bot" Slack app.
// Needs SLACK_BOT_TOKEN (xoxb-...) and the channel IDs below in Railway. Until they are set, alerts only go to the log,
// so nothing breaks before the app exists. An alert never throws: a Slack hiccup must not fail a job.

const CHANNELS = {
  prospects: 'SLACK_CHANNEL_PROSPECTS',               // #barrier-prospects
  onboarding: 'SLACK_CHANNEL_ONBOARDING',             // #barrier-onboarding
  clients: 'SLACK_CHANNEL_CLIENT_MANAGEMENT',         // #barrier-client-management
};

async function alert(channel, text, { fetchImpl = fetch, env = process.env } = {}) {
  const token = env.SLACK_BOT_TOKEN;
  const id = env[CHANNELS[channel]];
  if (!CHANNELS[channel]) throw new Error(`unknown alert channel ${channel}`);
  if (!token || !id) { console.log(`[alert ${channel}] ${text}`); return { sent: false, reason: 'slack not set up' }; }
  try {
    const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: id, text, unfurl_links: false }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { console.error(`[alert ${channel}] Slack refused: ${body.error || res.status}. Text: ${text}`); return { sent: false, reason: body.error }; }
    return { sent: true };
  } catch (e) {
    console.error(`[alert ${channel}] ${e.message}. Text: ${text}`);
    return { sent: false, reason: e.message };
  }
}

module.exports = { alert, CHANNELS };
