# AgentGuard: phase-by-phase build & launch guide

**Today:** Tue Oct 20, 2026 · **Target submission:** Tue Nov 10 · **Hard deadline:** Thu Nov 12, 12:00 PM PST (Fri Nov 13, 1:30 AM IST)

Legend: ✅ built and verified locally · 🟡 built, needs your keys/accounts to verify against the real service · 🧑 a step only you can do (accounts, keys, deploy, video, submission)

---

## Where things stand

| Phase | What | Status |
|---|---|---|
| 0 | Accounts & keys (PayPal, Anthropic, Telegram, GitHub, Devpost) | 🧑 |
| 1 | Monorepo, local Postgres, one-command dev | ✅ |
| 2 | PayPal money flow: authorize → capture / void, Vault, fallback | ✅ mock · 🟡 sandbox |
| 3 | Policy engine, risk engine, decision function + tests | ✅ |
| 4 | Webhooks with signature verification | ✅ mock · 🟡 sandbox |
| 5 | AI layer: compiler, intent, injection, categorizer, explainer | ✅ heuristics · 🟡 Claude |
| 6 | MCP server (incl. guarded PayPal Agent Toolkit), demo stores, demo agent, **Try it** page | ✅ scripted · 🟡 LLM agent · 🟡 toolkit on sandbox |
| 7 | Telegram approvals + timeout job | ✅ code · 🟡 live bot |
| 8 | Dashboard: live feed, policies, AG Grid audit, budgets, threats, setup | ✅ |
| 9 | Deploy to Render | 🧑 (blueprint ready) |
| 10 | Polish, README, Postman | ✅ drafted · 🧑 final pass |
| 11 | Demo video | 🧑 |
| 12 | Devpost submission | 🧑 |

**Verified here (no keys):** `npm test` (60 passing), the four **Try it** scenarios run from the browser (attack blocked, approval → captured, ops agent: toolkit refund executed while the injected refund and dispute were blocked, unguarded → $1,000.99), per-IP rate limits returning 429s, and typecheck of every package, `next build`, and a full local run in mock mode: approve → captured, MegaDealz attack → blocked with all three hidden techniques identified, agent recovers at FreshCart, $129 headphones → held → approved from the dashboard → captured, unguarded agent → $1,000 of gift cards, mock Vault onboarding redirect, MCP `tools/list`.

**Not verified yet (needs your accounts):** real PayPal sandbox calls (Vault, Orders, webhooks, reporting), Claude API calls, the Telegram bot, and the Render deploy. The code for all of these is written against the documented APIs; Phases 2, 4, 5, 7 and 9 tell you exactly how to check each one.

---

## What the official rules mean for us (checked Oct 20)

From paypalaihackathon.devpost.com (overview, rules, resources):

- **Dates:** submissions close **Thu Nov 12, 12:00 PM PT**. **Judging runs Dec 1–15**, and winners are announced around Dec 21. The hosted demo must stay up until Dec 15.
- **Stage 1 (pass/fail):** the project must fit the theme and meaningfully use PayPal *and* AI. **Stage 2:** five **equally weighted** criteria: Technological Implementation, Design, Potential Impact, Innovation, Presentation. Ties are broken by Technological Implementation first.
- **Judges may score from the text, images and video alone**, so the video and the Devpost description carry as much weight as the code.
- **Functional demo is mandatory:** a hosted URL *or* complete run instructions, plus any test credentials or sandbox logins in the README. Mock mode (runs with no keys) already covers the second option.
- **Prize limits:** a project can win **one** Grand *or* Honorable Mention prize **plus one** sponsor prize. Target AG Grid (up to $5,000) as the sponsor prize; Render pays only in credits. **Postman has no prize** (the collection is still useful for judges).
- **Resources the PayPal judges point to:** the **PayPal Agent Toolkit** and **PayPal MCP server**. AgentGuard doesn't use them yet (see R2 below).
- **Video:** under 3 minutes, public on YouTube, no copyrighted music or third-party trademarks without permission.

