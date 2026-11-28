# Decisions

The one place for every rule. Newest decisions win; date each one.

## Shape (2026-11-24)
- New repo, copied from the Tänder SEO agent where it works. Tänder is not changed.
- One Railway service runs the webhooks, the worker and the schedule. Supabase Postgres, schema `barrier`.
- Fully hands-off: no approval dashboard and no Slack sign-offs. Everything that passes the automatic checks publishes.
  Only failures reach Kenny (see Alerts).
- Google Business Profile posts go out through each client's GHL sub-account (Social Planner), not the Google API.

## Voice (2026-11-24)
- Blogs and Google posts: full comic relief. Puns, bug villains, a wink in every post. Facts stay straight.
- Never invent prices, reviews, awards, stats, licenses or guarantees. Only what the client gave us on the onboarding form.
- Safety wording never blocks a post. Absolute claims ("100% safe", "non-toxic", "harmless", "chemical-free") are swapped
  automatically for friendly wording ("kid- and pet-friendly service"), because some state regulators object to absolute
  claims. If the client gave approved wording on the onboarding form, that wording is used as written.
- Customer-facing name: "Blitz Barrier", never just "Barrier".

## Data (2026-11-24)
- The bot connects to Supabase with the project's main `postgres` login, the same one Tänder uses (Kenny, 2026-11-25). A limited `barrier_bot` login also exists (it can only use the `barrier` tables) if Kenny ever wants to switch; it has no password until he sets one. If the main password is ever reset, update Railway's SUPABASE_DB_URL and Tänder's GitHub secret together.
- Software API keys are encrypted before they are stored (AES-256-GCM, key derived from `BARRIER_SECRETS_KEY`; changing that variable makes stored keys unreadable) and are never written to
  the event log in plain text. GHL clears its copy within 10 minutes (workflow C12).
- The client's GHL sub-account is created after the onboarding form arrives (C3, `client/update`), because it needs the EIN.
- Every webhook body is kept in `barrier.events`, so a job can be re-run from what GHL actually sent, but only standard contact fields, "Barrier - " fields, customData and workflow info. GHL sends every custom field on the contact, including logins and license photos from Kenny's other offers; those are dropped before saving (2026-11-25). The software login and API key fields are blanked.
- A client's status only moves forward (prospect, purchased, onboarded, active); pause and cancel can happen at any time.

## City exclusivity (Nov 25)
- One pest company per city. A city is held by clients with status purchased, onboarded, active or paused; cancelling frees it. Cities compare loosely (`code/shared/city.js`: "St. Petersburg, FL" = "saint petersburg").
- The sales page asks `GET /city-check?city=` before checkout. If the bot can't be reached, the visitor still goes to checkout.
- After C1 and C3 the bot re-checks. A clash adds tag `barrier-city-conflict`, which GHL workflow C14 turns into a Kenny alert. The bot never refunds and never messages the client about it; Kenny decides.
- C8b Payment Recovered calls `client/resume`: the client goes from paused back to active.

## Alerts (Nov 27)
- No texts to Kenny. Alerts go to three private Slack channels: #barrier-prospects, #barrier-onboarding, #barrier-client-management.
- GHL workflows post with the Slack action. The bot posts as the "Barrier Bot" Slack app (`code/shared/alert.js`): SLACK_BOT_TOKEN plus
  SLACK_CHANNEL_PROSPECTS / SLACK_CHANNEL_ONBOARDING / SLACK_CHANNEL_CLIENT_MANAGEMENT (channel IDs) in Railway. Until set, alerts only go to the log.
- A job that fails for good alerts once: Territory Scan to #barrier-prospects, everything else to #barrier-client-management.

## Terms and lifecycle (Nov 28)
- Minimum term: New Website plan 12 months; the standard plan and Ads Client Rate 90 days, then month to month.
- After C1 the bot writes "Barrier - Plan Name" and "Barrier - Term End" (text, e.g. "February 26, 2027") onto the contact, for the cancel-request workflow.
- Paused client: the bot's work for them waits (re-checked daily) until C8b resumes them. Cancelled: their waiting work is dropped.
