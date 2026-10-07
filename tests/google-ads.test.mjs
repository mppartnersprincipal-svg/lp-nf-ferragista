// Porte de tests/google-ads.test.mjs da Sólida: respostas simuladas da API (datas, micros,
// conversões fracionárias, lotes do SearchStream, configuração e erros). Nenhuma chamada real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGoogleAdsReport } from "../api/_lib/google-ads.js";

const env = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "test-developer-secret",
  GOOGLE_ADS_CLIENT_ID: "test-client-id",
  GOOGLE_ADS_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-secret",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
};
const range = {
  from: new Date("2026-09-01T03:00:00.000Z"),
  to: new Date("2026-09-22T03:00:00.000Z"),
};
const customer = {
  id: "1234567890",
  descriptiveName: "Nova Ferragista",
  currencyCode: "BRL",
  timeZone: "America/Sao_Paulo",
};
const accessToken = "test-access-secret";
const providerSecrets = "Provider details test-refresh-secret test-access-secret test-client-secret";

function mockGoogle(t, overrides = {}) {
  const requests = [];
  const responses = {
    token: { body: { access_token: accessToken } },
    metadata: { body: [{ results: [{ customer }] }] },
    totals: { body: [] },
    campaigns: { body: [] },
    ...overrides,
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const query = url.includes("oauth2") ? null : JSON.parse(init.body).query;
    const phase = query === null ? "token"
      : query.includes("customer.id") ? "metadata"
        : /FROM campaign\b/.test(query) ? "campaigns" : "totals";
    requests.push({ url, init, query, phase });
    const response = responses[phase];
    if (response instanceof Error) throw response;
    return Response.json(response.body, { status: response.status ?? 200 });
  });
  return requests;
}

function assertSafeError(report, messagePattern) {
  assert.equal(report.status, "error");
  assert.match(report.message, messagePattern);
  assert.deepEqual(Object.keys(report).sort(), ["message", "status"]);
  const serialized = JSON.stringify(report);
  for (const secret of [env.GOOGLE_ADS_DEVELOPER_TOKEN, env.GOOGLE_ADS_CLIENT_SECRET,
    env.GOOGLE_ADS_REFRESH_TOKEN, accessToken, "Provider details"]) {
    assert.ok(!serialized.includes(secret), `Error response exposed ${secret}`);
  }
}

test("missing credentials show a connection state without contacting Google", async (t) => {
  const requests = mockGoogle(t);
  for (const key of Object.keys(env)) {
    const report = await fetchGoogleAdsReport(range, { ...env, [key]: "" });
    assert.equal(report.status, "not_configured", key);
    assert.match(report.message, /Google Ads/);
  }
  assert.equal(requests.length, 0);
});