## Remaining work to win

**You (accounts, deploy, submission):**

| # | Task | Why it matters | When |
|---|---|---|---|
| Y1 | Join the hackathon on Devpost; push the repo to a **public** GitHub repo | Required; GitHub shows the MIT license in the About section | Oct 21 |
| Y2 | PayPal sandbox app + accounts (Phase 0). In the app's **Features**, enable **Vault / save payment methods** and **Transaction search** | Without Transaction search, reconciliation gets 403s; without Vault, use the fallback flow | Oct 21 |
| Y3 | Run Phases 2 and 4 against the real sandbox and send me any error output | **Biggest technical risk:** the real PayPal calls haven't been exercised yet | Oct 22–25 |
| Y4 | Add `ANTHROPIC_API_KEY`, run Phase 5; add the Telegram token, run Phase 7 | Verifies the AI layer and phone approvals | Oct 27 – Nov 2 |
| Y5 | Deploy on Render with a database that **won't expire during judging**: a paid Render Postgres plan, or an external free Postgres such as Neon (set `DATABASE_URL`) | Free Render Postgres expires 30 days after creation, which lands inside Dec 1–15 | Nov 5 |
| Y6 | Ask AG Grid for a license key (sponsor resources / Discord) | Removes the trial watermark from the video and hosted demo | Before Nov 8 |
| Y7 | Record the video (Phase 11), write the Devpost text, add screenshots and test instructions | Presentation is 1/5 of the score, and judges may rely only on these | Nov 8–10 |

**Code (I can build these):**

| # | Task | Criteria it helps |
|---|---|---|
| ✅ R1 | **"Try it" page in the dashboard** (done Oct 20): buttons that run each demo scenario on the server (attack blocked, phone approval, unguarded) and stream the agent's log, plus a **Reset demo** button. Today the agent can only be run from a terminal, so a judge on the hosted site can't trigger anything. | Functional demo, Design, Best Demo Delivery |
| ✅ R2 | **PayPal Agent Toolkit integration** (done Oct 20): all 47 toolkit tools on AgentGuard's MCP under their own names. Read-only ones pass through; refunds, disputes, cancellations, invoices and orders go through the firewall and approvals. Includes a merchant ops-agent scenario. Change from the plan: the toolkit is merchant-side and its orders need payer approval, so the unguarded "before" scene stays the simulated store checkout. | Technological Implementation, Best Use of PayPal + AI, Agentic Commerce |
| ✅ R3 | **Abuse protection for the public demo** (done Oct 20): rate limits on the endpoints that call Claude (policy compile, payment requests) | Stops strangers or bots burning your Anthropic credits during judging |
| R4 | **AG Grid prize polish**: AG Charts on the Budgets page, sparklines or integrated charts in the audit grid | Best Use of AG Grid |
| R5 | **Refund button** in the audit grid and a **policy simulator** UI (both APIs already exist) | Design, Technological Implementation |
| R6 | **Phone-width pass** on Live and the approval cards, favicon and social preview image | Design, video quality |

R1–R3 are done. Next: R4–R6, plus verifying the toolkit calls against the real sandbox (Y3). Leave Nov 11–12 as buffer.

---

## Phase 0: Accounts & keys 🧑 (Oct 20–21)

1. **Devpost**: register for the PayPal AI Hackathon 2026.
2. **PayPal Developer**: sign in at developer.paypal.com → **Apps & Credentials** → **Sandbox** → **Create App**. Copy the **Client ID** and **Secret**.
3. **Sandbox accounts** (developer dashboard → Sandbox → **Accounts** → Create account):
   - 1 **Personal** account: the user's wallet the agent spends from. Note its email and password (sandbox only).
   - 3 **Business** accounts: FreshCart, GadgetHub, MegaDealz. Copy their emails.
