# SheetBridge API — Deployment Checklist

## Replit deployment: verified

- PORT binding: `process.env.PORT` (defaults to 3000)
- Bind address: `0.0.0.0`
- Health check `/health`: returns 200 `{"status":"ok"}`
- Webhook base URL: `https://<repl-name>.<username>.repl.co`
- Run command: `node server.js` (no build step)
- Node.js: 22+ required (for `node:sqlite`)

---

## Environment variables

Set all of these in Replit Secrets (or your host's env config) before going live.

| Key | Required | Description |
|-----|----------|-------------|
| `STRIPE_SECRET_KEY` | YES | Stripe secret key for payment API calls. Get it from dashboard.stripe.com → Developers → API keys. Use `sk_test_...` for testing, `sk_live_...` for production. |
| `STRIPE_WEBHOOK_SECRET` | YES | Stripe webhook signing secret for verifying webhook payloads. Created when you add the webhook endpoint in Stripe dashboard. Starts with `whsec_`. |
| `STRIPE_PRICE_STARTER` | YES | Stripe Price ID for the Starter plan ($19/mo). Create a recurring price in Stripe Products and copy the ID (e.g. `price_1Abc...`). |
| `STRIPE_PRICE_PRO` | YES | Stripe Price ID for the Pro plan ($49/mo). Same process as above. |
| `GOOGLE_CLIENT_ID` | YES | Google OAuth2 client ID. Create at console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client IDs. |
| `GOOGLE_CLIENT_SECRET` | YES | Google OAuth2 client secret. Shown alongside the Client ID above. |
| `SESSION_SECRET` | YES | Random string for signing session cookies during OAuth. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BASE_URL` | YES | Full public URL of your deployment, e.g. `https://sheetbridge.repl.co`. Used to construct the Google OAuth redirect URI and Stripe success URLs. |
| `DATABASE_URL` | NO | Path to SQLite database file. Defaults to `./sheetbridge.db` in the repo root. Change this if you want the DB in a specific volume mount. |
| `PORT` | NO | Port for Express to listen on. Defaults to 3000. Replit sets this automatically. |

---

## Stripe setup (step by step)

1. **Create a Stripe account** at https://dashboard.stripe.com/register
2. **Create two Products:**
   - Product 1: "SheetBridge Starter" — recurring, $19/mo
   - Product 2: "SheetBridge Pro" — recurring, $49/mo
   - Copy the Price IDs (format: `price_1Abc...`) into `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO`
3. **Add a webhook endpoint:**
   - URL: `https://<repl-name>.<username>.repl.co/webhooks/stripe`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.deleted`
   - Copy the Signing Secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`
4. **Test the flow:**
   - Use Stripe test card `4242 4242 4242 4242`, any future date, any CVC
   - `POST /v1/checkout` with `{"plan":"starter"}` and a valid project API key
   - Follow the checkout URL
   - Verify the Stripe dashboard shows the subscription
   - Verify `GET /v1/projects/<id>` (internal debug route) shows `tier: "starter"`

---

## Google Cloud setup (step by step)

1. Go to https://console.cloud.google.com/
2. Create a new project (or use an existing one)
3. Enable the **Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `https://<repl-name>.<username>.repl.co/auth/google/callback`
   - Also add `http://localhost:3000/auth/google/callback` for local dev
5. Copy `Client ID` → `GOOGLE_CLIENT_ID`, `Client Secret` → `GOOGLE_CLIENT_SECRET`
6. Configure OAuth consent screen:
   - User type: External (or Internal for dev)
   - Scopes: `https://www.googleapis.com/auth/spreadsheets`
   - Add your test users while in development mode

---

## External services summary

| Service | Purpose | Free tier | Setup URL |
|---------|---------|-----------|-----------|
| Stripe | Subscription billing and webhook events | No monthly fee; 2.9% + 30¢ per transaction | https://dashboard.stripe.com/register |
| Google Sheets API | OAuth source connection and record read/write | Free up to quota limits | https://console.cloud.google.com/ |

---

## Pre-launch checklist

- [ ] All required env vars set (see table above)
- [ ] `GET /health` returns 200
- [ ] Stripe test checkout completes end-to-end (test card → webhook → `tier` updated in DB)
- [ ] Google OAuth flow completes (redirect → token exchange → source created in DB)
- [ ] `GET /v1/sources` returns empty state for demo key
- [ ] `GET /v1/records` returns mock data for demo key
- [ ] Rate limit triggers 429 after 200 requests/min on free key
- [ ] `marketing/` directory committed with all assets
- [ ] RapidAPI listing submitted
- [ ] Product Hunt launch scheduled
- [ ] Stripe webhook URL set to production URL (NOT localhost)

---

## Webhook URL pattern

```
https://<repl-name>.<username>.repl.co/webhooks/stripe
```

Example:
```
https://sheetbridge-api.gabangxa.repl.co/webhooks/stripe
```

**Important:** Never use `localhost` as the webhook URL. Stripe cannot reach localhost. During local development, use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward events:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

## Database persistence note

SQLite is used for API key storage and usage metering. The database file (`sheetbridge.db`) persists across server restarts on Replit's filesystem. If you redeploy or move to a new Replit instance, copy the `.db` file or all existing API keys will be lost.

For production resilience, set `DATABASE_URL` to a persistent volume path or migrate to a hosted Postgres/SQLite service.
