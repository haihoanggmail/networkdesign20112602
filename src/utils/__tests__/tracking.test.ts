import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  SHEET_COLUMNS,
  TRACK_RATE_LIMIT_PER_MIN,
  formatVietnamTime,
  handleTrackRequest,
  isValidAppsScriptUrl,
  resetTrackRateLimiter,
  sanitizeSpreadsheetCell
} from '../../server/trackService';
import {
  getOrCreateSessionId,
  getVisitId,
  resetVisitTrackerForTest,
  trackExport,
  trackSave,
  trackTemplate,
  trackVisit
} from '../../services/tracker';
import { runStandaloneSuite, TestFn } from './testHarness';

interface MockSheetState {
  secret: string;
  forceError: boolean;
  delayMs: number;
  rows: string[][];
}

async function startMockAppsScriptServer(state: MockSheetState): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const finish = () => {
        if (state.forceError) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'sheet_error' }));
          return;
        }
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          if (!state.secret || payload.secret !== state.secret) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, skipped: true }));
            return;
          }
          state.rows.push([
            String(payload.time ?? ''),
            String(payload.ip ?? ''),
            String(payload.country ?? ''),
            String(payload.city ?? ''),
            String(payload.visitId ?? ''),
            String(payload.sessionId ?? ''),
            String(payload.action ?? ''),
            String(payload.detail ?? ''),
            String(payload.device ?? ''),
            String(payload.language ?? ''),
            String(payload.resolution ?? '')
          ]);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, skipped: true }));
        }
      };

      if (state.delayMs > 0) {
        const timer = setTimeout(finish, state.delayMs);
        res.on('close', () => clearTimeout(timer));
      } else {
        finish();
      }
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    url: `http://127.0.0.1:${addr.port}/exec`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      })
  };
}

