# Status (updated 2026-11-28)

## Verified by running it
- `npm test`: 10 tests pass (payload parsing, webhook secret, routes, encryption), no network.
- Against a local Postgres 16 (not Supabase yet): `schema.sql` applies; territory-scan, client/create, client/update,
  client/software and client/pause write the right client status, plan and fields; a repeated webhook does not queue a
  second job; a late Territory Scan does not move an onboarded client back; the software key is stored only encrypted;
  a failed job goes back to pending with a later retry time.

- Live database (2026-11-25): the `barrier` schema is applied in Supabase project `digital-blitz-seo-agent`
  (gsqhoctzennxffbbbxxr) as migration `barrier_base`; the five tables exist and are empty. The public API roles
  (anon, authenticated) have no access to the schema. Tänder's tables were not touched. Row Level Security is on for all five (migration `barrier_enable_rls`, Kenny's OK 2026-11-25); the routes still worked with it on in the local test.

- **Live (2026-11-25):** Railway service at https://barrier-bot-production.up.railway.app (`/health`, `/health/db`). GHL's "BARRIER | Bot URL" points at it. A real Test workflow run of S4 on Kenny's contact arrived: event saved, Kenny saved as a prospect, one `territory_scan` job pending. GHL sometimes drops the path after the Bot URL; the bot then works the path out from the workflow name.

- Territory Scan bot built (2026-11-25): finds the business on Google Maps, checks "pest control" at 49 points (7x7, 1 mile apart), asks ChatGPT, Gemini, Perplexity and Claude 3 homeowner questions, compares reviews with the map leaders, writes a funny verdict (Claude Haiku, facts only), saves the scan, serves it at /scan/<token>, sets Barrier - Scan Link and Barrier - Offer Deadline (+14 days) in GHL and adds barrier-scan-ready. Verified with offline tests (fake DataForSEO and database) and a rendered sample page on phone width. NOT yet run against the real services.
- `/health/keys` checks DataForSEO, Anthropic and GHL with free read-only calls.

- Lifecycle jobs built (2026-11-28, offline tests only): `set_term` (plan name + minimum-term end onto the contact after C1),
  `resume`, `offboard`; the worker holds a paused client's work and skips a cancelled client's. A job that fails for good posts a Slack alert.
  Needs before it works live: GHL text fields "Barrier - Plan Name" and "Barrier - Term End"; the Barrier Bot Slack app token and channel IDs in Railway.

## Not done yet
- Still no handler (jobs wait): baseline_audit, create_subaccount, access_check, start_month1, software_test, review_done,
  review_approval, review_do_not_ask, photo_intake. No monthly report or SEO work job yet.

## Next
1. First real Territory Scan from the live form; check cost and the page.
2. Baseline audit (after purchase).
