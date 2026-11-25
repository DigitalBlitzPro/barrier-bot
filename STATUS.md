# Status (updated 2026-11-25)

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

## Not done yet
- No bots yet: every queued job waits until its handler exists.

## Next
1. Territory Scan bot (map grid + AI check + one-page scan for prospects), then the baseline audit.
