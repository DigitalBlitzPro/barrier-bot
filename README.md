# Barrier Bot

Runs the **Blitz Barrier Plan** for pest control clients: Google Maps, Google search and AI-assistant recommendations, fully hands-off.
GHL sells the plan, onboards the client and sends the texts. This bot does the recurring work and reports back.

Read [STATUS.md](STATUS.md) for what works today and [DECISIONS.md](DECISIONS.md) for how it is meant to work.
The full offer is in Kenny's Google Doc "The Blitz Barrier Plan"; the GHL side is in "Barrier GHL Build Spec (for Grok)".

## How it runs

One always-on Node process on Railway (`npm start`):

- **Webhook server.** GHL's workflows call `{{custom_values.barrier_bot_url}}/<path>`. The custom value is
  `https://<railway-app>/hook/<BARRIER_WEBHOOK_SECRET>`. Each call is saved to `barrier.events`, the client row is updated and the work is queued. GHL gets its answer right away.
- **Worker.** Every 15 seconds it runs due jobs from `barrier.jobs`, one at a time. A failed job retries (5, 20, 45 minutes), then stays failed for review. A job type with no bot yet waits.
- **Data.** Supabase Postgres, schema `barrier` (`schema.sql`).

| GHL workflow | Path | What it queues |
|---|---|---|
| S4 Territory Scan | `territory-scan` | `territory_scan` |
| C1 Purchase | `client/create` | `baseline_audit`, `city_conflict_check`, `set_term` |
| C3 Onboarding Submitted | `client/update` | `create_subaccount`, `access_check`, `city_conflict_check` |
| C5b Kickoff Outcome (Showed) | `client/activate` | `start_month1` |
| C8 Payment Failed (day 10) | `client/pause` | nothing; the client's waiting work holds |
| C8b Payment Recovered | `client/resume` | `resume` |
| C9 Cancelled | `client/offboard` | `offboard` |
| C12 Software Connect | `client/software` | `software_test` (key stored encrypted) |
| Template: Review Done Reply | `review/done` | `review_done` |
| Template: Negative Review Approval | `review/approval` | `review_approval` |
| Template: Do Not Ask | `review/do-not-ask` | `review_do_not_ask` |
| Template: Tech Photo Intake | `photo` | `photo_intake` |

## Layout

```
code/server.js       webhook server (and starts the worker)
code/routes.js       what each path does
code/worker.js       runs queued jobs
code/handlers/       one file per job type (the bots), registered in index.js
code/shared/         database, queue, GHL payload parsing, encryption
schema.sql           every table, mirrors the live database
test/                npm test, no network
```

## Run it

```
npm ci        # Node 22
npm test
```
