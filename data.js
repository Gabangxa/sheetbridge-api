"use strict";

const mockRecords = [
  {
    id: "row_001",
    source: "sheets",
    fields: { Name: "Acme Corp", Status: "Active", Revenue: 12000 },
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
  },
  {
    id: "row_002",
    source: "sheets",
    fields: { Name: "Beta Labs", Status: "Trial", Revenue: 0 },
    created_at: "2026-03-05T14:00:00Z",
    updated_at: "2026-03-05T14:00:00Z",
  },
  {
    id: "row_003",
    source: "sheets",
    fields: { Name: "Gamma Studio", Status: "Active", Revenue: 4500 },
    created_at: "2026-03-10T08:00:00Z",
    updated_at: "2026-03-10T08:00:00Z",
  },
  {
    id: "row_004",
    source: "sheets",
    fields: { Name: "Delta Works", Status: "Churned", Revenue: 0 },
    created_at: "2026-03-12T16:00:00Z",
    updated_at: "2026-03-12T16:00:00Z",
  },
  {
    id: "row_005",
    source: "sheets",
    fields: { Name: "Epsilon Tech", Status: "Active", Revenue: 8900 },
    created_at: "2026-03-20T11:00:00Z",
    updated_at: "2026-03-20T11:00:00Z",
  },
];

/**
 * Find a single record by ID.
 * @param {string} id
 * @returns {object|undefined}
 */
function findById(id) {
  return mockRecords.find((r) => r.id === id);
}

/**
 * Filter records by source and/or a single field filter expression.
 * @param {object} opts
 * @param {string} [opts.source]        - e.g. "sheets"
 * @param {string} [opts.filter]        - e.g. "Status:Active"
 * @returns {object[]}
 */
function filterRecords({ source, filter } = {}) {
  let results = [...mockRecords];

  if (source) {
    results = results.filter((r) => r.source === source);
  }

  if (filter) {
    const colonIdx = filter.indexOf(":");
    if (colonIdx !== -1) {
      const fieldName = filter.slice(0, colonIdx);
      const fieldValue = filter.slice(colonIdx + 1);
      results = results.filter((r) => {
        const val = r.fields[fieldName];
        if (val === undefined) return false;
        // Numeric comparison support
        const numVal = Number(val);
        const numFilter = Number(fieldValue);
        if (!isNaN(numVal) && !isNaN(numFilter)) {
          return numVal === numFilter;
        }
        return String(val).toLowerCase() === fieldValue.toLowerCase();
      });
    }
  }

  return results;
}

/**
 * Sort an array of records by a field expression.
 * @param {object[]} records
 * @param {string} [sort] - e.g. "Revenue:desc" or "Name:asc"
 * @returns {object[]}
 */
function sortRecords(records, sort) {
  if (!sort) return records;

  const colonIdx = sort.indexOf(":");
  const fieldName = colonIdx !== -1 ? sort.slice(0, colonIdx) : sort;
  const direction = colonIdx !== -1 ? sort.slice(colonIdx + 1).toLowerCase() : "asc";
  const multiplier = direction === "desc" ? -1 : 1;

  return [...records].sort((a, b) => {
    const aVal = a.fields[fieldName];
    const bVal = b.fields[fieldName];

    if (aVal === undefined && bVal === undefined) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;

    const aNum = Number(aVal);
    const bNum = Number(bVal);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return multiplier * (aNum - bNum);
    }

    return multiplier * String(aVal).localeCompare(String(bVal));
  });
}

/**
 * Paginate a records array using cursor-based pagination.
 * Cursor is base64 JSON: {"offset": N}
 *
 * @param {object[]} records
 * @param {number} limit
 * @param {string} [cursor]
 * @returns {{ page: object[], next_cursor: string|null }}
 */
function paginate(records, limit, cursor) {
  let offset = 0;

  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      offset = Number(decoded.offset) || 0;
    } catch (_) {
      offset = 0;
    }
  }

  const page = records.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const next_cursor =
    nextOffset < records.length
      ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString("base64")
      : null;

  return { page, next_cursor };
}

module.exports = { mockRecords, findById, filterRecords, sortRecords, paginate };
