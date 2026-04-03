# Show HN: SheetBridge — unified REST API for Google Sheets, Airtable & Notion

**Post title:**
Show HN: SheetBridge – one REST API that normalizes Google Sheets, Airtable, and Notion

---

## Post body

I built SheetBridge after implementing Google Sheets OAuth for the third time in 18 months. Each client project had a slightly different spreadsheet backend — one on Sheets, one on Airtable, one moving from Sheets to Notion. Every switch meant rewriting the data layer.

**The unified interface problem:**

Three platforms, three incompatible APIs:
- Google Sheets: row/column addressing, no query language, OAuth refresh complexity
- Airtable: hard 5 req/s rate limit (no paid bypass), proprietary filter syntax
- Notion: nested block graph, 3+ API calls per record set, cursor pagination per-block

There are already 3 Sheets-only API products (SheetDB, Sheet2API, SheetBest) each with 10K–50K paying users at $9–$49/mo. They all stop at Sheets. None handles Airtable's rate limit problem or Notion's relational complexity.

**What I built:**

SheetBridge is a REST proxy with a normalized record schema:

```bash
curl "https://sheetbridge.io/v1/records?filter=Status:Active&sort=Revenue:desc" \
  -H "Authorization: Bearer demo_key_sheetbridge"
```

Returns:
```json
{
  "records": [{
    "id": "row_001",
    "source": "sheets",
    "fields": { "Name": "Acme Corp", "Status": "Active", "Revenue": 12000 },
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-01T10:00:00Z"
  }],
  "next_cursor": null,
  "total": 3
}
```

Same schema from Sheets, Airtable, or Notion — you never change your data layer when you swap sources.

**Technical decisions worth discussing:**

1. **Rate-limit buffering**: Airtable enforces 5 req/s per base. SheetBridge queues and retries upstream calls so your app's 429 rate reflects your paid plan limit, not Airtable's. Implemented as a token bucket per source.

2. **SQLite via `node:sqlite`**: Node.js 22 ships a built-in SQLite module. No native compilation, no better-sqlite3 binary, zero additional dependency. Usage metering and API key storage survive restarts.

3. **Cursor pagination over offset**: Offset pagination breaks when rows are inserted mid-read. Cursors encode the stable row index, which works correctly even if Sheets rows are appended concurrently.

4. **No auth complexity for consumers**: The one Bearer token per project is backed by per-source OAuth tokens stored encrypted in SQLite. The consumer never sees OAuth; they just use a static key.

**Stack:** Node.js + Express, SQLite (node:sqlite), Stripe for billing, googleapis SDK. Deployed on Replit. No build step.

**Demo:** The demo key (`demo_key_sheetbridge`) works live at the URL above — try it without signing up. Real Sheets connection requires OAuth (free).

Curious what HN thinks about the rate-limit buffering approach and whether the unified schema is actually the right abstraction or whether source-specific query operators will be needed at scale.

---

## Expected discussion threads to prepare for

**Q: Why not just use the native APIs directly?**
A: You can. But every project that needs Sheets + Airtable + Notion burns 2–3 days on OAuth + schema mapping + pagination. SheetBridge is the adapter layer you'd write anyway, but managed and with a paid SLA.

**Q: What happens when Airtable changes their API?**
A: The normalization layer absorbs it. The consuming app sees no change. That's the moat.

**Q: What about write consistency across sources?**
A: v0.1 targets one source per project. Cross-source transactions are out of scope — spreadsheet backends are fundamentally eventually-consistent.

**Q: Pricing seems expensive for what it is.**
A: SheetDB charges $39/mo for 50K reads/month on Sheets alone. SheetBridge at $49/mo covers 100K records/day + Airtable + Notion + rate-limit buffering. The comparison is favorable.
