// GA4 Data API com respostas simuladas (JWT da conta de serviço, períodos, linhas, configuração e erros).
// Nenhuma chamada real.
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { fetchGa4Report, GA4_EVENTS } from "../api/_lib/ga4.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  type: "service_account",
  client_email: "painel@construbloc-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const env = { GA4_PROPERTY_ID: "123456789", GA4_SERVICE_ACCOUNT_JSON: JSON.stringify(account) };
// 01 a 21/09 (término exclusivo à meia-noite de São Paulo) e o período anterior de 21 dias.
const range = {
  from: new Date("2026-09-01T03:00:00.000Z"),
  to: new Date("2026-09-22T03:00:00.000Z"),
  prevFrom: new Date("2026-08-11T03:00:00.000Z"),
  prevTo: new Date("2026-09-01T03:00:00.000Z"),
};
const accessToken = "test-access-secret";

const row = (dims, values) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: values.map((value) => ({ value: String(value) })),
});
const okReports = () => ({
  reports: [
    { rows: [row(["atual"], [200, 150, 120, 0.61, 95.5, 30]), row(["anterior"], [100, 80, 70, 0.5, 80, 10])], metadata: { timeZone: "America/Sao_Paulo" } },
    { rows: [row(["20260901"], [10, 2]), row(["20260902"], [12, 1])] },
    { rows: [row(["Paid Search"], [120, 90, 25]), row(["Direct"], [80, 60, 5])] },
    { rows: [row(["/areia"], [90, 70, 15])] },
    { rows: [row(["click_whatsapp", "atual"], [22]), row(["click_whatsapp", "anterior"], [8]), row(["click_phone", "atual"], [8])] },
  ],
});

function mockGoogle(t, overrides = {}) {
  const requests = [];
  const responses = { token: { body: { access_token: accessToken } }, reports: { body: okReports() }, ...overrides };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const phase = url.includes("oauth2") ? "token" : "reports";
    requests.push({ url, init, phase });
    const response = responses[phase];
    if (response instanceof Error) throw response;
    return Response.json(response.body, { status: response.status ?? 200 });
  });
  return requests;
}

function assertSafeError(report, pattern) {
  assert.equal(report.status, "error");
  assert.match(report.message, pattern);
  assert.deepEqual(Object.keys(report).sort(), ["message", "status"]);
  const serialized = JSON.stringify(report);
  for (const secret of [accessToken, "PRIVATE KEY", "Provider details"]) {
    assert.ok(!serialized.includes(secret), `Error response exposed ${secret}`);
  }
}

test("missing variables show a connection state without contacting Google", async (t) => {
  const requests = mockGoogle(t);
  for (const key of Object.keys(env)) {
    const report = await fetchGa4Report(range, { ...env, [key]: "" });
    assert.equal(report.status, "not_configured", key);
    assert.match(report.message, /GA4/);
  }
  assert.equal(requests.length, 0);
});

test("accepts GOOGLE_SERVICE_ACCOUNT_JSON (same variable as the other dashboards)", async (t) => {
  mockGoogle(t);
  const report = await fetchGa4Report(range, { GA4_PROPERTY_ID: env.GA4_PROPERTY_ID, GOOGLE_SERVICE_ACCOUNT_JSON: env.GA4_SERVICE_ACCOUNT_JSON });
  assert.equal(report.status, "ready");
});

test("rejects measurement IDs and broken service account JSON before contacting Google", async (t) => {
  const requests = mockGoogle(t);
  assertSafeError(await fetchGa4Report(range, { ...env, GA4_PROPERTY_ID: "G-0J96MVPZ7W" }), /ID numérico/);
  assertSafeError(await fetchGa4Report(range, { ...env, GA4_SERVICE_ACCOUNT_JSON: "{nope" }), /JSON completo/);
  assertSafeError(await fetchGa4Report(range, { ...env, GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "x" }) }), /JSON completo/);
  assert.equal(requests.length, 0);
});

