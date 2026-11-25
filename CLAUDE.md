# Project memory (for Claude)

This is **Barrier Bot**, the engine behind Digital Blitz's Blitz Barrier Plan for pest control companies. The operator is Kenny.
It started from the Tänder SEO agent (`DigitalBlitzPro/digital-blitz-seo-agent`): copy what works from there, but this repo is
multi-client, fully automatic and simpler. Never change the Tänder repo from here.

Read first: `STATUS.md`, then `DECISIONS.md`, then `README.md`.

## Working agreements
- One step at a time. Finish and verify a step before starting the next.
- Never ask Kenny to paste a key, token or password into chat. Secrets are Railway variables only. Never print or commit one.
- Plain language. Say what was verified by running it and what was not.
- State a rule once, in `DECISIONS.md`, and point to it.
- Push to `main` only after `npm test` passes. No pull requests unless asked.
- GHL is built by Grok and checked by Claude against the "Barrier GHL Build Spec" doc. Changes to GHL go through that doc, not straight into GHL.

## Traps carried over from Tänder
- DataForSEO Labs endpoints take country-level locations only; ChatGPT answers reject `max_output_tokens`; "near me" searches can come back unlocalized.
- Google Business Profile API: accepting a Manager invite as a service account failed for Tänder (`400 Precondition check failed`). Barrier posts through each client's GHL sub-account instead.
