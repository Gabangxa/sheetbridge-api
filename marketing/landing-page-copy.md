# SheetBridge API — Landing Page Copy

## Hero

**Headline:**
One API for Google Sheets, Airtable & Notion

**Subheadline:**
Stop maintaining three SDKs. Query any spreadsheet database with a single REST call — normalized schema, one auth token, zero glue code.

**Primary CTA:** Try the API free
**Secondary CTA:** Read the docs

---

## Problem section

**Heading:** Three platforms. Three OAuth flows. One headache.

**Body:**
Every time you build on a spreadsheet backend, you face the same tax:

- Google Sheets: custom OAuth, row/column addressing, no query language
- Airtable: 5 req/s hard rate limit, its own filter syntax, proprietary field types
- Notion: cursor pagination, nested block API, 3+ calls per record set

And when a client asks to switch platforms? You rewrite your entire data layer.

---

## Solution section

**Heading:** One interface. Every source.

**Body:**
SheetBridge normalizes Sheets, Airtable, and Notion into a single REST API. Every record returns the same shape:

```json
{
  "id":         "row_001",
  "source":     "sheets",
  "fields":     { "Name": "Acme Corp", "Status": "Active", "Revenue": 12000 },
  "created_at": "2026-03-01T10:00:00Z",
  "updated_at": "2026-03-01T10:00:00Z"
}
```

Your app never changes when you swap the backend.

---

## Feature bullets

- **Normalized schema** — same `id / source / fields / created_at / updated_at` from every source
- **Filter + sort** — `?filter=Status:Active&sort=Revenue:desc` — server-side, no full-dataset pull
- **Cursor pagination** — stable across concurrent edits
- **Rate-limit buffering** — SheetBridge absorbs Airtable's 5 req/s; your app sees zero 429s
- **One API key** — single Bearer token for all connected sources
- **OpenAPI spec** — import `/openapi.json` into Postman, generate typed SDKs instantly

---

## Social proof / market signal

> "Three Sheets-only API products each report 10K–50K developer accounts paying $9–$49/mo."

SheetBridge does everything those tools do — plus Airtable + Notion support — at the same price.

---

## Pricing section

**Heading:** Simple, predictable pricing. No per-seat fees.

| Tier | Price | Records/day | Sources | Rate limit |
|------|-------|-------------|---------|------------|
| Free | $0 | 500 | 1 | 200 req/min |
| Starter | $19/mo | 20,000 | 3 | 200 req/min |
| Pro | $49/mo | 100,000 | Unlimited | 2,000 req/min |

---

## CTA section

**Heading:** Ready to ship in 5 minutes?

**Body:**
The demo key is live right now. No signup, no credit card.

**CTA:** Try the API free →
**Sub-CTA:** Or start with Starter at $19/mo

---

## Footer tagline

SheetBridge — the REST API layer your spreadsheet deserves.