test("signs a read-only JWT and queries the property with inclusive dates", async (t) => {
  const requests = mockGoogle(t);
  const report = await fetchGa4Report(range, { ...env, GA4_PROPERTY_ID: " properties/123456789 " });
  assert.equal(report.status, "ready");

  const oauth = requests.find((r) => r.phase === "token");
  const form = Object.fromEntries(new URLSearchParams(oauth.init.body));
  assert.equal(form.grant_type, "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [header, claims, signature] = form.assertion.split(".");
  assert.ok(verify("sha256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")));
  const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(payload.iss, account.client_email);
  assert.equal(payload.scope, "https://www.googleapis.com/auth/analytics.readonly");
  assert.equal(payload.exp - payload.iat, 3600);

  const data = requests.find((r) => r.phase === "reports");
  assert.equal(data.url, "https://analyticsdata.googleapis.com/v1beta/properties/123456789:batchRunReports");
  assert.equal(new Headers(data.init.headers).get("Authorization"), `Bearer ${accessToken}`);
  const body = JSON.parse(data.init.body);
  assert.equal(body.requests.length, 5);
  assert.deepEqual(body.requests[0].dateRanges, [
    { startDate: "2026-09-01", endDate: "2026-09-21", name: "atual" },
    { startDate: "2026-08-11", endDate: "2026-08-31", name: "anterior" },
  ]);
  assert.deepEqual(body.requests[4].dimensionFilter.filter.inListFilter.values, GA4_EVENTS);
});

test("maps totals, previous period, daily series, breakdowns and events", async (t) => {
  mockGoogle(t);
  const report = await fetchGa4Report(range, env);
  assert.equal(report.from, "2026-09-01");
  assert.equal(report.to, "2026-09-21");
  assert.equal(report.timeZone, "America/Sao_Paulo");
  assert.equal(report.thresholded, false);
  assert.deepEqual(report.totals, {
    sessions: 200, users: 150, newUsers: 120, engagementRate: 0.61,
    averageSessionDuration: 95.5, keyEvents: 30, keyEventRate: 0.15,
  });
  assert.equal(report.previous.sessions, 100);
  assert.deepEqual(report.daily[0], { date: "2026-09-01", sessions: 10, keyEvents: 2 });
  assert.deepEqual(report.channels[0], { key: "Paid Search", sessions: 120, users: 90, keyEvents: 25 });
  assert.equal(report.landingPages[0].key, "/areia");
  assert.deepEqual(report.events.find((e) => e.name === "click_whatsapp"), { name: "click_whatsapp", count: 22, previous: 8 });
  assert.deepEqual(report.events.find((e) => e.name === "click_maps"), { name: "click_maps", count: 0, previous: 0 });
});

test("empty property returns zeros and null rates instead of failing", async (t) => {
  mockGoogle(t, { reports: { body: { reports: [{}, {}, {}, {}, {}] } } });
  const report = await fetchGa4Report(range, env);
  assert.equal(report.status, "ready");
  assert.equal(report.totals.sessions, 0);
  assert.equal(report.totals.keyEventRate, null);
  assert.deepEqual(report.daily, []);
});

test("flags thresholded data", async (t) => {
  const body = okReports();
  body.reports[2].metadata = { subjectToThresholding: true };
  mockGoogle(t, { reports: { body } });
  assert.equal((await fetchGa4Report(range, env)).thresholded, true);
});

test("provider failures become safe messages", async (t) => {
  const cases = [
    [{ token: { status: 400, body: { error: "Provider details" } } }, /chave JSON/],
    [{ token: { status: 503, body: {} } }, /temporariamente indisponível/],
    [{ reports: { status: 403, body: { error: "Provider details" } } }, /Leitor/],
    [{ reports: { status: 404, body: {} } }, /não encontrada/],
    [{ reports: { status: 429, body: {} } }, /limite/],
    [{ reports: { body: { reports: [{}] } } }, /resposta inesperada/],
    [{ reports: { body: { reports: [{ rows: [row(["atual"], ["abc"])] }, {}, {}, {}, {}] } } }, /dados inválidos/],
    [{ reports: new TypeError("network down Provider details") }, /não foi concluída/],
  ];
  for (const [overrides, pattern] of cases) {
    await t.test(String(pattern), async (st) => {
      mockGoogle(st, overrides);
      assertSafeError(await fetchGa4Report(range, env), pattern);
    });
  }
});

test("invalid period never contacts Google", async (t) => {
  const requests = mockGoogle(t);
  assertSafeError(await fetchGa4Report({ ...range, to: range.from }, env), /período válido/);
  assert.equal(requests.length, 0);
});
