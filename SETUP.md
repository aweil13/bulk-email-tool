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

- [ ] 7. Add those 3 CNAME records in Squarespace:
  Settings → Domains → `starktennis.com` → DNS Settings → Add Record (Type: CNAME) for each token.

- [ ] 8. Confirm verification (re-run until `VerificationStatus: SUCCESS`, can take minutes to hours):
  ```bash
  aws sesv2 get-email-identity --email-identity starktennis.com --region us-east-1
  ```

- [ ] 9. Request SES production access (SES Console → Account dashboard → Request production access). Otherwise only verified addresses can receive mail. Usually approved within a day.

- [ ] 10. Import the subscriber list:
  ```bash
  npm run import-subscribers -- --file ./subscribers.csv --table <SubscribersTableName from step 5>
  ```
  (Use `.xlsx`/`.xls` instead of `.csv` if that's the format on hand — the script auto-detects.)

- [ ] 11. Push the repo to GitHub (if not already):
  ```bash
  git init
  git add .
  git commit -m "Initial commit"
  git branch -M main
  git remote add origin https://github.com/<your-username>/bulk-email-tool.git
  git push -u origin main
  ```

- [ ] 12. Set up Cloudflare Pages:
  1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select the repo
  2. Build settings:
     - Framework preset: `None`
     - Root directory: *(blank)*
     - Build command: `npm run build:frontend`
     - Build output directory: `frontend/dist`
  3. Environment variables:
     - `VITE_API_URL` = the `ApiUrl` output from step 5
     - `VITE_ADMIN_KEY` = the same secret from step 3
     - `NODE_VERSION` = `20`
  4. Deploy — note the resulting `*.pages.dev` URL

- [ ] 13. Redeploy CDK with the real Cloudflare Pages URL:
  ```bash
  npm run deploy -- \
    -c fromEmail=info@starktennis.com \
    -c sendingDomain=starktennis.com \
    -c allowedOrigin=https://<your-actual-project>.pages.dev \
    -c unsubscribeBaseUrl=https://<your-actual-project>.pages.dev/unsubscribe.html \
    -c adminApiSecret=<same secret as step 5> \
    -c replyToEmail=james@starktennis.com
  ```

- [ ] 14. Set up Cloudflare Access (in the **Zero Trust** section, separate from Pages):
  1. **Access → Applications → Add an application → Self-hosted.** Domain: the Pages URL, path `/*`. Policy: Allow, emails = you + James.
  2. **Add a second application** for the same domain, path `/unsubscribe.html`, with a **Bypass** policy — lets real unsubscribe clicks skip login.

- [ ] 15. Test end to end:
  - Load the Pages URL → should prompt Cloudflare Access login
  - Log in → compose page loads
  - Send a test campaign to a small group → check inbox
  - Click unsubscribe in the test email → confirm no login prompt, confirm the DynamoDB row flips `subscribed: false`

## After setup

Once all steps are checked off, update `CLAUDE.md`'s "Setup status checklist"
and "Current sending domain setup" sections to reflect the final state, and
this file can be deleted or kept as a historical record.
