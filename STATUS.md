# Status (updated 2026-11-25)

## Verified by running it
- `npm test`: 10 tests pass (payload parsing, webhook secret, routes, encryption), no network.
- Against a local Postgres 16 (not Supabase yet): `schema.sql` applies; territory-scan, client/create, client/update,
  client/software and client/pause write the right client status, plan and fields; a repeated webhook does not queue a
  second job; a late Territory Scan does not move an onboarded client back; the software key is stored only encrypted;
  a failed job goes back to pending with a later retry time.

## Not done yet
- Not deployed. Needs: a Supabase project (or the `barrier` schema in an existing one), a Railway service, and the three
  variables in `.env.example`.
- No bots yet: every queued job waits until its handler exists.

## Next
1. Deploy the base on Railway and point GHL's "BARRIER | Bot URL" custom value at it; fire one test webhook.
2. Territory Scan bot (map grid + AI check + one-page scan for prospects), then the baseline audit.
