"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { mockRecords, findById, filterRecords, sortRecords, paginate } = require("./data");

const app = express();
const PORT = process.env.PORT || 3000;
const DEMO_API_KEY = "demo_key_sheetbridge";

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Auth middleware ─────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token !== DEMO_API_KEY) {
    return res.status(401).json({ error: "Missing or invalid API key" });
  }
  next();
}

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ── Docs page ───────────────────────────────────────────────────────────────
app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "docs.html"));
});

// ── OpenAPI spec ─────────────────────────────────────────────────────────────
app.get("/openapi.json", (req, res) => {
  res.sendFile(path.join(__dirname, "openapi.json"));
});

// ── GET /v1/sources ─────────────────────────────────────────────────────────
app.get("/v1/sources", requireAuth, (req, res) => {
  res.json({
    sources: [
      {
        id: "src_001",
        type: "sheets",
        name: "Customer CRM Sheet",
        connected_at: "2026-03-01T10:00:00Z",
        status: "active",
      },
      {
        id: "src_002",
        type: "airtable",
        name: "Product Backlog Base",
        connected_at: null,
        status: "coming_soon",
      },
      {
        id: "src_003",
        type: "notion",
        name: "Company Wiki DB",
        connected_at: null,
        status: "coming_soon",
      },
    ],
  });
});

// ── GET /v1/records ─────────────────────────────────────────────────────────
app.get("/v1/records", requireAuth, (req, res) => {
  const { source, filter, sort, limit: limitStr, cursor } = req.query;
  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 10, 1), 100);

  let results = filterRecords({ source, filter });
  results = sortRecords(results, sort);

  const total = results.length;
  const { page, next_cursor } = paginate(results, limit, cursor);

  res.json({ records: page, next_cursor, total });
});

// ── GET /v1/records/:id ─────────────────────────────────────────────────────
app.get("/v1/records/:id", requireAuth, (req, res) => {
  const record = findById(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "Record not found", id: req.params.id });
  }
  res.json(record);
});

// ── POST /v1/records ────────────────────────────────────────────────────────
app.post("/v1/records", requireAuth, (req, res) => {
  const { source, fields } = req.body || {};

  if (!source) {
    return res.status(400).json({ error: "Missing required field: source" });
  }
  if (!fields || typeof fields !== "object") {
    return res.status(400).json({ error: "Missing or invalid field: fields (must be an object)" });
  }

  const now = new Date().toISOString();
  const newRecord = {
    id: "row_" + uuidv4().replace(/-/g, "").slice(0, 8),
    source,
    fields: { ...fields },
    created_at: now,
    updated_at: now,
  };

  mockRecords.push(newRecord);
  res.status(201).json(newRecord);
});

// ── PATCH /v1/records/:id ───────────────────────────────────────────────────
app.patch("/v1/records/:id", requireAuth, (req, res) => {
  const record = findById(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "Record not found", id: req.params.id });
  }

  const { fields } = req.body || {};
  if (!fields || typeof fields !== "object") {
    return res.status(400).json({ error: "Missing or invalid field: fields (must be an object)" });
  }

  // Merge fields — do not replace existing fields not mentioned
  Object.assign(record.fields, fields);
  record.updated_at = new Date().toISOString();

  res.json(record);
});

// ── DELETE /v1/records/:id ──────────────────────────────────────────────────
app.delete("/v1/records/:id", requireAuth, (req, res) => {
  const idx = mockRecords.findIndex((r) => r.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Record not found", id: req.params.id });
  }

  mockRecords.splice(idx, 1);
  res.json({ deleted: true, id: req.params.id });
});

// ── 404 fallback for /v1/* ──────────────────────────────────────────────────
app.use("/v1/*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ── Global error handler ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SheetBridge API listening on 0.0.0.0:${PORT}`);
  console.log(`  Landing page : http://localhost:${PORT}/`);
  console.log(`  Docs         : http://localhost:${PORT}/docs`);
  console.log(`  Health       : http://localhost:${PORT}/health`);
  console.log(`  Demo API key : ${DEMO_API_KEY}`);
});

module.exports = app;
