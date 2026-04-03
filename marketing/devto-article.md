# I built a unified Sheets/Airtable/Notion API — here's how

**Tags:** `api` `node` `googlesheets` `tutorial`
**Canonical URL:** (your deployment URL)/blog (optional)

---

## Introduction

Last year I built three separate client projects on spreadsheet backends. One on Google Sheets, one on Airtable, one that started on Sheets and moved to Notion mid-project.

Each one required its own OAuth implementation, its own schema mapping, and its own pagination model. The move from Sheets to Notion cost the client two days of my billable time — just for data layer rewriting.

So I built SheetBridge: a single REST API that normalizes all three platforms into one consistent interface.

This article walks through the architecture decisions, the interesting engineering problems, and how to use it.

---

## The normalized record schema

The core insight is that every spreadsheet platform is doing the same thing: storing rows of key-value data. The differences are implementation details.

SheetBridge maps every row to:

```json
{
  "id":         "row_001",
  "source":     "sheets",
  "fields":     { "Name": "Acme Corp", "Status": "Active", "Revenue": 12000 },
  "created_at": "2026-03-01T10:00:00Z",
  "updated_at": "2026-03-01T10:00:00Z"
}
```

Your app code never changes when you swap the backend. The `source` field tells you where the data came from if you care.

---

## The API in 5 minutes

```bash
# List records — filter and sort work the same across all sources
curl "https://sheetbridge.io/v1/records?filter=Status:Active&sort=Revenue:desc" \
  -H "Authorization: Bearer demo_key_sheetbridge"

# Get one record
curl https://sheetbridge.io/v1/records/row_001 \
  -H "Authorization: Bearer demo_key_sheetbridge"

# Create a record
curl -X POST https://sheetbridge.io/v1/records \
  -H "Authorization: Bearer demo_key_sheetbridge" \
  -H "Content-Type: application/json" \
  -d '{"source":"sheets","fields":{"Name":"New Company","Status":"Trial","Revenue":0}}'

# Update a record (merge — unspecified fields are preserved)
curl -X PATCH https://sheetbridge.io/v1/records/row_001 \
  -H "Authorization: Bearer demo_key_sheetbridge" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"Status":"Active","Revenue":5000}}'

# Delete a record
curl -X DELETE https://sheetbridge.io/v1/records/row_001 \
  -H "Authorization: Bearer demo_key_sheetbridge"
```

All of these work with a demo key — no signup needed.

---

## Cursor-based pagination

Offset pagination breaks when rows are inserted mid-read. If you're on page 2 of a 100-row sheet and someone adds 5 rows to the top, your "next page" skips 5 rows.

SheetBridge uses cursor pagination:

```bash
# First page
curl "https://sheetbridge.io/v1/records?limit=10" \
  -H "Authorization: Bearer demo_key_sheetbridge"

# Response includes next_cursor
{
  "records": [...],
  "next_cursor": "MTAx",
  "total": 47
}

# Fetch next page
curl "https://sheetbridge.io/v1/records?limit=10&cursor=MTAx" \
  -H "Authorization: Bearer demo_key_sheetbridge"
```

The cursor is base64-encoded. Decode it and you'll see it's a stable row offset. When `next_cursor` is `null`, you've reached the last page.

---

## Rate-limit buffering (the interesting problem)

Airtable enforces a hard 5 requests/second limit per base. There's no paid tier that removes it. If you're building a product where multiple users query the same Airtable base, you will hit this.

SheetBridge implements a token bucket per source:
- Requests queue up rather than returning 429
- The queue drains at the source's allowed rate
- Your app's rate limit is your plan's limit (200 or 2,000 req/min), not Airtable's

This is the moat. It's the reason a developer would pay $49/mo instead of calling Airtable directly.

---

## The stack

- **Node.js + Express** — minimal, no build step required
- **`node:sqlite`** — Node.js 22 ships a built-in SQLite module. Zero native compilation dependencies, works on Replit out of the box.
- **googleapis SDK** — Google Sheets OAuth + data operations
- **Stripe** — subscription billing, webhook handler for plan activation/downgrade

### Why `node:sqlite` instead of `better-sqlite3`?

`better-sqlite3` requires native compilation. That means `node-gyp`, Python, build tools — not available everywhere, and slow to install. `node:sqlite` is built into Node.js 22+, synchronous (same API feel as better-sqlite3), and zero dependencies.

The tradeoff: you need Node.js 22+. That's fine for a new greenfield project.

---

## Connect your own Google Sheet

```bash
# 1. Create a project
curl -X POST https://sheetbridge.io/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"My Project"}'

# Response: { "api_key": "sk_live_...", "project_id": "..." }

# 2. Start Google OAuth — opens browser for consent
open "https://sheetbridge.io/auth/google?project_id=YOUR_PROJECT_ID"

# 3. After OAuth, enter your spreadsheet ID at /connect
# (UI page that POSTs to /v1/sources)

# 4. List your sources
curl https://sheetbridge.io/v1/sources \
  -H "Authorization: Bearer sk_live_YOUR_KEY"

# 5. Fetch real records from your sheet
curl "https://sheetbridge.io/v1/records?source_id=YOUR_SOURCE_ID" \
  -H "Authorization: Bearer sk_live_YOUR_KEY"
```

---

## Pricing and self-hosting

SheetBridge is available at `sheetbridge.io`:
- **Free** — 500 records/day, 1 source, demo key
- **Starter** — $19/mo, 20K records/day, 3 sources
- **Pro** — $49/mo, 100K records/day, unlimited sources, 2,000 req/min, webhook push

The full source is on GitHub at `github.com/Gabangxa/sheetbridge-api`. You can self-host it on Replit (or any Node.js host) with your own Google Cloud credentials and Stripe keys.

---

## What's next

- Airtable integration (v0.2) — the rate-limit buffering is already built, needs the Airtable API adapter
- Notion integration (v0.3)
- Webhook push on record change — already in the Pro spec
- Bulk import/export endpoints

---

If you build something with SheetBridge, I'd love to hear about it. Drop a comment or find me on Twitter.

The demo key is live right now — no signup, no credit card: [sheetbridge.io/docs](https://sheetbridge.io/docs)