4. **App features**: in your app's settings, enable saving payment methods (**Vault**) and **Transaction search** (needed for the reporting/reconciliation calls). If your sandbox app doesn't offer Vault, use the fallback flow (Phase 2, step 6).
5. **Anthropic**: create an API key at console.anthropic.com.
6. **Telegram**: in Telegram, message **@BotFather** → `/newbot` → copy the bot token.
7. **GitHub**: create a **public** repo named `agentguard`. The MIT `LICENSE` is already in the repo root.

Fill in `.env` (copied from `.env.example`):

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_MERCHANT_FRESHCART=<business sandbox email>
PAYPAL_MERCHANT_GADGETHUB=<business sandbox email>
PAYPAL_MERCHANT_MEGADEALZ=<business sandbox email>
ANTHROPIC_API_KEY=...
TELEGRAM_BOT_TOKEN=...
```

Then push the code:

```bash
git add -A
git commit -m "AgentGuard: initial build"
git remote add origin https://github.com/<you>/agentguard.git
git push -u origin main
```

**Done when:** `.env` is filled in and the repo is public on GitHub. `.env` is git-ignored; never commit it.

---

## Phase 1: Monorepo & local run ✅

**Built:** npm workspaces (`apps/api`, `apps/dashboard`, `apps/stores`, `apps/demo-agent`, `packages/shared`), TypeScript everywhere, Prisma schema + first migration, seed data, `docker-compose.yml`, and `scripts/local-db.mjs` (a real PostgreSQL without Docker, UTF-8).

```bash
npm install
cp .env.example .env          # skip if you already have one
npm run db:local              # terminal 1, keep it open (or: docker compose up -d)
npm run db:migrate            # first time only
npm run seed
npm run dev                   # terminal 2: API :4000, dashboard :3000, stores :3001
```

**Done when:** http://localhost:3000 loads and the header badges show `PayPal mock` / `AI: heuristics` (until you add keys).

> npm 11 asks before running package install scripts. The ones this project needs (Prisma, esbuild, embedded-postgres) are already approved in `package.json` → `allowScripts`.

---

## Phase 2: PayPal money flow ✅ mock · 🟡 sandbox (Oct 21–22)

**Built** (`apps/api/src/paypal/`):
- `auth.ts`: OAuth client-credentials token, cached until expiry.
- `orders.ts`: create order (`intent: AUTHORIZE`, payee = merchant sandbox email), authorize, capture, void, refund. Every POST sends a unique `PayPal-Request-Id` (idempotent retries).
- `vault.ts`: setup token → user approves on PayPal → payment token (`vault_id`).
- `gateway.ts`: one interface, **sandbox** or **mock**, chosen automatically by whether keys are set.
- `services/paymentService.ts`: APPROVE = authorize + capture; ASK_HUMAN = authorize (held) + notify; BLOCK = no PayPal call; human approve = capture, reject or timeout = void.

**Your steps:**
1. Add the PayPal keys to `.env` and restart `npm run dev`. The header badge should read **PayPal sandbox**.
2. Dashboard → **Setup** → **Connect PayPal** → log in with the sandbox **Personal** account → approve. You land back on Setup with "PayPal wallet connected".
3. `npm run agent -- --scripted "Buy oat milk and the cheapest bread you can find"`. The approved rows in the **Audit log** should now have real PayPal order/capture IDs (not `MOCK-…`).
4. Log in to the sandbox site as the FreshCart business account and confirm the payments arrived.
5. `npm run agent -- --scripted "Buy wireless headphones"` → click **Reject** on the Live page → the authorization is voided in sandbox.
6. **If Vault fails** (an error on Connect PayPal, or orders asking for payer action), set `PAYPAL_FLOW=approval_link` and restart. Each payment then gets a PayPal approval link (in Telegram and on the Live card); approving on PayPal authorizes and captures it. Say so honestly in the README (already noted under "Honest notes").

**Done when:** money visibly moves between sandbox accounts, and a rejected hold is voided.

---

## Phase 3: Policy & risk engines ✅ (Oct 23–24)

**Built:**
- `packages/shared/src/policy.ts`: strict Zod policy schema (README §10, plus `timezone` and `trusted_only_categories` for "electronics only from stores I've used before") and `describePolicy()`, the deterministic plain-English summary.
- `apps/api/src/core/policyEngine.ts`: every rule returns `{rule_id, outcome: pass|ask|block, detail}`. Plain code, no AI.
- `core/riskEngine.ts`: README §11.1 signals and weights, capped at 100.
- `core/decide.ts`: README §11.2 decision function, plus `decideWithBaseline()`: a code-only baseline decision and the AI-informed one, taking the stricter. This is what guarantees "AI can only escalate".

```bash
npm test
```

**Done when:** tests pass (53/53 today). Tune weights in `RISK_WEIGHTS` if your demo needs it, and re-run the tests.

---

## Phase 4: Webhooks ✅ mock · 🟡 sandbox (Oct 25)

**Built:** `POST /webhooks/paypal` verifies every event with `POST /v1/notifications/verify-webhook-signature` and rejects unverified ones. Events are stored once (idempotent) and never move a payment backwards. The mock gateway emits the same events, through the same processor.

**Your steps:**
1. Webhooks need a public URL. Either deploy first (Phase 9, simplest) or run a tunnel to `localhost:4000` (ngrok, cloudflared, etc.) and set `PUBLIC_BASE_URL` to the tunnel URL.
2. Developer dashboard → your app → **Webhooks** → Add `https://<public-url>/webhooks/paypal` with these events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`.
3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID` and restart.

**Done when:** after a sandbox payment, the API log shows webhooks applied (no "rejected unverified PayPal webhook" warnings).

---

## Phase 5: AI layer ✅ heuristics · 🟡 Claude (Oct 27–29)

**Built** (`apps/api/src/ai/`, official Anthropic SDK, structured outputs validated with Zod; retry once, then fail safe to ASK_HUMAN):
- `compilePolicy.ts`: Claude Opus 5.5 compiles rules; falls back to the rule-based compiler (`core/ruleCompiler.ts`).
- `intentCheck.ts`: Claude Haiku 5.5 + keyword heuristic; the stricter verdict wins.
- `injectionDetect.ts`: HTML/CSS/Unicode heuristics (`core/injectionHeuristics.ts`) + Claude classifier with the page wrapped in untrusted-data delimiters.
- `categorize.ts`: keywords first; Claude can only make a category stricter. Cached.
- `explain.ts`: one-sentence explanation; template fallback.

**Your steps:**
1. Set `ANTHROPIC_API_KEY`, restart. The header badge should read **AI: Claude**.
2. **Policies** → type rules → **Compile**. The result card should say "compiled by Claude". Try an ambiguous rule ("only buy things my mum would like") and check it lands in *Needs clarification*.
3. Postman → *Simulate (dry run)* with a phone case during a headphones task. `engines` should show `llm+heuristic`, and the intent check should flag it.

**Done when:** gift-card-during-groceries is flagged by the intent check, and the compiler round-trips the README §4.1 example.

---

## Phase 6: MCP server, demo stores, demo agent ✅ scripted · 🟡 LLM agent (Oct 30 – Nov 1)

**Built:**
- `apps/api/src/mcp/server.ts`: MCP tools `start_task`, `request_payment`, `get_payment_status`, `get_remaining_budget` over Streamable HTTP at `/mcp` (plus `npm run mcp:stdio`).
- `apps/stores`: FreshCart (2 yrs), GadgetHub (1 yr), MegaDealz (3 days). MegaDealz hides the README §15 injection three ways (white-on-white 1px text, an HTML comment, image alt text). `POST /:store/checkout` is the unguarded path.
- `apps/demo-agent`: the harness registers the user's words as the task before the model sees any page, and attaches the page HTML to each payment request. It waits for human approval when a payment is held. `--ops` runs a merchant support agent that works FreshCart's inbox with PayPal Agent Toolkit tools through AgentGuard.
- **PayPal Agent Toolkit behind the firewall** (`apps/api/src/paypal/toolkit.ts`, `services/toolkitService.ts`, `core/toolPolicy.ts`): all 47 `@paypal/agent-toolkit` tools on AgentGuard's MCP server. Read-only tools pass through. Refunds and dispute acceptance are checked against your limits; cancellations and deletions always ask. A privileged action triggered by a message with hidden instructions is blocked. Mock mode simulates results.
- **Try it page** (`/try`, `services/demoRunner.ts`): runs each scenario as a real agent process on the server, streams its log, and **Reset demo** restores the seed. Rate-limited, one run at a time.

```bash
npm run agent -- --scripted "Buy oat milk and the cheapest bread you can find"     # no LLM, deterministic
npm run agent -- "Buy oat milk and the cheapest bread you can find"                # Claude (naive prompt)
npm run agent -- --careful "Buy oat milk and the cheapest bread you can find"      # Claude, hardened prompt
npm run agent -- --unguarded "Buy the cheapest bread you can find"                 # no AgentGuard
```

**Done when:** a full run shows groceries approved and the MegaDealz attack blocked. If Claude notices the injection and refuses to follow it even with the naive prompt, that is fine: use `--scripted` for the video take (it really does follow the hidden instruction) and mention that strong models resist, but the firewall doesn't depend on that.

---

## Phase 7: Telegram approvals ✅ code · 🟡 live bot (Nov 2)

**Built** (`apps/api/src/telegram/bot.ts`): approval cards with ✅ Approve / ❌ Reject buttons, the result edited into the same message, alerts for blocked attacks with the hidden snippet, and the `/start`, `/freeze`, `/unfreeze` and `/status` commands. Only the linked chat can approve. A background job voids holds nobody answered within `approval_timeout_minutes` (default 15).

**Your steps:**
1. Set `TELEGRAM_BOT_TOKEN`, restart (`TELEGRAM_MODE=polling` works on localhost).
2. Open your bot on your phone → send `/start`. Dashboard → **Setup** should show "Phone linked".
3. `npm run agent -- --scripted "Buy wireless headphones"` → your phone buzzes → tap **Approve** → the agent prints "Human approved" and the Live card turns green.

**Done when:** a phone tap captures, and a reject voids.

---

## Phase 8: Dashboard ✅ (Nov 3–4)

**Built** (`apps/dashboard`, Next.js 15 + Tailwind 4 + AG Grid 34):
- **Live**: stat tiles, real-time cards over SSE, risk gauges, Approve/Reject on held payments, the hidden snippet on attack cards.
- **Policies**: plain English → compile → "Here's what I understood" (generated from the JSON) → collapsible JSON → Confirm & activate. Example chips, history.
- **Audit log** (AG Grid Enterprise): grouping by merchant/decision/status/category or drag-to-group, master-detail rows with every rule, signal and piece of evidence, set and floating filters, quick search, CSV and Excel export, status bar aggregations, live updates.
- **Budgets**: spent vs. held vs. limit, 7-day captured spend.
- **Threats**: every injection attempt with the hiding technique and the highlighted text.
- **Setup**: PayPal Vault connect, Telegram link, policy, MCP config snippet.
- **Kill switch** in the header (also `/freeze` on Telegram).

**Your step:** ask AG Grid for a trial or hackathon license key and set `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` to remove the trial watermark before recording.

---

## Phase 9: Deploy to Render 🧑 (Nov 5)

1. Push the repo to GitHub (Phase 0).
2. Render → **New** → **Blueprint** → select the repo. `render.yaml` creates `agentguard-db` (Postgres) and three web services: `agentguard-api`, `agentguard-dashboard`, `agentguard-stores`.
   - ⚠️ **Free Render Postgres expires 30 days after creation**, which would land inside the Dec 1–15 judging window. Before relying on it, change `plan: free` under `databases` to a paid plan, or delete the `databases` block and set `DATABASE_URL` on the API to an external Postgres that doesn't expire (e.g. Neon's free tier).
   - Free web services also sleep after 15 minutes idle and take about a minute to wake. Open each URL a minute before recording, or use a paid instance for the API during judging.
3. When the services exist, set the `sync: false` env vars:
   - **agentguard-api**: `PUBLIC_BASE_URL` (its own URL), `DASHBOARD_URL`, `STORES_URL`, PayPal keys and merchant emails, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, optional `AGENT_API_KEY`. `TELEGRAM_MODE=webhook` is preset.
   - **agentguard-dashboard**: `NEXT_PUBLIC_API_URL` = the API URL (baked in at build), optional AG Grid key.
4. **Manual Deploy → Deploy latest commit** on the API, then the dashboard. The API build runs migrations and the seed (the seed never overwrites a policy you've confirmed).
5. PayPal app → Webhooks → point at `https://<api>/webhooks/paypal` (Phase 4) → set `PAYPAL_WEBHOOK_ID` → redeploy the API.
6. Send `/start` to the bot again (webhook mode), then connect PayPal from the hosted **Setup** page.
7. Run the agent locally against the hosted services:

