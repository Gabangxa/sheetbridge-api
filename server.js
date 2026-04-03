"use strict";

const express        = require("express");
const cors           = require("cors");
const path           = require("path");
const crypto         = require("crypto");
const session        = require("express-session");

// Stripe — only initialised when secret key is present so server boots without env
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

const db     = require("./db");
const sheets = require("./sheets");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Stripe price IDs (set via env, fall back to placeholders) ────────────────
const STRIPE_PRICE_STARTER = process.env.STRIPE_PRICE_STARTER || "price_starter_placeholder";
const STRIPE_PRICE_PRO     = process.env.STRIPE_PRICE_PRO     || "price_pro_placeholder";

// ── In-memory rate-limit window (per-minute bucket per API key) ──────────────
// { [apiKey]: { count: N, windowStart: ms } }
const rateBuckets = {};

function checkRateLimit(apiKey, limitPerMin) {
  const now = Date.now();
  const bucket = rateBuckets[apiKey];
  if (!bucket || now - bucket.windowStart >= 60_000) {
    rateBuckets[apiKey] = { count: 1, windowStart: now };
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limitPerMin;
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
// Raw body needed for Stripe webhook signature verification — mount before json parser
app.use("/webhooks/stripe", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret:            process.env.SESSION_SECRET || "dev_session_secret_change_in_prod",
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, httpOnly: true, maxAge: 30 * 60 * 1000 },
}));

// ── Auth middleware ──────────────────────────────────────────────────────────
// Attaches req.project if valid; otherwise 401
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({
      error: "Missing API key",
      hint:  "Add an Authorization: Bearer <key> header. Obtain a key at POST /v1/projects.",
    });
  }
  // Accept demo key for evaluation (free tier)
  if (token === "demo_key_sheetbridge") {
    req.project = { id: "demo", api_key: token, name: "Demo Project", tier: "free" };
    req.isDemo  = true;
    return next();
  }
  const project = db.getProjectByApiKey(token);
  if (!project) {
    return res.status(401).json({
      error: "Invalid API key",
      hint:  "Check your key at POST /v1/projects or upgrade at /pricing.",
    });
  }
  req.project = project;
  req.isDemo  = false;
  return next();
}

// ── Rate-limit + usage middleware (must come after requireAuth) ──────────────
function metered(req, res, next) {
  const { project, isDemo } = req;
  const tier  = project.tier || "free";
  const limit = db.RATE_LIMITS[tier] || 200;

  if (!checkRateLimit(project.api_key, limit)) {
    return res.status(429).json({
      error:       "Rate limit exceeded",
      limit_per_min: limit,
      tier,
      hint:        tier === "free"
        ? "Upgrade to Starter ($19/mo) or Pro ($49/mo) at /pricing for higher limits."
        : "You have hit your tier rate limit. Contact support if this is unexpected.",
    });
  }

  if (!isDemo) {
    // Daily usage metering — persisted in SQLite
    const todayUsage = db.getTodayUsage(project.api_key);
    const dailyLimit = db.TIER_LIMITS[tier] || 500;
    if (todayUsage >= dailyLimit) {
      return res.status(429).json({
        error:       "Daily usage limit exceeded",
        used_today:  todayUsage,
        daily_limit: dailyLimit,
        tier,
        hint:        "Upgrade your plan at /pricing to increase your daily limit.",
      });
    }
    db.incrementUsage(project.api_key);
  }

  return next();
}

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.1.0", timestamp: new Date().toISOString() });
});

// ── Docs / OpenAPI ───────────────────────────────────────────────────────────
app.get("/docs",        (req, res) => res.sendFile(path.join(__dirname, "public", "docs.html")));
app.get("/openapi.json",(req, res) => res.sendFile(path.join(__dirname, "openapi.json")));

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING — Project creation + Google Sheets OAuth connect
// ═══════════════════════════════════════════════════════════════════════════════

// POST /v1/projects — create project, receive API key
app.post("/v1/projects", (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Missing required field: name" });
  }
  const project = db.createProject(name.trim());
  res.status(201).json({
    message:     "Project created. Save your API key — it will not be shown again.",
    project_id:  project.id,
    api_key:     project.api_key,
    tier:        project.tier,
    next_steps: [
      "1. Connect Google Sheets: GET /auth/google?project_id=" + project.id,
      "2. Call GET /v1/sources to see your connected source",
      "3. Call GET /v1/records?source_id=<id> to fetch records",
      "4. Upgrade at /pricing for higher limits",
    ],
  });
});

