# SheetBridge API

**One REST API for Google Sheets, Airtable, and Notion.**

Stop maintaining three separate SDKs. SheetBridge normalizes any spreadsheet database into a single, consistent REST interface — one auth token, one schema, zero glue code.

---

## Quick start

```bash
# Health check (no auth needed)
curl https://sheetbridge.io/health

# List all Active records sorted by Revenue
curl "https://sheetbridge.io/v1/records?filter=Status:Active&sort=Revenue:desc" \
  -H "Authorization: Bearer demo_key_sheetbridge"

# Create a record
curl -X POST https://sheetbridge.io/v1/records \
  -H "Authorization: Bearer demo_key_sheetbridge" \
  -H "Content-Type: application/json" \
  -d '{"source":"sheets","fields":{"Name":"Zeta Corp","Status":"Trial","Revenue":0}}'
```

---

## API endpoints

| Method   | Path                    | Description                          |
|----------|-------------------------|--------------------------------------|
| `GET`    | `/health`               | Health check (no auth required)      |
| `GET`    | `/v1/records`           | List records with filter/sort/page   |
| `GET`    | `/v1/records/:id`       | Get a single record                  |
| `POST`   | `/v1/records`           | Create a new record                  |
| `PATCH`  | `/v1/records/:id`       | Merge-update a record's fields       |
| `DELETE` | `/v1/records/:id`       | Delete a record                      |
| `GET`    | `/v1/sources`           | List connected sources               |
| `GET`    | `/docs`                 | Interactive API documentation        |

Full reference: [/docs](/docs) | OpenAPI spec: [/openapi.json](/openapi.json)

---

## Authentication

Include a Bearer token on every request (except `/health`):

```
Authorization: Bearer demo_key_sheetbridge
```

---

## Running locally

```bash
npm install
npm start
# Server starts at http://localhost:3000
```

Requires Node.js 18+.

---

## Deploying to Replit

1. Import this repo at [replit.com/new](https://replit.com/new/github/Gabangxa/sheetbridge-api)
2. Click **Run** — no further configuration needed
3. The server binds to `0.0.0.0:${PORT}` automatically

---

## Demo data

The server seeds five in-memory records on startup:

| ID        | Name          | Status   | Revenue |
|-----------|---------------|----------|---------|
| row_001   | Acme Corp     | Active   | 12000   |
| row_002   | Beta Labs     | Trial    | 0       |
| row_003   | Gamma Studio  | Active   | 4500    |
| row_004   | Delta Works   | Churned  | 0       |
| row_005   | Epsilon Tech  | Active   | 8900    |

Data resets on each server restart.

---

## Pricing

| Plan    | Price    | Reads/mo  | Sources |
|---------|----------|-----------|---------|
| Free    | $0       | 2,000     | 1       |
| Starter | $19/mo   | 50,000    | 3       |
| Pro     | $49/mo   | 500,000   | Unlimited |
| Scale   | $99/mo   | Unlimited | Unlimited + SLA |

---

## License

MIT