export async function runTrackingTests(runTest: TestFn): Promise<void> {
  await runTest('Tracking: local mock Apps Script end-to-end relay & all 11 sheet columns + Vietnam time + formula escaping', async () => {
    resetTrackRateLimiter();
    const sheetState: MockSheetState = {
      secret: 'super-long-random-secret-key-2026',
      forceError: false,
      delayMs: 0,
      rows: []
    };
    const mockServer = await startMockAppsScriptServer(sheetState);

    try {
      const headers = {
        host: 'designer.hachihi.vn',
        origin: 'https://designer.hachihi.vn',
        'x-vercel-forwarded-for': '203.113.152.10',
        'x-vercel-ip-country': 'VN',
        'x-vercel-ip-city': 'Ho%20Chi%20Minh%20City'
      };

      const res = await handleTrackRequest({
        method: 'POST',
        headers,
        body: {
          visitId: 'v_1001',
          sessionId: 's_2002',
          action: 'export',
          detail: '=HYPERLINK("https://evil.test","pdf")',
          device: 'Desktop · Windows · Chrome',
          language: 'vi-VN',
          resolution: '1920x1080'
        },
        env: {
          URL_SHEET: mockServer.url,
          SERECT_SHEET: sheetState.secret
        },
        allowLocalTestUrl: true,
        now: new Date('2026-11-18T05:04:54.000Z')
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true });
      assert.equal(res.forwarded, true);
      assert.equal(sheetState.rows.length, 1);

      const row = sheetState.rows[0];
      assert.equal(row.length, SHEET_COLUMNS.length);
      assert.equal(row[0], '2026-11-18 12:04:54'); // UTC+7 Vietnam time
      assert.equal(row[1], '203.113.152.10');
      assert.equal(row[2], 'VN');
      assert.equal(row[3], 'Ho Chi Minh City');
      assert.equal(row[4], 'v_1001');
      assert.equal(row[5], 's_2002');
      assert.equal(row[6], 'export');
      assert.equal(row[7], '\'=HYPERLINK("https://evil.test","pdf")');
      assert.equal(row[8], 'Desktop · Windows · Chrome');
      assert.equal(row[9], 'vi-VN');
      assert.equal(row[10], '1920x1080');

      // SECRET_SHEET fallback works identically
      const fallbackRes = await handleTrackRequest({
        method: 'POST',
        headers,
        body: {
          visitId: 'v_1002',
          sessionId: 's_2002',
          action: 'save',
          detail: '+ProjectA'
        },
        env: {
          URL_SHEET: mockServer.url,
          SECRET_SHEET: sheetState.secret
        },
        allowLocalTestUrl: true
      });
      assert.equal(fallbackRes.forwarded, true);
      assert.equal(sheetState.rows.length, 2);
      assert.equal(sheetState.rows[1][6], 'save');
      assert.equal(sheetState.rows[1][7], "'+ProjectA");

      // Wrong secret rejected cleanly by Apps Script without throwing
      const wrongSecretRes = await handleTrackRequest({
        method: 'POST',
        headers,
        body: {
          visitId: 'v_1003',
          sessionId: 's_2002',
          action: 'visit'
        },
        env: {
          URL_SHEET: mockServer.url,
          SERECT_SHEET: 'wrong-secret'
        },
        allowLocalTestUrl: true
      });
      assert.equal(wrongSecretRes.statusCode, 200);
      assert.deepEqual(wrongSecretRes.body, { ok: true });
      assert.equal(wrongSecretRes.forwarded, false);
      assert.equal(sheetState.rows.length, 2);

      // Sheet HTTP 500 error silently ignored
      sheetState.forceError = true;
      const errRes = await handleTrackRequest({
        method: 'POST',
        headers,
        body: {
          visitId: 'v_1004',
          sessionId: 's_2002',
          action: 'template',
          detail: 'excel_device'
        },
        env: {
          URL_SHEET: mockServer.url,
          SERECT_SHEET: sheetState.secret
        },
        allowLocalTestUrl: true
      });
      assert.equal(errRes.statusCode, 200);
      assert.deepEqual(errRes.body, { ok: true });
      assert.equal(errRes.forwarded, false);
      assert.equal(sheetState.rows.length, 2);
    } finally {
      await mockServer.close();
    }
  });

  await runTest('Tracking: strict validation rejects bad URL_SHEET, bad Origin, invalid payloads, formula prefixes, and >40 req/min rate limit', async () => {
    resetTrackRateLimiter();

    assert.equal(isValidAppsScriptUrl('https://script.google.com/macros/s/abc/exec'), true);
    assert.equal(isValidAppsScriptUrl('http://script.google.com/macros/s/abc/exec'), false);
    assert.equal(isValidAppsScriptUrl('https://evil.com/macros/s/abc/exec'), false);
    assert.equal(isValidAppsScriptUrl('http://127.0.0.1:3000/exec'), false);

    assert.equal(sanitizeSpreadsheetCell('=1+1'), "'=1+1");
    assert.equal(sanitizeSpreadsheetCell('+SUM(A1)'), "'+SUM(A1)");
    assert.equal(sanitizeSpreadsheetCell('-100'), "'-100");
    assert.equal(sanitizeSpreadsheetCell('@cmd'), "'@cmd");
    assert.equal(sanitizeSpreadsheetCell('normal_pdf'), 'normal_pdf');

    assert.match(formatVietnamTime(new Date('2026-11-18T00:00:00.000Z')), /^2026-11-18 07:00:00$/);

    let fetchCount = 0;
    const stubFetch: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const validEnv = {
      URL_SHEET: 'https://script.google.com/macros/s/AKfycb123/exec',
      SERECT_SHEET: 'my-secret-token'
    };
    const sameOriginHeaders = {
      host: 'designer.hachihi.vn',
      origin: 'https://designer.hachihi.vn',
      'x-vercel-forwarded-for': '198.51.100.42'
    };

    // Missing env
    const missingEnv = await handleTrackRequest({
      method: 'POST',
      headers: sameOriginHeaders,
      body: { visitId: 'v1', sessionId: 's1', action: 'visit' },
      env: {},
      fetchImpl: stubFetch
    });
    assert.equal(missingEnv.forwarded, false);
    assert.equal(missingEnv.skipReason, 'missing_env');

    // Non-script.google.com URL_SHEET
    const badUrl = await handleTrackRequest({
      method: 'POST',
      headers: sameOriginHeaders,
      body: { visitId: 'v1', sessionId: 's1', action: 'visit' },
      env: { URL_SHEET: 'https://example.com/exec', SERECT_SHEET: 'abc' },
      fetchImpl: stubFetch
    });
    assert.equal(badUrl.forwarded, false);
    assert.equal(badUrl.skipReason, 'invalid_sheet_url');

    // Cross-origin blocked
    const badOrigin = await handleTrackRequest({
      method: 'POST',
      headers: {
        host: 'designer.hachihi.vn',
        origin: 'https://attacker.example',
        'x-vercel-forwarded-for': '198.51.100.42'
      },
      body: { visitId: 'v1', sessionId: 's1', action: 'visit' },
      env: validEnv,
      fetchImpl: stubFetch
    });
    assert.equal(badOrigin.forwarded, false);
    assert.equal(badOrigin.skipReason, 'origin_denied');

    // Invalid action / missing VisitID
    const badPayload = await handleTrackRequest({
      method: 'POST',
      headers: sameOriginHeaders,
      body: { visitId: '', sessionId: 's1', action: 'delete_all' },
      env: validEnv,
      fetchImpl: stubFetch
    });
    assert.equal(badPayload.forwarded, false);
    assert.equal(badPayload.skipReason, 'invalid_payload');
    assert.equal(fetchCount, 0);

    // Rate limit: allow 40 per minute from same IP, skip 41st
    resetTrackRateLimiter();
    for (let i = 0; i < TRACK_RATE_LIMIT_PER_MIN; i++) {
      const ok = await handleTrackRequest({
        method: 'POST',
        headers: sameOriginHeaders,
        body: { visitId: `v_${i}`, sessionId: 's_rl', action: 'visit' },
        env: validEnv,
        fetchImpl: stubFetch,
        now: new Date('2026-11-18T10:00:00.000Z')
      });
      assert.equal(ok.forwarded, true);
    }
    const overLimit = await handleTrackRequest({
      method: 'POST',
      headers: sameOriginHeaders,
      body: { visitId: 'v_41', sessionId: 's_rl', action: 'visit' },
      env: validEnv,
      fetchImpl: stubFetch,
      now: new Date('2026-11-18T10:00:30.000Z')
    });
    assert.equal(overLimit.statusCode, 200);
    assert.deepEqual(overLimit.body, { ok: true });
    assert.equal(overLimit.forwarded, false);
    assert.equal(overLimit.skipReason, 'rate_limited');
    assert.equal(fetchCount, TRACK_RATE_LIMIT_PER_MIN);
  });

  await runTest('Tracking: network timeout (>4s) and network error are swallowed cleanly without breaking API contract', async () => {
    resetTrackRateLimiter();

    const failingFetch: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const netErrRes = await handleTrackRequest({
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      body: { visitId: 'v_net', sessionId: 's_net', action: 'export', detail: 'svg' },
      env: {
        URL_SHEET: 'https://script.google.com/macros/s/AKfycb123/exec',
        SERECT_SHEET: 'secret'
      },
      fetchImpl: failingFetch
    });
    assert.equal(netErrRes.statusCode, 200);
    assert.deepEqual(netErrRes.body, { ok: true });
    assert.equal(netErrRes.forwarded, false);
    assert.equal(netErrRes.skipReason, 'network_error');

    const abortFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const timeoutRes = await handleTrackRequest({
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      body: { visitId: 'v_to', sessionId: 's_to', action: 'visit' },
      env: {
        URL_SHEET: 'https://script.google.com/macros/s/AKfycb123/exec',
        SERECT_SHEET: 'secret'
      },
      fetchImpl: abortFetch
    });
    assert.equal(timeoutRes.statusCode, 200);
    assert.deepEqual(timeoutRes.body, { ok: true });
    assert.equal(timeoutRes.forwarded, false);
    assert.equal(timeoutRes.skipReason, 'timeout');
  });

  await runTest('Tracking: client tracker manages VisitID, SessionID, deduplicates visit, and ignores fetch failure', async () => {
    resetVisitTrackerForTest();
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const store = new Map<string, string>();
    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevNavigator = (globalThis as Record<string, unknown>).navigator;
    const prevFetch = globalThis.fetch;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        location: { pathname: '/designer' },
        screen: { width: 1440, height: 900 },
        innerWidth: 1440,
        innerHeight: 900,
        sessionStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, v);
          }
        }
      }
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
        language: 'vi-VN'
      }
    });
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(url),
        body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      });
      throw new Error('simulated offline');
    }) as typeof fetch;

    try {
      const v1 = getVisitId();
      const s1 = getOrCreateSessionId();
      const s2 = getOrCreateSessionId();
      assert.equal(s1, s2);
      assert.ok(v1.startsWith('v_'));
      assert.ok(s1.startsWith('s_'));

      trackVisit();
      trackVisit(); // React StrictMode double-mount deduplicated
      trackTemplate('excel_device');
      trackSave('My Project');
      trackExport('handover_bundle');
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.equal(sent.length, 4);
      assert.equal(sent[0].url, '/api/track');
      assert.equal(sent[0].body.action, 'visit');
      assert.equal(sent[1].body.action, 'template');
      assert.equal(sent[1].body.detail, 'excel_device');
      assert.equal(sent[2].body.action, 'save');
      assert.equal(sent[3].body.action, 'export');
      assert.equal(sent[3].body.detail, 'handover_bundle');
      assert.equal(sent[0].body.resolution, '1440x900');
      assert.equal(sent[0].body.language, 'vi-VN');
    } finally {
      resetVisitTrackerForTest();
      globalThis.fetch = prevFetch;
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: prevWindow });
      }
      if (prevNavigator === undefined) {
        delete (globalThis as Record<string, unknown>).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: prevNavigator });
      }
    }
  });

  await runTest('Tracking: apps-script/Code.gs defines exact 11 column headers and secret verification', () => {
    const gsPath = path.resolve(process.cwd(), 'apps-script/Code.gs');
    const code = fs.readFileSync(gsPath, 'utf8');
    for (const col of SHEET_COLUMNS) {
      assert.ok(code.includes(`'${col}'`), `Code.gs must define column ${col}`);
    }
    assert.ok(code.includes('SERECT_SHEET'));
    assert.ok(code.includes('SECRET_SHEET'));
    assert.ok(code.includes('PropertiesService.getScriptProperties()'));
    assert.ok(code.includes('LockService.getScriptLock()'));
  });
}

runStandaloneSuite(import.meta.url, runTrackingTests);