test("refreshes OAuth and sends normalized customer/MCC IDs only in server requests", async (t) => {
  const requests = mockGoogle(t);
  const report = await fetchGoogleAdsReport(range, {
    ...env,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: " 987-654-3210 ",
    GOOGLE_ADS_API_VERSION: "v25",
  });
  assert.equal(report.status, "ready");
  const oauth = requests.find((request) => request.phase === "token");
  assert.equal(oauth.url, "https://oauth2.googleapis.com/token");
  assert.equal(oauth.init.method, "POST");
  assert.equal(new Headers(oauth.init.headers).get("Content-Type"), "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(oauth.init.body)), {
    grant_type: "refresh_token",
    client_id: env.GOOGLE_ADS_CLIENT_ID,
    client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
    refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
  });
  const queries = requests.filter((request) => request.query);
  assert.equal(queries.length, 3);
  for (const request of queries) {
    assert.equal(request.url, "https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream");
    assert.equal(request.init.method, "POST");
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${accessToken}`);
    assert.equal(headers.get("developer-token"), env.GOOGLE_ADS_DEVELOPER_TOKEN);
    assert.equal(headers.get("login-customer-id"), "9876543210");
  }
  for (const request of requests) {
    assert.equal(request.init.cache, "no-store");
    assert.ok(request.init.signal instanceof AbortSignal);
  }
  assert.deepEqual(report.customer, {
    id: customer.id, name: customer.descriptiveName,
    currencyCode: "BRL", timeZone: "America/Sao_Paulo",
  });
  assert.ok(Number.isFinite(Date.parse(report.fetchedAt)));
  assert.ok(!JSON.stringify(report).includes(accessToken));
});

test("an advertiser connected directly does not send a login-customer-id header", async (t) => {
  const requests = mockGoogle(t);
  assert.equal((await fetchGoogleAdsReport(range, env)).status, "ready");
  for (const request of requests.filter((request) => request.query)) {
    assert.equal(new Headers(request.init.headers).has("login-customer-id"), false);
  }
});

test("maps São Paulo dashboard periods to inclusive GAQL dates", async (t) => {
  for (const scenario of [
    { name: "today", from: "2026-09-21T03:00:00Z", to: "2026-09-22T03:00:00Z", expectedFrom: "2026-09-21", expectedTo: "2026-09-21" },
    { name: "custom period", from: "2026-09-01T03:00:00Z", to: "2026-09-22T03:00:00Z", expectedFrom: "2026-09-01", expectedTo: "2026-09-21" },
    { name: "year boundary", from: "2025-12-31T03:00:00Z", to: "2026-01-01T03:00:00Z", expectedFrom: "2025-12-31", expectedTo: "2025-12-31" },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const requests = mockGoogle(subtest);
      const report = await fetchGoogleAdsReport({ from: new Date(scenario.from), to: new Date(scenario.to) }, env);
      assert.equal(report.status, "ready");
      assert.equal(report.from, scenario.expectedFrom);
      assert.equal(report.to, scenario.expectedTo);
      const metricQueries = requests.filter((request) => ["totals", "campaigns"].includes(request.phase));
      assert.equal(metricQueries.length, 2);
      for (const { query } of metricQueries) {
        assert.ok(query.includes(`segments.date BETWEEN '${scenario.expectedFrom}' AND '${scenario.expectedTo}'`));
      }
    });
  }
});

test("preserves fractional conversions and derives account ratios from account totals", async (t) => {
  mockGoogle(t, {
    totals: { body: [{ results: [{ metrics: {
      impressions: "1400", clicks: "80", costMicros: "200000000",
      conversions: "4.5",
    } }] }] },
    campaigns: { body: [
      { results: [{ campaign: { id: "1", name: "Areia ensacada", status: "ENABLED" }, metrics: {
        impressions: "100", clicks: "50", costMicros: "150000000", conversions: "2.5",
      } }] },
      { results: [{ campaign: { id: "2", name: "Brita ensacada", status: "PAUSED" }, metrics: {
        impressions: 900, clicks: 20, costMicros: 25000000, conversions: 1,
      } }] },
      {},
    ] },
  });
  const report = await fetchGoogleAdsReport(range, env);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.totals, {
    impressions: 1400, clicks: 80, cost: 200, conversions: 4.5,
    ctr: 80 / 1400, averageCpc: 2.5, costPerConversion: 200 / 4.5,
  });
  assert.deepEqual(report.campaigns.map((campaign) => campaign.id), ["1", "2"]);
  assert.equal(report.campaigns[0].conversions, 2.5);
  assert.equal(report.campaigns[0].cost, 150);
  assert.equal(report.campaigns[1].status, "PAUSED");
  assert.notEqual(report.totals.ctr, (report.campaigns[0].ctr + report.campaigns[1].ctr) / 2);
  assert.notEqual(report.totals.averageCpc, (report.campaigns[0].averageCpc + report.campaigns[1].averageCpc) / 2);
});

test("omitted protobuf zero fields and empty periods have zero totals and null ratios", async (t) => {
  for (const totals of [[], [{ results: [{}] }]]) {
    await t.test(JSON.stringify(totals), async (subtest) => {
      mockGoogle(subtest, {
        totals: { body: totals },
        campaigns: { body: [{ results: [{ campaign: { id: "1" } }] }] },
      });
      const report = await fetchGoogleAdsReport(range, env);
      assert.equal(report.status, "ready");
      const expected = {
        impressions: 0, clicks: 0, cost: 0, conversions: 0,
        ctr: null, averageCpc: null, costPerConversion: null,
      };
      assert.deepEqual(report.totals, expected);
      assert.deepEqual(report.campaigns[0], { id: "1", name: "Campanha sem nome", status: "UNKNOWN", ...expected });
    });
  }
});

test("invalid account IDs, MCC IDs, and versions fail before network access", async (t) => {
  const requests = mockGoogle(t);
  for (const override of [
    { GOOGLE_ADS_CUSTOMER_ID: "123456789" },
    { GOOGLE_ADS_CUSTOMER_ID: "123456789x" },
    { GOOGLE_ADS_LOGIN_CUSTOMER_ID: "123" },
    { GOOGLE_ADS_API_VERSION: "v25/another-path" },
  ]) {
    assertSafeError(await fetchGoogleAdsReport(range, { ...env, ...override }), /configuração/);
  }
  assert.equal(requests.length, 0);
});

test("invalid or reversed date ranges fail before network access", async (t) => {
  const requests = mockGoogle(t);
  for (const invalid of [
    { from: new Date("invalid"), to: range.to },
    { from: range.from, to: new Date("invalid") },
    { from: range.to, to: range.from },
    { from: range.from, to: range.from },
  ]) {
    assertSafeError(await fetchGoogleAdsReport(invalid, env), /período válido/);
  }
  assert.equal(requests.length, 0);
});

test("rejects a manager account before attempting performance queries", async (t) => {
  const requests = mockGoogle(t, { metadata: { body: [{ results: [{ customer: { ...customer, manager: true } }] }] } });
  assertSafeError(await fetchGoogleAdsReport(range, env), /conta de administrador/);
  assert.deepEqual(requests.map((request) => request.phase), ["token", "metadata"]);
});

test("OAuth failures are safe and stop before account queries", async (t) => {
  for (const status of [400, 401, 429, 500]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      const requests = mockGoogle(subtest, { token: { status, body: { error_description: providerSecrets } } });
      assertSafeError(await fetchGoogleAdsReport(range, env), status >= 429 ? /temporariamente indisponível/ : /autorizar/);
      assert.deepEqual(requests.map((request) => request.phase), ["token"]);
    });
  }
});

test("permission, quota, and individual report failures never return partial metrics or provider details", async (t) => {
  for (const scenario of [
    { phase: "metadata", status: 401, message: /permissões/ },
    { phase: "metadata", status: 403, message: /permissões/ },
    { phase: "totals", status: 429, message: /limite de consultas/ },
    { phase: "campaigns", status: 500, message: /consultar o Google Ads/ },
  ]) {
    await t.test(`${scenario.phase} HTTP ${scenario.status}`, async (subtest) => {
      mockGoogle(subtest, { [scenario.phase]: { status: scenario.status, body: { error: providerSecrets } } });
      assertSafeError(await fetchGoogleAdsReport(range, env), scenario.message);
    });
  }
});

test("malformed provider payloads and invalid numbers cannot appear as successful metrics", async (t) => {
  const scenarios = [
    { name: "missing OAuth access token", overrides: { token: { body: {} } } },
    { name: "missing account identity", overrides: { metadata: { body: [] } } },
    { name: "non-array stream", overrides: { totals: { body: { results: [] } } } },
    { name: "embedded stream error", overrides: { campaigns: { body: [{ error: providerSecrets }] } } },
    { name: "invalid results array", overrides: { totals: { body: [{ results: {} }] } } },
    { name: "null stream chunk", overrides: { campaigns: { body: [null] } } },
    { name: "primitive stream chunk", overrides: { totals: { body: [1] } } },
    { name: "nested stream array", overrides: { totals: { body: [[]] } } },
    { name: "missing campaign ID", overrides: { campaigns: { body: [{ results: [{ metrics: {} }] }] } } },
    { name: "nonnumeric impressions", overrides: { totals: { body: [{ results: [{ metrics: { impressions: "invalid" } }] }] } } },
    { name: "infinite cost", overrides: { totals: { body: [{ results: [{ metrics: { costMicros: "Infinity" } }] }] } } },
    { name: "network exception with secrets", overrides: { totals: new Error(providerSecrets) } },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      mockGoogle(subtest, scenario.overrides);
      assertSafeError(await fetchGoogleAdsReport(range, env), /Google Ads/);
    });
  }
});

test("reads every SearchStream batch, beyond the first 50 campaigns, including paused ones", async (t) => {
  const batch = (start, n, status) => ({ results: Array.from({ length: n }, (_, i) => ({
    campaign: { id: String(start + i), name: `Campanha ${start + i}`, status },
    metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
  })) });
  mockGoogle(t, { campaigns: { body: [batch(1, 40, "ENABLED"), batch(41, 40, "PAUSED"), batch(81, 5, "REMOVED")] } });
  const report = await fetchGoogleAdsReport(range, env);
  assert.equal(report.status, "ready");
  assert.equal(report.campaigns.length, 85);
  assert.equal(report.campaigns.filter((c) => c.status === "PAUSED").length, 40);
  assert.equal(report.campaigns[84].cost, 1);
});
