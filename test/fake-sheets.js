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
  constructor(spreadsheetId, { log = [], settings = [] } = {}) {
    this.id = spreadsheetId;
    // rows are arrays of up to 10 cells; row 1 is the header
    this.tabs = {
      Log: [['id', 'type', 'start_time', 'end_time', 'duration_min',
        'side', 'amount_ml', 'notes', 'logged_by', 'formula_ml'], ...log],
      Settings: settings.slice(),
    };
    this.logSheetId = 111;
    this.requests = []; // audit trail of every write, for assertions
  }

  logRows() { return this.tabs.Log.slice(1); } // data rows only

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

    // metadata: /{id}?fields=sheets.properties[.title]
    if (method === 'GET' && /\/spreadsheets\/[^/]+$/.test(path) && u.searchParams.get('fields')) {
      return json({ sheets: [
        { properties: { title: 'Log', sheetId: this.logSheetId } },
        { properties: { title: 'Settings', sheetId: 222 } },
      ] });
    }
    // values:batchGet
    if (method === 'GET' && path.endsWith('/values:batchGet')) {
      const ranges = u.searchParams.getAll('ranges');
      return json({ valueRanges: ranges.map((r) => ({ values: this._readRange(r) })) });
    }
    // single-range values GET: /{id}/values/{a1}
    if (method === 'GET' && path.includes('/values/')) {
      const a1 = path.split('/values/')[1];
      return json({ values: this._readRange(a1) });
    }
    // :append — target tab comes from the range in the path
    if (method === 'POST' && path.endsWith(':append')) {
      const a1 = path.split('/values/')[1].replace(':append', '');
      const tab = a1.split('!')[0];
      this.requests.push({ op: 'append', tab, values: body.values });
      for (const row of body.values) this.tabs[tab].push(row.slice());
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
    // top-level :batchUpdate (deleteDimension)
    if (method === 'POST' && /:batchUpdate$/.test(path) && !path.includes('/values')) {
      this.requests.push({ op: 'batchUpdate', requests: body.requests });
      for (const req of body.requests) {
        if (req.deleteDimension) {
          const { startIndex, endIndex } = req.deleteDimension.range;
          this.tabs.Log.splice(startIndex, endIndex - startIndex);
        }
      }
      return json({});
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
