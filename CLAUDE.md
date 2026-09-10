# Bulk Email Tool — Project Context

This file orients Claude Code (or any AI assistant working in this repo) on
what this project is, the decisions already made, and what's left to do.
Read this before making structural changes.

## What this is

A serverless bulk email tool for a friend's tennis coaching business — sends
to an existing subscriber list (~1,500 people, provided as CSV/Excel) to
get past Gmail's sending limits. Also a personal portfolio project (job
applications). Not CNYCN or any employer's infrastructure.

**No public signup page exists.** Recipients never visit any part of this
tool except the unsubscribe link in an email — this was an explicit,
deliberate requirement, not an oversight. Don't add a signup form back
without being asked.

## Stack (decided — don't relitigate without asking)

- **Language:** TypeScript everywhere (infra, lambdas, frontend, shared types, import script)
- **Infra:** AWS CDK (`infra/`) — DynamoDB, 3 Lambdas, API Gateway (HTTP API v2), SES
- **Lambdas:** Node.js 20.x, bundled via CDK's `NodejsFunction` (esbuild, no manual build step)
- **Frontend:** Vite (vanilla TS, no framework), 2 static pages, deployed to Cloudflare Pages:
  - `index.html` — the compose/send tool. This is the whole site's purpose; gate it with Cloudflare Access.
  - `unsubscribe.html` — public, must stay reachable without login (Access "Bypass" policy on this path specifically)
- **Subscriber import:** `scripts/import-subscribers.ts`, run locally via `npm run import-subscribers`. Not deployed, not web-facing. Reads CSV or Excel (`.csv`/`.xlsx`/`.xls`), upserts into DynamoDB.
- **Shared types:** `shared/` package, imported by `lambdas/`, `frontend/`, AND `scripts/`. Holds `AVAILABLE_LISTS` — the single source of truth for group names.
- **Email sending:** Amazon SES (chosen over a managed ESP specifically because building the pipeline is the point — this is a resume piece)

## API routes

- `GET /unsubscribe` — public. Token-validated, flips `subscribed` to false.
- `POST /campaigns` — **admin-only**, requires `x-admin-key` header matching
  `ADMIN_API_SECRET`. Asynchronously invokes the send Lambda
  (`InvocationType: "Event"`) and returns 202 immediately — API Gateway
  HTTP APIs hard-cap requests at 29 seconds, and a full campaign send
  (1,500 recipients × a rate-limit delay) takes several minutes.
- **There is no `/subscribe` route.** It existed in an earlier version and
  was deliberately removed. Do not re-add it — subscribers come in only
  via the import script.

## Why these choices (context for future decisions)

- Considered a public signup form (earlier version had one) — removed
  entirely once the actual requirement became clear: this is a one-way
  broadcast tool for an existing list, not a growing newsletter. Recipients
  should never be able to reach any page of this tool except by clicking
  their own unsubscribe link.
- Unsubscribe stays public and functional regardless — this is legally
  required under CAN-SPAM for commercial bulk email, and Gmail/Yahoo's
  bulk-sender rules require one-click unsubscribe to avoid the spam
  folder. This is non-negotiable; don't remove or gate it.
- GitHub Pages can't restrict who can view a site without paid GitHub
  Enterprise (repo visibility and Pages site visibility are separate
  settings). Cloudflare Pages + Cloudflare Access (free up to 50 users)
  solves this.
- Cloudflare Access covers the whole domain (`/*`) now that there's no
  public signup page to keep open — except `/unsubscribe.html`, carved
  out via a second Access application with a "Bypass" policy on that
  specific path.
- `/campaigns` is protected by a shared secret (`x-admin-key`) as a
  *second*, independent layer under Cloudflare Access — Access gates the
  page load, the secret gates the actual API call. This is explicitly a
  "good enough for me and one friend" model, not hardened for
  adversarial/public use.
- The send Lambda (`lambdas/src/send.ts`) is also directly invokable via
  `aws lambda invoke` for testing, separate from the compose UI's async
  trigger path.
- Considered sending "From" a personal Gmail address through SES —
  rejected because Gmail enforces strict DMARC on gmail.com, and SES can't
  achieve DKIM/SPF alignment for a domain it doesn't control.
- Sends from a **subdomain** of a domain the friend already owns (on
  Squarespace), not the bare root domain — isolates sending reputation
  from whatever else the domain does.
- Attachments deferred (not built) — would need `SendRawEmailCommand` +
  MIME + S3 storage. Noted in README under "Extending this."