```bash
AGENTGUARD_MCP_URL=https://<api>/mcp STORES_URL=https://<stores> npm run agent -- --scripted "Buy oat milk and the cheapest bread you can find"
```

(On Windows PowerShell, set `$env:AGENTGUARD_MCP_URL` and `$env:STORES_URL` first, or put them in `.env`.)

**Done when:** the hosted dashboard shows the run live, with real sandbox capture IDs. Free Render services sleep when idle, so open each URL a minute before recording or judging.

---

## Phase 10: Polish & docs (Nov 6–7) ✅ drafted · 🧑 final pass

- [ ] Fill in the **Judge test drive** section of the README (hosted URLs, sandbox buyer login: sandbox only).
- [ ] Add 3–4 screenshots (Live with a blocked attack, Policies compile, Audit log grouped by decision, Threats) to the README.
- [ ] Import `postman/AgentGuard.postman_collection.json`, set `baseUrl` to the Render API, run folder 2 in order, and link the collection in the README for judges (Postman has no prize in this hackathon, but it makes testing easy).
- [ ] Phone-width check of the dashboard (layouts are responsive; verify on your phone).
- [ ] Optional stretch, only if everything above is done: per-agent API keys with their own budgets, the policy simulator UI (the `POST /api/payments/simulate` endpoint already exists), a refund button in the audit grid (`POST /api/payments/:id/refund` exists).

