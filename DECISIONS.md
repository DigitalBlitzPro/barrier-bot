# Decisions

The one place for every rule. Newest decisions win; date each one.

## Shape (2026-11-24)
- New repo, copied from the Tänder SEO agent where it works. Tänder is not changed.
- One Railway service runs the webhooks, the worker and the schedule. Supabase Postgres, schema `barrier`.
- Fully hands-off: no approval dashboard and no Slack sign-offs. Everything that passes the automatic checks publishes.
  Only failures reach Kenny, as Todoist tasks.
- Google Business Profile posts go out through each client's GHL sub-account (Social Planner), not the Google API.

## Voice (2026-11-24)
- Blogs and Google posts: full comic relief. Puns, bug villains, a wink in every post. Facts stay straight.
- Never invent prices, reviews, awards, stats, licenses or guarantees. Only what the client gave us on the onboarding form.
- Safety wording never blocks a post. Absolute claims ("100% safe", "non-toxic", "harmless", "chemical-free") are swapped
  automatically for friendly wording ("kid- and pet-friendly service"), because some state regulators object to absolute
  claims. If the client gave approved wording on the onboarding form, that wording is used as written.
- Customer-facing name: "Blitz Barrier", never just "Barrier".

## Data (2026-11-24)
- Software API keys are encrypted before they are stored (AES-256-GCM, key derived from `BARRIER_SECRETS_KEY`; changing that variable makes stored keys unreadable) and are never written to
  the event log in plain text. GHL clears its copy within 10 minutes (workflow C12).
- The client's GHL sub-account is created after the onboarding form arrives (C3, `client/update`), because it needs the EIN.
- Every webhook body is kept in `barrier.events`, so a job can be re-run from what GHL actually sent.
- A client's status only moves forward (prospect, purchased, onboarded, active); pause and cancel can happen at any time.
