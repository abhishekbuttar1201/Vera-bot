# Vera — magicpin AI Challenge submission

A deterministic (no LLM, no randomness) implementation of Vera's 4-context
message composer, exposed as the 5-endpoint HTTP service the judge harness
expects.

> **This implements the real public spec** (`challenge-brief.md` +
> `challenge-testing-brief.md`) — categories, trigger kinds, endpoint
> shapes, and phase behavior all match. **Before submitting**, open the
> actual zip you downloaded from the challenge page (Package tab) and
> diff its two brief files against this README — if magicpin tweaked
> anything for your specific run, only small edits to `server.js` /
> `composer.js` should be needed; the architecture won't need to change.

## 1. Fill these in, then deploy

Open `server.js`, find the `TEAM_METADATA` block near the top, and replace:
- `team_name`, `team_members`, `contact_email` — your real details
- `model` / `approach` — already describes this deterministic approach; edit if you add an LLM

## 2. Run it

```bash
npm install   # no real deps — just confirms Node works
npm test      # runs 24 checks against the real endpoint contract
npm start     # starts on PORT (default 3000)
```
Requires Node 18+. Zero external dependencies.

## 3. Deploy to get a public URL

Needs a host that keeps one **persistent** Node process with in-memory
state (not a stateless serverless function — the bot must remember
context across calls during the 60-minute test window).

**Render.com** (easiest free option)
1. Push this folder to a new GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: empty. Start command: `node server.js`.
4. Deploy → you get `https://your-app.onrender.com`.

**Railway.app**
1. New Project → Deploy from GitHub repo.
2. Auto-detects Node, runs `npm start`.
3. Settings → Networking → generate a public domain.

Submit the base URL (e.g. `https://your-app.onrender.com`) — the judge
hits `{base}/v1/healthz`, `{base}/v1/metadata`, etc.

⚠️ Free Render instances spin down when idle and **lose in-memory
state** on restart. If your test window might hit a cold start, either
upgrade to a paid always-on instance or ping `/v1/healthz` yourself
every few minutes during the window to keep it warm.

## What's implemented

**All 5 endpoints**, matching `challenge-testing-brief.md` §2 exactly:
- `GET /v1/healthz` → `{status, uptime_seconds, contexts_loaded}`
- `GET /v1/metadata` → team info
- `POST /v1/context` → idempotent by `(context_id, version)`; `200` on accept, `409 stale_version` on replay, `400 invalid_scope` on bad scope
- `POST /v1/tick` → composes one action per eligible trigger in `available_triggers`, capped at 20, skips triggers already actioned (restraint)
- `POST /v1/reply` → returns `send` / `wait` / `end`, with real handling for:
  - **auto-reply loops** — 3rd identical (or 2nd canned-looking) reply → graceful `end`
  - **intent transitions** — explicit "yes"/"let's do it" → `send` a concrete next step, never another qualifying question
  - **hostile / off-topic** — de-escalate once, stay on-mission, don't spiral

**The composer** (`composer.js`) covers all canonical trigger kinds from
`challenge-brief.md` §4.3 (`research_digest`, `perf_spike`, `perf_dip`,
`recall_due` / `customer_lapsed_soft`, `festival_upcoming`,
`weather_heatwave`, `competitor_opened`, `category_trend_movement`,
`milestone_reached`, `dormant_with_vera`, `review_theme_emerged`,
`appointment_tomorrow`, `regulation_change`, `local_news_event`,
`scheduled_recurring`), plus a fact-only fallback for anything unlisted
— it never invents a number, offer, or citation that isn't in the
pushed context.

**Consent gating**: a customer-facing message is only composed if
`customer.consent.scope` has at least one recorded purpose — otherwise
the action is suppressed (`body: null`) and skipped from `/v1/tick`'s
output entirely, per the brief's "don't fabricate, don't overreach" rule.

**Anti-repetition**: the store tracks every body already sent in a
conversation; `/v1/reply` will never resend the same text twice.

## Files

| File | Purpose |
|---|---|
| `server.js` | the 5 HTTP endpoints — **edit `TEAM_METADATA` here first** |
| `composer.js` | pure `compose(category, merchant, trigger, customer?)` — one builder per trigger kind |
| `reply-logic.js` | classifies incoming replies → auto-reply / affirmative / negative / hostile / unclear |
| `config.js` | category voice fallbacks + trigger-kind registry (default CTA, customer-capable flag) |
| `store.js` | in-memory versioned context store + per-conversation state |
| `test.js` | 24-check smoke test against the real contract, run before deploying |

## Known gaps / what I'd add with more time

- Only a light heuristic (repeat-count + canned-phrase regex) detects
  auto-replies — a real production system would want a small classifier.
- `research_digest`-style handlers pull the *first* matching digest/trend
  item; a smarter version would rank by relevance to the merchant's
  `signals` before picking one.
- No persistence layer — a restart mid-test loses state. Fine for a
  60-minute window on an always-on host; not production-grade.
