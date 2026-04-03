# SheetBridge API — RapidAPI Listing

## Listing name
SheetBridge API

## Short description (160 chars max)
Unified REST API for Google Sheets, Airtable & Notion. One endpoint, normalized schema, filter/sort/pagination. No OAuth glue code.

## Long description

SheetBridge is a managed REST proxy that normalizes Google Sheets, Airtable, and Notion into a single, consistent API.

**The problem it solves:**
- Three platforms = three OAuth flows + three incompatible schemas + three pagination models
- Airtable's 5 req/s hard rate limit silently throttles your app
- Switching a client from Sheets to Notion means rewriting your entire data layer

**What you get:**
- `GET /v1/records` — list, filter, sort, paginate any connected source
- `GET /v1/records/:id` — fetch one record by ID
- `POST /v1/records` — create a record
- `PATCH /v1/records/:id` — merge-update a record
- `DELETE /v1/records/:id` — remove a record
- `GET /v1/sources` — list all connected data sources

Every record returns the same normalized shape regardless of source:

```json
{
  "id":         "row_001",
  "source":     "sheets",
  "fields":     { "Name": "Acme Corp", "Status": "Active" },
  "created_at": "2026-03-01T10:00:00Z",
  "updated_at": "2026-03-01T10:00:00Z"
}
```

**Rate limits:**
- Free / Starter: 200 req/min
- Pro: 2,000 req/min

**Authentication:**
Bearer token in `Authorization` header. Demo key available instantly.

---

## Endpoint reference (for RapidAPI endpoint list)

### GET /v1/records
List records from a connected source with optional filter, sort, and cursor pagination.

**Query params:**
| Param | Type | Example |
|-------|------|---------|
| source_id | string | `src_abc123` |
| filter | string | `Status:Active` |
| sort | string | `Revenue:desc` |
| limit | integer | `25` |
| cursor | string | `eyJvZmZzZXQiOjEwfQ==` |

**Example request:**
```
GET /v1/records?source_id=src_abc&filter=Status:Active&sort=Revenue:desc
Authorization: Bearer YOUR_API_KEY
```

**Example response:**
```json
{
  "records": [
    {
      "id": "row_001",
      "source": "sheets",
      "fields": { "Name": "Acme Corp", "Status": "Active", "Revenue": 12000 },
      "created_at": "2026-03-01T10:00:00Z",
      "updated_at": "2026-03-01T10:00:00Z"
    }
  ],
  "next_cursor": null,
  "total": 3
}
```

---

### POST /v1/records
Create a new record in a connected source.

**Request body:**
```json
{
  "source_id": "src_abc123",
  "fields": { "Name": "New Company", "Status": "Trial", "Revenue": 0 }
}
```

**Response:** `201` with created record.

---

## Pricing tiers (RapidAPI pricing config)

| Plan | Price | Requests/day | Features |
|------|-------|-------------|---------|
| Free | $0/mo | 500 records/day | 1 source, demo key, 200 req/min |
| Starter | $19/mo | 20,000 records/day | 3 sources, all platforms, 200 req/min |
| Pro | $49/mo | 100,000 records/day | Unlimited sources, 2,000 req/min, webhook push |

## Tags
`google-sheets` `airtable` `notion` `spreadsheet` `database` `rest-api` `normalized` `crud`

## Categories
Data / Databases, Productivity, Developer Tools