**Scope rule (from the plan):** if behind, cut reconciliation → refunds → budget charts → quiet hours. Never cut the injection demo, Telegram approval, authorize/capture/void, or the AG Grid audit log.

---

## Phase 11: Demo video 🧑 (Nov 8), under 3:00

You can run every scene from the dashboard's **Try it** page instead of a terminal. Rehearse with **Reset demo** (or `npm run demo:reset`) between takes (it wipes payments and restores the sample policy). The stores keep their unguarded `/orders` list in memory: restart the stores app, or `POST <stores>/api/reset`, to clear it. Record 1080p, voiceover separately, no copyrighted music, show the hosted URL on screen.

| Time | Scene | What to run / show |
|---|---|---|
| 0:00–0:20 | Hook | Title card: "AI agents can now spend your money" |
| 0:20–0:40 | Naive agent, no protection | `npm run agent -- --scripted --unguarded "Buy the cheapest bread you can find"` → stores `/orders` page shows **$1,000.99 charged** |
| 0:40–1:00 | Rules in plain English | Policies page → type rules → Compile → "Here's what I understood" → Confirm |
| 1:00–1:20 | Normal purchase | `npm run agent -- --scripted "Buy oat milk and the cheapest bread you can find"`: FreshCart oat milk ✅, show the PayPal capture ID |
| 1:20–1:55 | The attack, blocked | Same run: MegaDealz → ⛔ BLOCKED card with the hidden text; Threats page; agent recovers at FreshCart |
| 1:55–2:25 | Phone approval | `npm run agent -- --scripted "Buy wireless headphones"` → phone buzzes → tap Approve → captured. Second run → Reject → voided |
| (optional, 15s) | PayPal Agent Toolkit ops agent | Try it → *Merchant ops agent*: the $3.99 refund runs, the injected full refund and dispute acceptance are blocked |
| 2:25–2:45 | Audit & kill switch | Audit log grouped by decision, expand a row; flip the kill switch → next request blocked |
| 2:45–3:00 | Close | Architecture slide: "AgentGuard: the trust layer agentic commerce needs, built on PayPal" |

