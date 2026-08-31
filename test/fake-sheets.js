/**
 * In-memory Google Sheets double for testing the write layer without a
 * network or OAuth. Models just the subset of the Sheets REST API that
 * server/sheets.js uses: single-range values GET/PUT, :append,
 * values:batchUpdate, top-level :batchUpdate (deleteDimension), and the
 * metadata read. Times are stored verbatim (numbers stay numbers), so
 * serial-vs-string assertions are meaningful.
 *
 * Build a context with makeCtx(fake) and pass it where sheets.js wants `c`.
 */

const A = 'ABCDEFGHIJ'; // column letters for the 10-column Log

const colIdx = (letter) => A.indexOf(letter);

/** Parse an A1 range like 'Log!A2:J', 'Log!D3:E3', 'Log!A5', 'Settings!A1:A'. */
function parseRange(a1) {
  const [tab, rng] = a1.split('!');
  const m = /^([A-J])(\d+)?(?::([A-J])(\d+)?)?$/.exec(rng);
  const c1 = colIdx(m[1]);
  const r1 = m[2] ? Number(m[2]) : 1;
  const c2 = m[3] ? colIdx(m[3]) : c1;
  const r2 = m[4] ? Number(m[4]) : null; // null = open-ended
  return { tab, c1, r1, c2, r2 };
}

export class FakeSheets {
  // growth: null = the tab doesn't exist (a sheet from before growth
  // tracking); [] or rows = it exists with those data rows
  constructor(spreadsheetId, { log = [], settings = [], growth = null } = {}) {
    this.id = spreadsheetId;
    // rows are arrays of up to 10 cells; row 1 is the header
    this.tabs = {
      Log: [['id', 'type', 'start_time', 'end_time', 'duration_min',
        'side', 'amount_ml', 'notes', 'logged_by', 'formula_ml'], ...log],
      Settings: settings.slice(),
    };
    if (growth) {
      this.tabs.Growth = [['id', 'date', 'weight_kg', 'height_cm', 'notes', 'logged_by'],
        ...growth];
    }
    this.sheetIds = { Log: 111, Settings: 222, Growth: 333 };
    this.logSheetId = 111;
    this.requests = []; // audit trail of every write, for assertions
  }

  logRows() { return this.tabs.Log.slice(1); } // data rows only
  growthRows() { return (this.tabs.Growth || []).slice(1); }

  _readRange(a1) {
    const { tab, c1, r1, c2, r2 } = parseRange(a1);
    const rows = this.tabs[tab] || [];
    const end = r2 ?? rows.length;
    const out = [];
    for (let r = r1; r <= end; r++) {
      const row = rows[r - 1] || [];
      out.push(row.slice(c1, c2 + 1));
    }
    // trim trailing all-empty rows like Sheets does
    while (out.length && out[out.length - 1].every((v) => v == null || v === '')) out.pop();
    return out;
  }

  _writeRange(a1, values) {
    const { tab, c1, r1 } = parseRange(a1);
    const rows = this.tabs[tab];
    values.forEach((vals, i) => {
      const r = r1 + i - 1;
      while (rows.length <= r) rows.push([]);
      vals.forEach((v, j) => { rows[r][c1 + j] = v; });
    });
  }

  /** The fetch(url, options) the code calls; returns a Response-like object. */
  fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200 });

    // spreadsheets.create: fresh workbook with the requested tabs, in order
    if (method === 'POST' && path.endsWith('/v4/spreadsheets')) {
      this.requests.push({ op: 'create', body });
      this.tabs = {};
      const sheets = (body.sheets || []).map((s, i) => {
        this.tabs[s.properties.title] = [];
        return { properties: { title: s.properties.title,
          sheetId: this.sheetIds[s.properties.title] ?? 900 + i } };
      });
      return json({ spreadsheetId: this.id, sheets });
    }

    // like the real API, any read naming a missing tab is a 400
    const badRange = (a1) => !this.tabs[a1.split('!')[0]];
    const err400 = () => new Response(
      JSON.stringify({ error: { message: 'Unable to parse range' } }), { status: 400 });

    // metadata: /{id}?fields=sheets.properties[.title]
    if (method === 'GET' && /\/spreadsheets\/[^/]+$/.test(path) && u.searchParams.get('fields')) {
      return json({ sheets: Object.keys(this.tabs).map((title) => (
        { properties: { title, sheetId: this.sheetIds[title] } })) });
    }
    // values:batchGet
    if (method === 'GET' && path.endsWith('/values:batchGet')) {
      const ranges = u.searchParams.getAll('ranges');
      if (ranges.some(badRange)) return err400();
      return json({ valueRanges: ranges.map((r) => ({ values: this._readRange(r) })) });
    }
    // single-range values GET: /{id}/values/{a1}
    if (method === 'GET' && path.includes('/values/')) {
      const a1 = path.split('/values/')[1];
      if (badRange(a1)) return err400();
      return json({ values: this._readRange(a1) });
    }
    // :append — target tab comes from the range in the path. Like the real
    // API, rows land after the last row of the table in the range, but never
    // above the range's start row (an empty tab + range A2:F → row 2, not 1).
    if (method === 'POST' && path.endsWith(':append')) {
      const a1 = path.split('/values/')[1].replace(':append', '');
      const { tab, r1 } = parseRange(a1);
      this.requests.push({ op: 'append', tab, values: body.values });
      const rows = this.tabs[tab];
      while (rows.length < r1 - 1) rows.push([]);
      for (const row of body.values) rows.push(row.slice());
      return json({});
    }
    // values:batchUpdate (write ranges)
    if (method === 'POST' && path.endsWith('/values:batchUpdate')) {
      this.requests.push({ op: 'valuesBatchUpdate', data: body.data });
      for (const d of body.data) this._writeRange(d.range, d.values);
      return json({});
    }
    // single-range values PUT
    if (method === 'PUT' && path.includes('/values/')) {
      const a1 = path.split('/values/')[1];
      this.requests.push({ op: 'put', range: a1, values: body.values });
      this._writeRange(a1, body.values);
      return json({});
    }
    // top-level :batchUpdate (deleteDimension, addSheet, repeatCell)
    if (method === 'POST' && /:batchUpdate$/.test(path) && !path.includes('/values')) {
      this.requests.push({ op: 'batchUpdate', requests: body.requests });
      const replies = [];
      for (const req of body.requests) {
        if (req.deleteDimension) {
          const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
          const tab = Object.keys(this.sheetIds).find((t) => this.sheetIds[t] === sheetId);
          this.tabs[tab].splice(startIndex, endIndex - startIndex);
        }
        if (req.addSheet) {
          const { title } = req.addSheet.properties;
          if (this.tabs[title]) return err400();
          this.tabs[title] = [];
          replies.push({ addSheet: { properties: { sheetId: this.sheetIds[title] ?? 999 } } });
          continue;
        }
        replies.push({}); // repeatCell etc: audit only
      }
      return json({ replies });
    }
    return new Response('unhandled ' + method + ' ' + path, { status: 500 });
  };
}

/** A minimal Hono-like context wired to a fake (or a canned fetch). */
export function makeCtx(fakeOrFetch, spreadsheetId = 'sheet123') {
  const fetchFn = typeof fakeOrFetch === 'function' ? fakeOrFetch : fakeOrFetch.fetch;
  const user = { id: 'u1', email: 'p@example.com', sheet_id: spreadsheetId };
  return {
    env: { __gapi: { token: 'test-token', fetch: fetchFn } },
    get: (k) => (k === 'user' ? user : undefined),
  };
}