- **Import script re-run safety is important and deliberate**: it never
  flips an existing subscriber back to `subscribed: true`, and never
  replaces an existing `unsubscribeToken`. If your friend sends an updated
  CSV later, re-running the script must not silently resubscribe someone
  who opted out — that would be a compliance problem, not just a bug.
  Don't "simplify" this into a blind overwrite.
- Mailing lists/groups are string tags on each subscriber (`lists: string[]`
  in DynamoDB), not a separate table. `send.ts` filters with a Scan +
  `contains(lists, :list)`. Fine at ~1,500 rows.

## Current sending domain setup

- Domain registrar/DNS host: **Squarespace**
- Sending subdomain: `updates.<friendsdomain>.com` — *(replace `<friendsdomain>`
  with the actual domain once finalized)*
- DNS records needed: 3x CNAME for Easy DKIM, obtained via:
  ```bash
  aws sesv2 get-email-identity --email-identity updates.<friendsdomain>.com --region us-east-1
  ```
  Added manually in Squarespace: Settings → Domains → [domain] → DNS Settings
- SES account status: *(update once known — sandbox or production access granted)*

## Setup status checklist

- [ ] AWS account created, `aws configure` run
- [ ] `npx cdk bootstrap` run for the target account/region
- [ ] Admin secret generated (`openssl rand -hex 32`)
- [ ] `cdk deploy` run with real `fromEmail` / `sendingDomain` / `allowedOrigin` / `unsubscribeBaseUrl` / `adminApiSecret` context values
- [ ] DKIM CNAME records added in Squarespace DNS
- [ ] SES domain identity shows `VerificationStatus: SUCCESS`
- [ ] SES production access requested/granted (out of sandbox)
- [ ] `AVAILABLE_LISTS` in `shared/src/types.ts` edited to match the friend's actual groups
- [ ] Subscriber CSV/Excel file received from friend
- [ ] `npm run import-subscribers` run, row count confirmed in DynamoDB
- [ ] Frontend `.env` / `VITE_API_URL` / `VITE_ADMIN_KEY` set, tested locally with `npm run dev`
- [ ] Repo pushed to GitHub
- [ ] Cloudflare Pages project created, connected to the repo (root dir blank, build command `npm run build:frontend`, output `frontend/dist`, `NODE_VERSION=20` env var)
- [ ] `VITE_API_URL` and `VITE_ADMIN_KEY` env vars set in Cloudflare Pages project settings
- [ ] `cdk deploy` re-run with real `allowedOrigin` / `unsubscribeBaseUrl` matching the `.pages.dev` (or custom) domain
- [ ] Cloudflare Access application created for `/*`, friend's email (and yours) allow-listed
- [ ] Second Cloudflare Access application created for `/unsubscribe.html` with a Bypass policy
- [ ] Test campaign sent via the compose page, unsubscribe link tested end-to-end
- [ ] Re-import tested (updated file doesn't resubscribe anyone who opted out)

## Key commands

```bash
npm install                          # from repo root, installs all workspaces
npx cdk bootstrap                    # one-time per AWS account/region (run from infra/)
npm run deploy -- -c fromEmail=... -c sendingDomain=... -c allowedOrigin=... -c unsubscribeBaseUrl=... -c adminApiSecret=...
npm run import-subscribers -- --file ./subscribers.csv --table <SubscribersTableName>
aws sesv2 get-email-identity --email-identity <domain> --region us-east-1
npm run dev -w frontend              # local frontend dev server
aws lambda invoke --function-name <SendCampaignFunctionName> --payload '{"subject":"...","html":"...","listName":"juniors"}' --cli-binary-format raw-in-base64-out response.json
```

## Things to leave alone unless asked

- Don't add a public `/subscribe` route or signup page back — explicitly removed by design.
- Don't weaken the import script's re-run safety (never resubscribe, never replace an existing token).
- Don't wire `send.ts` itself directly to API Gateway — keep the trigger-campaign/send split (API Gateway's 29s timeout is a hard constraint).
- Don't switch the frontend to a framework (React/Next) — Vite + vanilla TS was chosen deliberately.
- Don't move the frontend back to GitHub Pages.
- Don't gate `/unsubscribe.html` with Cloudflare Access — it must stay reachable by anyone with a valid unsubscribe link.
- Don't add attachment support without checking the README's "Extending this" section first — requires a SES API change and S3 storage.