Upload to YouTube as **public** (or unlisted, if the rules allow it).

---

## Phase 12: Submit 🧑 (Nov 9–10, buffer Nov 11–12)

Devpost draft text is in the original plan (§24); update "Built with" to: `paypal-orders-api` `paypal-vault` `paypal-webhooks` `paypal-reporting` `mcp` `typescript` `node.js` `fastify` `next.js` `ag-grid` `postgresql` `prisma` `zod` `anthropic-sdk` `claude` `telegram-bot-api` `render` `postman`.

- [ ] PayPal sandbox used meaningfully (Orders AUTHORIZE, capture, void, Vault, webhooks, reporting)
- [ ] AI is core (compiler, intent, injection, explanations), described in the README's *AI tools used* table
- [ ] Public GitHub repo, MIT license visible in the About section
- [ ] Hosted demo works from a fresh browser (incognito)
- [ ] Test account and steps in the README
- [ ] Video under 3:00, public, shows the working product
- [ ] Sponsor tools listed: AG Grid, Render, Postman
- [ ] Every link clicked once more
- [ ] Submitted by **Nov 10**. Nov 11–12 are buffer only: fix, don't add features.
- [ ] Hosted demo, database and API keys stay live through **Dec 15** (end of judging)

---

## Changes from the original plan

