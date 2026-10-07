// Validação do lote do coletor (api/_lib/payload.js), usada por /api/collect.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBatch, sanitize, MAX_EVENTS } from '../api/_lib/payload.js';

const ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1';
const NOW = Date.parse('2026-10-05T15:00:00Z');
const first = (over = {}) => ({
  s: { id: ID.toUpperCase(), visitor_id: 'v-1', landing_path: '/?gclid=x', gclid: true, utm_campaign: 'Ferragista', screen_w: 390, screen_h: 844, returning: false, ...over },
  e: [{ n: 'page_view', t: 0, p: { sw: 390 } }],
  pt: 'home',
});

test('rejects malformed bodies', () => {
  const tooMany = { s: { id: ID }, e: Array.from({ length: MAX_EVENTS + 1 }, () => ({ n: 'click' })) };
  for (const body of [null, 'x', {}, { s: {} }, { s: { id: 'nao-e-uuid' }, e: [] }, { s: { id: ID }, e: 'x' }, tooMany]) {
    assert.equal(buildBatch(body).ok, false, String(JSON.stringify(body)).slice(0, 60));
  }
});

test('first batch carries attribution, channel, page type, device and Vercel geo headers', () => {
  const headers = { 'user-agent': UA, 'x-vercel-ip-city': 'Goi%C3%A2nia', 'x-vercel-ip-country-region': 'GO', 'x-vercel-ip-country': 'BR' };
  const b = buildBatch(first(), { headers, now: NOW });
  assert.equal(b.ok, true);
  assert.equal(b.session.id, ID); // normalizado para minúsculas
  assert.equal(b.session.channel, 'google_ads');
  assert.equal(b.session.landing_page_type, 'home');
  assert.equal(b.session.device, 'mobile');
  assert.equal(b.session.city, 'Goiânia');
  assert.equal(b.session.region, 'GO');
  assert.equal(b.session.country, 'BR');
  assert.equal(b.rows[0].page_type, 'home');
  assert.equal(b.rows[0].session_id, ID);
});

test('later batches only update counters and never overwrite attribution', () => {
  const b = buildBatch({ s: { id: ID, wa_clicks: 1, phone_clicks: 2, duration_ms: 5400.6, max_scroll_pct: 80 }, e: [], pt: 'home' }, { now: NOW });
  assert.equal(b.ok, true);
  assert.equal(b.session.wa_clicks, 1);
  assert.equal(b.session.phone_clicks, 2);
  assert.equal(b.session.duration_ms, 5401);
  for (const k of ['landing_path', 'channel', 'utm_campaign', 'landing_page_type', 'device', 'city']) assert.equal(k in b.session, false, k);
});

test('negative or invalid counters never become negative numbers', () => {
  const b = buildBatch({ s: { id: ID, wa_clicks: -5, phone_clicks: 'x', duration_ms: null }, e: [] });
  assert.equal(b.session.wa_clicks, 0);
  assert.equal(b.session.phone_clicks, 0);
  assert.equal(b.session.duration_ms, null);
});

test('drops unknown events and unknown page types; keeps the mirrored dataLayer events', () => {
  const names = ['page_view', 'whatsapp_click', 'phone_click', 'cta_click', 'faq_open', 'section_view', 'calculator_use', 'scroll_depth', 'gtm.js', 'evil'];
  const b = buildBatch({ s: { id: ID }, e: names.map((n, i) => ({ n, t: i * 100 })).concat([null, 'x']), pt: 'granel' }, { now: NOW });
  assert.deepEqual(b.rows.map((r) => r.name), names.slice(0, 6));
  assert.equal(b.rows[0].page_type, null);
});

test('rebuilds event timestamps from the page clock relative to arrival', () => {
  const b = buildBatch({ s: { id: ID }, e: [{ n: 'page_view', t: 0 }, { n: 'whatsapp_click', t: 4000 }] }, { now: NOW });
  assert.equal(b.rows[1].ts, new Date(NOW).toISOString());
  assert.equal(b.rows[0].ts, new Date(NOW - 4000).toISOString());
});

test('consent only accepts known values', () => {
  assert.equal(buildBatch({ s: { id: ID, consent: 'essential' }, e: [] }).session.consent, 'essential');
  assert.equal(buildBatch({ s: { id: ID, consent: 'hack' }, e: [] }).session.consent, null);
});

test('sanitize keeps fractional numbers (2 decimals) and string fields', () => {
  assert.deepEqual(sanitize({ product: 'brita', product_type: 'um', usage: 'concreto', volume_m3: 0.4567 }),
    { product: 'brita', product_type: 'um', usage: 'concreto', volume_m3: 0.46 });
});

test('sanitize drops bad keys, objects, arrays, non-finite numbers and truncates strings', () => {
  const out = sanitize({ ok: 'x'.repeat(500), 'Bad-Key': 1, nested: { a: 1 }, list: [1], inf: Infinity, nan: NaN, flag: true, none: null });
  assert.equal(out.ok.length, 160);
  assert.deepEqual(Object.keys(out).sort(), ['flag', 'none', 'ok']);
  assert.deepEqual(sanitize([1, 2]), {});
  assert.deepEqual(sanitize(null), {});
});

test('sanitize keeps at most 12 props', () => {
  const p = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(sanitize(p)).length, 12);
});

test("caps counters and sizes that the database sums or stores as int", () => {
  const b = buildBatch({ s: { id: ID, landing_path: "/", wa_clicks: 1e6, phone_clicks: 999, duration_ms: 9e12, max_scroll_pct: 500, screen_w: 1e10 }, e: [] });
  assert.equal(b.session.wa_clicks, MAX_EVENTS);
  assert.equal(b.session.phone_clicks, MAX_EVENTS);
  assert.equal(b.session.duration_ms, 6 * 3600000);
  assert.equal(b.session.max_scroll_pct, 100);
  assert.equal(b.session.screen_w, 10000);
});
