# SheetBridge API

One REST API for Google Sheets, Airtable, and Notion. One auth token, one record schema, one endpoint — regardless of which platform your data lives in.

## Status

- **v1.0** — Google Sheets fully integrated (OAuth, CRUD, filter, sort, pagination)
- **v1.1** — Airtable (coming soon)
- **v1.2** — Notion (coming soon)

---

## Quick Start (Replit)

Import this repo at [replit.com/new](https://replit.com/new/github/Gabangxa/sheetbridge-api) and click **Run**. Then set the required environment variables below.

```bash
npm install
npm start
# Server starts at http://localhost:3000
```

Requires Node.js 22+.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth2 client secret |
| `BASE_URL` | Yes | Public deployment URL, e.g. `https://<repl>.<user>.repl.co` |
| `SESSION_SECRET` | Yes | Secret for signing OAuth session cookies |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` | Yes | Stripe Price ID for the Starter plan |
| `STRIPE_PRICE_PRO` | Yes | Stripe Price ID for the Pro plan |
| `PORT` | No | Defaults to 3000 (set automatically by Replit) |
| `DATABASE_URL` | No | SQLite file path (default: `./sheetbridge.db`) |

### Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable the **Google Sheets API**
3. Create OAuth2 credentials (Web Application)
4. Add authorised redirect URI: `https://<your-host>/auth/google/callback`
5. Copy Client ID and Secret into your environment variables

### Stripe setup

1. Create a Stripe account at [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create two recurring products (Starter and Pro) and copy their Price IDs
3. Register a webhook endpoint at `https://<your-host>/webhooks/stripe`
4. Subscribe the webhook to: `checkout.session.completed`, `customer.subscription.deleted`

---

## Connecting a Spreadsheet

### 1. Create a project (get your API key)

```bash
curl -X POST https://<host>/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My App"}'
```

```json
{
  "project_id": "abc123",
  "api_key": "sk_live_...",
  "tier": "free",
  "message": "Store your API key securely — it will not be shown again."
}
```

### 2. Connect Google Sheets (OAuth)

Visit the following URL in your browser with your API key:

```
https://<host>/auth/google
Authorization: Bearer sk_live_...
```

Complete the Google consent screen. You'll be redirected to `/docs?oauth=success`.

### 3. Register your spreadsheet

```bash
curl -X POST https://<host>/v1/sources \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer CRM",
    "spreadsheet_id": "<your-google-sheets-id>",
    "sheet_name": "Sheet1"
  }'
```

```json
{ "id": "src_abc123", "name": "Customer CRM", "type": "sheets", "status": "active" }
```

---

## API Reference

All `/v1` endpoints require `Authorization: Bearer <api_key>`.

### Records

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/records` | List records from a connected source |
| `GET` | `/v1/records/:id` | Fetch a single record |
| `POST` | `/v1/records` | Create a record |
| `PATCH` | `/v1/records/:id` | Update fields on a record |
| `DELETE` | `/v1/records/:id` | Clear a record row |

#### GET /v1/records

```bash
curl "https://<host>/v1/records?resourceId=src_abc123&filter=Status:Active&sort=Name:asc&limit=25" \
  -H "Authorization: Bearer sk_live_..."
```

| Query param | Description |
|---|---|
| `resourceId` | Source ID from `GET /v1/sources` (required) |
| `filter` | `field:value` — exact match filter |
| `sort` | `field:asc` or `field:desc` |
| `limit` | Max records (default: 10, max: 100) |
| `cursor` | Pagination cursor from previous response |

**Response:**
```json
{
  "records": [
    {
      "id": "sheets::row::2",
      "source": "sheets",
      "resource_id": "src_abc123",
      "fields": { "Name": "Acme Corp", "Status": "Active", "Revenue": "12000" },
      "created_at": null,
      "updated_at": null
    }
  ],
  "next_cursor": "eyJvZmZzZXQiOjI1fQ==",
  "total": 142
}
```

#### POST /v1/records

```bash
curl -X POST https://<host>/v1/records \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"resourceId": "src_abc123", "fields": {"Name": "New Corp", "Status": "Trial"}}'
```

#### PATCH /v1/records/:id

```bash
curl -X PATCH "https://<host>/v1/records/sheets::row::2?resourceId=src_abc123" \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"fields": {"Status": "Active"}}'
```

#### DELETE /v1/records/:id

Clears row values (row index preserved — safe for cursor-based pagination).

```bash
curl -X DELETE "https://<host>/v1/records/sheets::row::2?resourceId=src_abc123" \
  -H "Authorization: Bearer sk_live_..."
```

### Sources

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/sources` | List all connected sources |
| `POST` | `/v1/sources` | Register a spreadsheet after OAuth |

### Projects

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/projects` | Create a project and receive an API key |

### Checkout

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/checkout` | Create a Stripe Checkout session for plan upgrade |

### Utility

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/docs` | Interactive API documentation |
| `GET` | `/openapi.json` | OpenAPI 3.0 spec |

---

## Demo Key

The demo key returns mock records so you can explore the API shape without connecting a spreadsheet:

```
Authorization: Bearer demo_key_sheetbridge
```

Write operations require a real project API key.

---

## Record ID Format

Record IDs are stable row pointers: `sheets::row::<n>` where `n` is the 1-based row index (row 1 = headers, row 2 = first data row).

---

## Tech Stack

- **Runtime**: Node.js 22 (no build step)
- **Framework**: Express
- **Database**: SQLite via `node:sqlite` (built-in, zero dependencies)
- **Auth**: Google OAuth2 via `googleapis`
- **Payments**: Stripe
- **Deployment**: Replit

---

## License

MIT
