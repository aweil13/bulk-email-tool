# Setup Steps — Bulk Email Tool for Stark Tennis

Ordered checklist for getting this deployed. Read `CLAUDE.md` first for
full project context — this file is just the sequence of commands/actions,
in order, with the actual values decided on for this deployment.

Ask Claude Code to walk through these one at a time, run the commands,
and check items off here (or in `CLAUDE.md`'s setup checklist) as they're
completed.

## Decided values

- Sending domain (root, not subdomain): `starktennis.com`
- From address: `info@starktennis.com`
- Reply-To address: `james@starktennis.com`
- DNS host: Squarespace

## Steps

- [x] 1. AWS account created, `aws configure` run
- [x] 2. AWS access confirmed working

- [x] 3. Generate the admin secret (save it somewhere safe — needed twice, in step 5 and step 9):
  ```bash
  openssl rand -hex 32
  ```

- [x] 4. Bootstrap CDK (done in us-east-1, account 767866852344).
  Note: `npm run deploy -- -c ...` mangles the `-c` flags (npm intercepts
  `-c` as its own `--call`). Run cdk directly from `infra/` instead:
  ```bash
  cd infra && CDK_DEFAULT_REGION=us-east-1 CDK_DEFAULT_ACCOUNT=767866852344 \
    npx cdk bootstrap aws://767866852344/us-east-1 \
    -c adminApiSecret=<secret>   # secret needed because the app synths during bootstrap
  ```

- [x] 5. First CDK deploy done (placeholder frontend URLs). Run from `infra/`:
  ```bash
  cd infra && CDK_DEFAULT_REGION=us-east-1 CDK_DEFAULT_ACCOUNT=767866852344 \
    npx cdk deploy --require-approval never \
    -c fromEmail=info@starktennis.com \
    -c sendingDomain=starktennis.com \
    -c allowedOrigin=https://placeholder.pages.dev \
    -c unsubscribeBaseUrl=https://placeholder.pages.dev/unsubscribe.html \
    -c adminApiSecret=<secret from step 3> \
    -c replyToEmail=james@starktennis.com
  ```
  Stack outputs:
  - `ApiUrl` = `https://n3j4rlgc72.execute-api.us-east-1.amazonaws.com`
  - `SendCampaignFunctionName` = `BulkEmailToolStack-SendCampaignFunction8F23D2F3-uDkToEeD9UGF`
  - `SubscribersTableName` = `BulkEmailToolStack-SubscribersTable0095C04E-18KPHYPLIELJ3`

  Note: `replyToEmail` support had to be added to the code (stack props →
  send Lambda env → SES `ReplyToAddresses`); it wasn't wired before.

- [x] 6. DKIM CNAME records fetched (status PENDING until added + verified):
  ```bash
  aws sesv2 get-email-identity --email-identity starktennis.com --region us-east-1
  ```
  Look for `DkimAttributes` → `Tokens` (3 values). Each maps to a CNAME:
  - Host: `<token>._domainkey.starktennis.com`
  - Value: `<token>.dkim.amazonses.com`

- [x] 7. Added the 3 DKIM CNAME records in Squarespace. All three confirmed
  resolving publicly:
  ```bash
  dig +short CNAME <token>._domainkey.starktennis.com @1.1.1.1
  # each returns <token>.dkim.amazonses.com
  ```

- [~] 8. Verification IN PROGRESS. DNS is live/correct, SES still polling
  (`DkimStatus: PENDING` as of last check). Re-run until SUCCESS:
  ```bash
  aws sesv2 get-email-identity --email-identity starktennis.com --region us-east-1
  ```

- [~] 9. Production access REQUESTED (submitted via `aws sesv2 put-account-details`,
  MailType MARKETING). AWS Support **case ID: `178906272700125`**.
  - Status auto-`DENIED` (the standard automated pause) → AWS replied asking
    for more detail on sending frequency, list maintenance, and
    bounce/complaint/unsubscribe handling.
  - Next action: reply IN the existing case (not a new one) with the use-case
    details, once DKIM shows SUCCESS (AWS wants a verified identity first).
  - View/reply: AWS Support Center → Case history (may be filtered under
    Resolved): https://support.console.aws.amazon.com/support/home#/case/history

- [ ] 10. Import the subscriber list:
  ```bash
  npm run import-subscribers -- --file ./subscribers.csv --table <SubscribersTableName from step 5>
  ```
  (Use `.xlsx`/`.xls` instead of `.csv` if that's the format on hand — the script auto-detects.)

- [x] 11. Repo pushed to GitHub (`github.com/aweil13/bulk-email-tool`, branch `main`).

- [x] 12. Cloudflare Pages set up. Use the **legacy Pages workflow** — on
  "Create an app" the default GitHub button routes into the Workers importer;
  click **"Continue to Pages"** at the bottom to get the classic form with a
  Build output directory field.
  - Build command: `npm run build:frontend`
  - Build output directory: `frontend/dist`
  - Env vars: `VITE_API_URL` = ApiUrl, `VITE_ADMIN_KEY` = admin secret, `NODE_VERSION` = `20`
  - Production URL: `https://bulk-email-tool.pages.dev` (the `<hash>.bulk-email-tool.pages.dev`
    URLs are per-deployment previews — use the bare project domain for CORS/Access).
  - Note: the first build failed on `AVAILABLE_LISTS` not being exported —
    fixed by aliasing the shared package to its TS source in
    `frontend/vite.config.ts` (rollup can't analyze the CJS `__exportStar`).

- [x] 13. CDK redeployed with the real Pages URL (run from `infra/`, not via
  `npm run deploy` — see step 5 note):
  ```bash
  cd infra && CDK_DEFAULT_REGION=us-east-1 CDK_DEFAULT_ACCOUNT=767866852344 \
    npx cdk deploy --require-approval never \
    -c fromEmail=info@starktennis.com \
    -c sendingDomain=starktennis.com \
    -c allowedOrigin=https://bulk-email-tool.pages.dev \
    -c unsubscribeBaseUrl=https://bulk-email-tool.pages.dev/unsubscribe.html \
    -c adminApiSecret=<secret> \
    -c replyToEmail=james@starktennis.com
  ```

- [x] 14. Cloudflare Access set up (Zero Trust team `rough-dream-cc16`, Free plan).
  Menu is now **Access controls → Applications**. Two self-hosted apps:
  1. Destination `bulk-email-tool.pages.dev` (no path) — policy **Allow**,
     Emails = allow-listed addresses. Login via built-in One-time PIN.
  2. Destination `bulk-email-tool.pages.dev/unsubscribe.html` — policy
     **Bypass** / Everyone.
  - **Gotcha:** Cloudflare Pages 308-redirects `/unsubscribe.html` →
    `/unsubscribe` (strips `.html`), and that clean URL was still gated by
    app #1. Fix: add a **second destination** `bulk-email-tool.pages.dev/unsubscribe`
    (no extension) to the Bypass app so both the `.html` link and its redirect
    target skip login. The 308 preserves the `?email&token` query string, so
    the emailed `/unsubscribe.html?...` link works end to end.
  - Use custom input for the hostname (the Domain dropdown only lists zones,
    not `pages.dev`). Verify at the edge, not the browser (cached redirects
    and Access session cookies give false results):
    ```bash
    curl -sI https://bulk-email-tool.pages.dev/unsubscribe   # expect 200
    curl -sI https://bulk-email-tool.pages.dev/              # expect 302 -> cloudflareaccess.com
    ```

- [ ] 15. Test end to end:
  - Load the Pages URL → should prompt Cloudflare Access login
  - Log in → compose page loads
  - Send a test campaign to a small group → check inbox
  - Click unsubscribe in the test email → confirm no login prompt, confirm the DynamoDB row flips `subscribed: false`

## After setup

Once all steps are checked off, update `CLAUDE.md`'s "Setup status checklist"
and "Current sending domain setup" sections to reflect the final state, and
this file can be deleted or kept as a historical record.
