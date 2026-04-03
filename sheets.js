const { google } = require('googleapis');
const db = require('./db');

function getRedirectUri() {
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/auth/google/callback`;
}

function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
}

function getAuthUrl(projectId) {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures refresh_token is always returned
    scope: ['https://www.googleapis.com/auth/spreadsheets'],
    state: projectId,
  });
}

async function exchangeCode(code) {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

function getAuthenticatedClient(source) {
  const client = makeOAuthClient();
  client.setCredentials({
    access_token:  source.access_token,
    refresh_token: source.refresh_token,
    expiry_date:   source.token_expiry,
  });
  // Persist refreshed tokens back to DB automatically
  client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.updateSourceTokens(source.id, tokens.access_token, tokens.expiry_date || null);
    }
  });
  return client;
}

// ─── Records ─────────────────────────────────────────────

async function getRecords(source, { filter, sort, limit = 10, offset = 0 } = {}) {
  const auth = getAuthenticatedClient(source);
  const api = google.sheets({ version: 'v4', auth });

  const response = await api.spreadsheets.values.get({
    spreadsheetId: source.spreadsheet_id,
    range: source.sheet_name,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return { records: [], total: 0 }; // no data rows

  const headers = rows[0];
  let records = rows.slice(1).map((row, idx) => {
    const fields = {};
    headers.forEach((h, i) => { fields[h] = row[i] ?? null; });
    return {
      id: `sheets::row::${idx + 2}`, // 1-based; row 1 is header so data starts at 2
      source: 'sheets',
      resource_id: source.id,
      fields,
      created_at: null,
      updated_at: null,
    };
  });

  if (filter) {
    const sep = filter.indexOf(':');
    if (sep !== -1) {
      const field = filter.slice(0, sep);
      const value = filter.slice(sep + 1);
      records = records.filter(r => String(r.fields[field] ?? '') === String(value));
    }
  }

  if (sort) {
    const sep = sort.indexOf(':');
    if (sep !== -1) {
      const field = sort.slice(0, sep);
      const dir   = sort.slice(sep + 1).toLowerCase();
      records = records.slice().sort((a, b) => {
        const av = a.fields[field] ?? '';
        const bv = b.fields[field] ?? '';
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ?  1 : -1;
        return 0;
      });
    }
  }

  const total = records.length;
  return { records: records.slice(offset, offset + limit), total };
}

async function getRecordById(source, rowIndex) {
  const auth = getAuthenticatedClient(source);
  const api = google.sheets({ version: 'v4', auth });

  const [headerRes, rowRes] = await Promise.all([
    api.spreadsheets.values.get({
      spreadsheetId: source.spreadsheet_id,
      range: `${source.sheet_name}!1:1`,
    }),
    api.spreadsheets.values.get({
      spreadsheetId: source.spreadsheet_id,
      range: `${source.sheet_name}!${rowIndex}:${rowIndex}`,
    }),
  ]);

  const headers = (headerRes.data.values || [[]])[0];
  const row     = (rowRes.data.values   || [[]])[0] || [];
  const fields  = {};
  headers.forEach((h, i) => { fields[h] = row[i] ?? null; });

  return { id: `sheets::row::${rowIndex}`, source: 'sheets', resource_id: source.id, fields, created_at: null, updated_at: null };
}

async function createRecord(source, fields) {
  const auth = getAuthenticatedClient(source);
  const api = google.sheets({ version: 'v4', auth });

  // Get headers to order values correctly
  const headerRes = await api.spreadsheets.values.get({
    spreadsheetId: source.spreadsheet_id,
    range: `${source.sheet_name}!1:1`,
  });
  const headers = (headerRes.data.values || [[]])[0];

  // Get current row count to compute new row index
  const allRes = await api.spreadsheets.values.get({
    spreadsheetId: source.spreadsheet_id,
    range: source.sheet_name,
  });
  const newRowIndex = (allRes.data.values || []).length + 1;

  const row = headers.length > 0 ? headers.map(h => fields[h] ?? '') : Object.values(fields);

  await api.spreadsheets.values.append({
    spreadsheetId: source.spreadsheet_id,
    range: source.sheet_name,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] },
  });

  return {
    id: `sheets::row::${newRowIndex}`,
    source: 'sheets',
    resource_id: source.id,
    fields,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function updateRecord(source, rowIndex, fields) {
  const auth = getAuthenticatedClient(source);
  const api = google.sheets({ version: 'v4', auth });

  const [headerRes, rowRes] = await Promise.all([
    api.spreadsheets.values.get({
      spreadsheetId: source.spreadsheet_id,
      range: `${source.sheet_name}!1:1`,
    }),
    api.spreadsheets.values.get({
      spreadsheetId: source.spreadsheet_id,
      range: `${source.sheet_name}!${rowIndex}:${rowIndex}`,
    }),
  ]);

  const headers     = (headerRes.data.values || [[]])[0];
  const existingRow = (rowRes.data.values    || [[]])[0] || [];
  const existing    = {};
  headers.forEach((h, i) => { existing[h] = existingRow[i] ?? ''; });
  const merged = { ...existing, ...fields };
  const row = headers.map(h => merged[h] ?? '');

  await api.spreadsheets.values.update({
    spreadsheetId: source.spreadsheet_id,
    range: `${source.sheet_name}!${rowIndex}:${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] },
  });

  return {
    id: `sheets::row::${rowIndex}`,
    source: 'sheets',
    resource_id: source.id,
    fields: merged,
    created_at: null,
    updated_at: new Date().toISOString(),
  };
}

async function deleteRecord(source, rowIndex) {
  // Clear row values rather than deleting the row — keeps row indices stable
  const auth = getAuthenticatedClient(source);
  const api = google.sheets({ version: 'v4', auth });

  await api.spreadsheets.values.clear({
    spreadsheetId: source.spreadsheet_id,
    range: `${source.sheet_name}!${rowIndex}:${rowIndex}`,
  });

  return true;
}

module.exports = { getAuthUrl, exchangeCode, getRecords, getRecordById, createRecord, updateRecord, deleteRecord };