// GET /auth/google — start OAuth; stores project_id in session
app.get("/auth/google", (req, res) => {
  const { project_id } = req.query;
  if (!project_id) {
    return res.status(400).json({ error: "Missing query param: project_id" });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({
      error: "Google OAuth not configured",
      hint:  "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.",
    });
  }
  req.session.pending_project_id = project_id;
  const url = sheets.getAuthUrl(project_id);
  res.redirect(url);
});

// GET /auth/google/callback — exchange code, store source
app.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect("/?error=" + encodeURIComponent("Google OAuth denied: " + error));
  }
  if (!code) {
    return res.status(400).json({ error: "Missing OAuth code" });
  }

  const projectId = state || req.session.pending_project_id;
  if (!projectId) {
    return res.status(400).json({ error: "No project_id in state or session. Restart OAuth flow." });
  }

  try {
    const tokens = await sheets.exchangeCode(code);
    // We store a placeholder source — user still needs to provide spreadsheet_id + sheet_name
    // For now redirect to /connect with the project_id + tokens in session
    req.session.pending_tokens    = tokens;
    req.session.pending_project_id = projectId;
    delete req.session.pending_project_id; // consumed
    res.redirect(`/connect?project_id=${encodeURIComponent(projectId)}`);
  } catch (err) {
    console.error("OAuth callback error:", err.message);
    res.status(503).json({ error: "Failed to exchange OAuth code", details: err.message });
  }
});

// GET /connect — HTML page to finalise source connection (spreadsheet ID + sheet name)
app.get("/connect", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "connect.html"));
});

// POST /v1/sources — finalise source connection after OAuth
app.post("/v1/sources", requireAuth, async (req, res) => {
  const { spreadsheet_id, sheet_name, name } = req.body || {};
  if (!spreadsheet_id) {
    return res.status(400).json({ error: "Missing required field: spreadsheet_id" });
  }

  // Grab pending tokens from session (set during OAuth callback)
  const tokens = req.session.pending_tokens;
  if (!tokens && !req.isDemo) {
    return res.status(400).json({
      error: "No pending OAuth tokens. Complete Google OAuth first at /auth/google?project_id=<id>",
    });
  }

  if (req.isDemo) {
    return res.status(403).json({
      error: "Demo API key cannot connect real sources. Create a project at POST /v1/projects.",
    });
  }

  try {
    const source = db.createSource(req.project.id, {
      name:          name || "My Google Sheet",
      spreadsheetId: spreadsheet_id,
      sheetName:     sheet_name || "Sheet1",
      accessToken:   tokens.access_token  || null,
      refreshToken:  tokens.refresh_token || "",
      tokenExpiry:   tokens.expiry_date   || null,
    });
    delete req.session.pending_tokens;
    res.status(201).json({
      message: "Source connected successfully.",
      source:  { id: source.id, name: source.name, type: source.type, status: source.status },
      next: "Call GET /v1/records?source_id=" + source.id + " to fetch records.",
    });
  } catch (err) {
    console.error("Source create error:", err.message);
    res.status(500).json({ error: "Failed to create source", details: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE CHECKOUT
// ═══════════════════════════════════════════════════════════════════════════════

// POST /v1/checkout — create a Stripe Checkout session
app.post("/v1/checkout", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "Payments not configured",
      hint:  "Set STRIPE_SECRET_KEY env var to enable checkout.",
    });
  }

  const { plan } = req.body || {};
  if (!["starter", "pro"].includes(plan)) {
    return res.status(400).json({ error: "plan must be 'starter' or 'pro'" });
  }

  if (req.isDemo) {
    return res.status(403).json({
      error: "Demo API key cannot checkout. Create a project at POST /v1/projects.",
    });
  }

  const priceId = plan === "pro" ? STRIPE_PRICE_PRO : STRIPE_PRICE_STARTER;
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode:                "subscription",
      payment_method_types: ["card"],
      line_items:          [{ price: priceId, quantity: 1 }],
      success_url:         `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:          `${baseUrl}/pricing`,
      client_reference_id: req.project.id,
      metadata:            { project_id: req.project.id, plan },
    });
    res.json({ checkout_url: checkoutSession.url, session_id: checkoutSession.id });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    res.status(502).json({ error: "Failed to create checkout session", details: err.message });
  }
});

// GET /checkout/success — post-payment landing page
app.get("/checkout/success", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Payment successful — SheetBridge</title>
  <style>
    body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:3rem;max-width:480px;text-align:center}
    h1{color:#3fb950;font-size:1.75rem;margin-bottom:1rem}
    p{color:#8b949e;margin-bottom:1.5rem}
    a.btn{display:inline-block;background:#58a6ff;color:#0d1117;font-weight:700;padding:.65rem 1.5rem;border-radius:6px;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment successful!</h1>
    <p>Your plan has been activated. Head back to the docs to get started with your upgraded API key.</p>
    <a class="btn" href="/docs">Open Docs</a>
  </div>
</body>
</html>`);
});