| Plan | Built | Why |
|---|---|---|
| Vercel AI SDK for the demo agent, any LLM | Official Anthropic TypeScript SDK (tool runner) for the agent and all AI checks; `LLM_PROVIDER=none` runs heuristics only | One SDK with native structured outputs; the heuristic mode keeps everything working without keys |
| AI back-translates the policy | The summary is generated **from the compiled JSON by code** | What you confirm is exactly what gets enforced; the AI can't describe a policy it didn't compile |
| Stores as Next.js pages | A small Fastify server with server-rendered HTML | Less to deploy; same behaviour, including the hidden injections |
| AI checks raise risk | Plus a code-only **baseline decision**; the final decision is the stricter of the two | Makes "AI can only escalate" a guarantee, and it's tested |
| Task registered by the agent | The **harness** registers the user's words before the model reads anything | A prompt-injected model can't rewrite its own intent |
| Mock PayPal | Added: same flow and webhook events without credentials | Lets the whole demo run on day one |

## Troubleshooting

- **`EADDRINUSE` on 4000/3000/3001**: an old process is still running. Close it (on Windows: `netstat -ano | findstr :4000`, then end that PID in Task Manager).
- **Postgres won't start**: delete `.pgdata` and run `npm run db:local` again, then `npm run db:migrate` and `npm run seed`. This wipes local data.
- **Dashboard says it can't reach the API**: check `NEXT_PUBLIC_API_URL`, and that `DASHBOARD_URL` (used for CORS) matches the dashboard's origin.
- **Webhooks rejected**: `PAYPAL_WEBHOOK_ID` must be the ID of the webhook whose URL you're receiving on.
- **Every payment asks for approval**: no active policy (confirm one on Policies), no task registered (use `start_task`), or an AI check failing (look for `[ai:…] failed` in the API log; this is the intended fail-safe).
