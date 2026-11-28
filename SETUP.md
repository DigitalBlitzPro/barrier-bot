# Setup Kenny needs to do (Barrier Bot)

Everything the bot can't do on its own. Until an item is done, the work that needs it waits and re-checks daily,
and #barrier-onboarding hears about it once. Never paste keys into chat; they go in Railway variables or GHL forms only.

## 1. Railway variables (barrier-bot service)
- [ ] `SLACK_BOT_TOKEN` (the Barrier Bot Slack app, scope `chat:write`, invited to the three channels)
- [ ] `SLACK_CHANNEL_PROSPECTS`, `SLACK_CHANNEL_ONBOARDING`, `SLACK_CHANNEL_CLIENT_MANAGEMENT` (channel IDs, start with C)
- [ ] Optional, to make client sub-accounts automatically: `GHL_AGENCY_TOKEN` (agency Private Integration, Locations write),
      `GHL_COMPANY_ID`, `GHL_SNAPSHOT_ID` (the Barrier template snapshot). Without them, make sub-accounts by hand (step 3).
- [ ] Optional: `BARRIER_PUBLIC_URL` if the bot moves off the Railway address (dashboard links use it).

## 2. GHL custom fields in Digital Blitz (text fields, exact names)
- [ ] Barrier - Plan Name
- [ ] Barrier - Term End
- [ ] Barrier - Subaccount ID
- [ ] Barrier - Subaccount Token
- [ ] Barrier - Website Login URL
- [ ] Barrier - Website Username
- [ ] Barrier - Website App Password
- [ ] Barrier - Software Subdomain (FieldRoutes clients: the part before .fieldroutes.com; add it to the C12 form)
- [ ] Barrier - Referred By (optional field on the checkout/onboarding form)

## 3. Per client, after onboarding
- [ ] Sub-account from the Barrier template (by hand, or automatic with step 1's agency variables).
- [ ] In the sub-account: Settings > Private Integrations > new token with Social Planner (posts write, accounts read),
      Users (read), Contacts (read/write), Custom Fields (read).
- [ ] In the sub-account: Marketing > Social Planner > connect the client's Google Business Profile.
- [ ] Submit the sub-account id and token through a small internal form (new workflow "BARRIER | Sub-account Token",
      Webhook to `{{custom_values.barrier_bot_url}}/client/ghl-token`). Waiting work starts within a minute.
- [ ] WordPress sites: the client makes an Application Password (Users > Profile) and submits it with a
      "BARRIER | Website Login" workflow to `/client/website-login`. Other sites: pages arrive as preview links in
      #barrier-client-management to paste in.

## 4. Barrier template sub-account
- [ ] Reviews AI auto-reply ON (the report's "Replies" number assumes it).
- [ ] Review Engine, Negative Review Approval, Do Not Ask and Tech Photo workflows send Custom Data:
      `tech`, `rating`, `review_text`, `reviewer`, `photo_url`, `note` (whichever apply).

## 5. Decisions still open
- [ ] Subject lines: lowercase on nurture emails (S1/S2) and capitalized on client emails, or capitalize everything?
- [ ] Pages publish straight to WordPress as live pages. Say if you'd rather they go up as drafts for a look first.

## 6. After QA
- [ ] Delete the temporary GHL private integration key used for QA.