// POST /webhooks/stripe — Stripe event handler
app.post("/webhooks/stripe", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  const sig    = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("Stripe webhook signature mismatch:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const sess      = event.data.object;
      const projectId = sess.client_reference_id || sess.metadata?.project_id;
      const plan      = sess.metadata?.plan || "starter";
      if (projectId) {
        db.activatePlan(projectId, plan);
        console.log(`Plan activated: project=${projectId} plan=${plan}`);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub       = event.data.object;
      const projectId = sub.metadata?.project_id;
      if (projectId) {
        db.activatePlan(projectId, "free");
        console.log(`Plan downgraded to free: project=${projectId}`);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATA ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /v1/sources — list connected sources for this project
app.get("/v1/sources", requireAuth, (req, res) => {
  if (req.isDemo) {
    // Empty state for demo
    return res.json({
      sources: [],
      empty_state: {
        message: "No sources connected yet — connect Google Sheets to get started.",
        action:  "POST /v1/projects to create a project, then GET /auth/google?project_id=<id>",
      },
    });
  }
  const sources = db.getSourcesByProjectId(req.project.id).map(s => ({
    id:           s.id,
    type:         s.type,
    name:         s.name,
    spreadsheet_id: s.spreadsheet_id,
    sheet_name:   s.sheet_name,
    status:       s.status,
    connected_at: s.connected_at,
  }));

  if (sources.length === 0) {
    return res.json({
      sources: [],
      empty_state: {
        message: "No sources connected yet — connect Google Sheets to get started.",
        action:  "GET /auth/google?project_id=" + req.project.id,
      },
    });
  }
  res.json({ sources });
});

// GET /v1/records — list records from a connected source
app.get("/v1/records", requireAuth, metered, async (req, res) => {
  const { source_id, filter, sort, limit: limitStr, cursor } = req.query;
  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 10, 1), 100);

  if (req.isDemo) {
    // Return mock data for demo key
    const { mockRecords, filterRecords, sortRecords, paginate } = require("./data");
    let results = filterRecords({ filter });
    results = sortRecords(results, sort);
    const total = results.length;
    const { page, next_cursor } = paginate(results, limit, cursor);
    return res.json({ records: page, next_cursor, total, _demo: true });
  }

  if (!source_id) {
    return res.status(400).json({
      error: "Missing query param: source_id",
      hint:  "Get your source IDs at GET /v1/sources",
    });
  }

  const source = db.getSourceById(source_id);
  if (!source || source.project_id !== req.project.id) {
    return res.status(404).json({ error: "Source not found", source_id });
  }
  if (source.status !== "active") {
    return res.status(503).json({ error: "Source unavailable", source_id, status: source.status });
  }

  // Cursor is a base64-encoded offset integer
  const offset = cursor ? parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10) || 0 : 0;

  try {
    const { records, total } = await sheets.getRecords(source, { filter, sort, limit, offset });
    const nextOffset = offset + records.length;
    const next_cursor = nextOffset < total
      ? Buffer.from(String(nextOffset)).toString("base64")
      : null;
    res.json({ records, next_cursor, total });
  } catch (err) {
    console.error("Sheets getRecords error:", err.message);
    if (err.code === 401 || err.code === 403) {
      return res.status(503).json({ error: "Source auth failure — re-connect Google Sheets", details: err.message });
    }
    res.status(503).json({ error: "Source unavailable", details: err.message });
  }
});

// GET /v1/records/:id — get one record (id format: sheets::row::<rowIndex>)
app.get("/v1/records/:id", requireAuth, metered, async (req, res) => {
  const recordId = req.params.id;

  if (req.isDemo) {
    const { findById } = require("./data");
    const record = findById(recordId);
    if (!record) return res.status(404).json({ error: "Record not found", id: recordId });
    return res.json(record);
  }

  const parsed = parseRecordId(recordId);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid record ID format", id: recordId });
  }

  const source = db.getSourceById(parsed.sourceId);
  if (!source || source.project_id !== req.project.id) {
    return res.status(404).json({ error: "Record not found", id: recordId });
  }

  try {
    const record = await sheets.getRecordById(source, parsed.rowIndex);
    res.json(record);
  } catch (err) {
    console.error("Sheets getRecordById error:", err.message);
    res.status(503).json({ error: "Source unavailable", details: err.message });
  }
});

