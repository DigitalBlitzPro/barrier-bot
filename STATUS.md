# Status (updated 2026-11-28)

## Verified by running it
- `npm test`: 44 tests pass, no network (fakes for DataForSEO, Anthropic, GHL, FieldRoutes, the database).
- Live database: schema `barrier` in Supabase gsqhoctzennxffbbbxxr, RLS on. Migration `barrier_monthly_work` (snapshots,
  work_items, photos, review_events, new client columns) applied 2026-11-28.
- Live service: https://barrier-bot-production.up.railway.app. A real S4 test webhook arrived and queued a scan (Nov 25).
- Territory Scan: offline tests and a rendered page only. NOT yet run against the real services.

## Built, offline tests only (not run live)
- Lifecycle: `set_term`, `resume`, `offboard`; paused clients' work waits, cancelled clients' work is dropped; Slack alert on final failure.
- Monthly: scheduler, `baseline_audit` (map grid, AI answers, reviews, website check), `monthly_snapshot`, `monthly_report`,
  `monthly_work` (writer with voice rules, Social Planner scheduling, WordPress publishing or previews), dashboard `/dash/<token>`.
- Onboarding: `start_month1`, `access_check`, `create_subaccount` (needs agency env), routes `client/ghl-token`, `client/website-login`.
- Reviews: `software_test`, `software_sync` (FieldRoutes, GorillaDesk), `review_done`, `review_do_not_ask`, `review_approval`, `photo_intake`, `referral`.
- Setup-needed jobs wait daily and alert #barrier-onboarding once.

## Not verified (assumptions to check on the first live run)
- GHL Social Planner: accounts path and the Google platform value; posts need a userId (taken from the sub-account's users).
- GorillaDesk field names (customer phone/email, tech) and auth header; FieldRoutes `dateCompleted` filter and `employee/search` as the key test.
- GHL create-location with an agency token and snapshot id.
- WordPress Application Password publishing.

## Waiting on Kenny
See `SETUP.md`.

## Next
1. Kenny's setup items, then a first real Territory Scan and one test client end to end.