// POST /v1/records — create a record
app.post("/v1/records", requireAuth, metered, async (req, res) => {
  const { source_id, fields } = req.body || {};

  if (!fields || typeof fields !== "object") {
    return res.status(400).json({ error: "Missing or invalid field: fields (must be an object)" });
  }

  if (req.isDemo) {
    const { mockRecords } = require("./data");
    const { v4: uuidv4 }  = require("uuid");
    const now = new Date().toISOString();
    const newRecord = {
      id: "row_" + uuidv4().replace(/-/g, "").slice(0, 8),
      source: "sheets",
      fields: { ...fields },
      created_at: now,
      updated_at: now,
    };
    mockRecords.push(newRecord);
    return res.status(201).json(newRecord);
  }

  if (!source_id) {
    return res.status(400).json({ error: "Missing required field: source_id" });
  }

  const source = db.getSourceById(source_id);
  if (!source || source.project_id !== req.project.id) {
    return res.status(404).json({ error: "Source not found", source_id });
  }

  try {
    const record = await sheets.createRecord(source, fields);
    res.status(201).json(record);
  } catch (err) {
    console.error("Sheets createRecord error:", err.message);
    res.status(503).json({ error: "Source unavailable", details: err.message });
  }
});

// PATCH /v1/records/:id — update a record
app.patch("/v1/records/:id", requireAuth, metered, async (req, res) => {
  const recordId = req.params.id;
  const { fields } = req.body || {};

  if (!fields || typeof fields !== "object") {
    return res.status(400).json({ error: "Missing or invalid field: fields (must be an object)" });
  }

  if (req.isDemo) {
    const { findById } = require("./data");
    const record = findById(recordId);
    if (!record) return res.status(404).json({ error: "Record not found", id: recordId });
    Object.assign(record.fields, fields);
    record.updated_at = new Date().toISOString();
    return res.json(record);
  }

  const parsed = parseRecordId(recordId);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid record ID format", id: recordId });
  }

  const source = db.getSourceById(parsed.sourceId);
  if (!source || source.project_id !== req.project.id) {
    return res.status(404).json({ error: "Record not found", id: recordId });
  }

  try {
    const record = await sheets.updateRecord(source, parsed.rowIndex, fields);
    res.json(record);
  } catch (err) {
    console.error("Sheets updateRecord error:", err.message);
    res.status(503).json({ error: "Source unavailable", details: err.message });
  }
});

// DELETE /v1/records/:id — delete a record
app.delete("/v1/records/:id", requireAuth, metered, async (req, res) => {
  const recordId = req.params.id;

  if (req.isDemo) {
    const { mockRecords } = require("./data");
    const idx = mockRecords.findIndex(r => r.id === recordId);
    if (idx === -1) return res.status(404).json({ error: "Record not found", id: recordId });
    mockRecords.splice(idx, 1);
    return res.json({ deleted: true, id: recordId });
  }

  const parsed = parseRecordId(recordId);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid record ID format", id: recordId });
  }

  const source = db.getSourceById(parsed.sourceId);
  if (!source || source.project_id !== req.project.id) {
    return res.status(404).json({ error: "Record not found", id: recordId });
  }

  try {
    await sheets.deleteRecord(source, parsed.rowIndex);
    res.json({ deleted: true, id: recordId });
  } catch (err) {
    console.error("Sheets deleteRecord error:", err.message);
    res.status(503).json({ error: "Source unavailable", details: err.message });
  }
});

// ── 404 fallback for /v1/* ───────────────────────────────────────────────────
app.use("/v1/*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    hint:  "See GET /docs or GET /openapi.json for available endpoints",
  });
});

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
// Parse record IDs of the form "sheets::row::<sourceId_or_rowIndex>" or "sheets::row::<rowIndex>"
// db record IDs have format: sheets::row::<rowIndex>  (rowIndex is a number)
function parseRecordId(id) {
  if (!id) return null;
  const parts = id.split("::");
  // Format: sheets::row::<rowIndex>  (no source embedded in current implementation)
  if (parts.length === 3 && parts[0] === "sheets" && parts[1] === "row") {
    const rowIndex = parseInt(parts[2], 10);
    if (isNaN(rowIndex)) return null;
    return { rowIndex };
  }
  return null;
}

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SheetBridge API v1.1.0 listening on 0.0.0.0:${PORT}`);
  console.log(`  Landing : http://localhost:${PORT}/`);
  console.log(`  Docs    : http://localhost:${PORT}/docs`);
  console.log(`  Health  : http://localhost:${PORT}/health`);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("  WARNING: STRIPE_SECRET_KEY not set — payments disabled");
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn("  WARNING: GOOGLE_CLIENT_ID not set — OAuth disabled, demo mode only");
  }
});

module.exports = app;
