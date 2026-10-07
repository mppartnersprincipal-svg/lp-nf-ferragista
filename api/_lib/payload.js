// Validação do lote enviado pelo coletor (site/js/tracker.js) → linhas prontas para o banco.
// Função pura (sem rede), usada por api/collect.js e coberta por tests/collect.test.mjs.
import { classifyChannel, parseUA } from './classify.js';

export const EVENTS = new Set([
  'page_view', 'page_leave', 'click', 'section_view',
  'whatsapp_click', 'phone_click', 'cta_click', 'faq_open',
]);
export const PAGE_TYPES = new Set(['home']);
export const MAX_EVENTS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, n = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const int = (v, max = MAX_INT) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.round(Number(v)))) : null);
const MAX_INT = 2147483647;           // int do Postgres
const MAX_DURATION_MS = 6 * 3600000;  // 6 h de tempo visível
const MAX_SCREEN = 10000;
const decode = (v) => { try { return v ? decodeURIComponent(v) : null; } catch { return v || null; } };
const pageType = (v) => (PAGE_TYPES.has(v) ? v : null);

/**
 * @param {unknown} body  JSON do coletor: { s: sessão, e: eventos[], pt: page_type }
 * @param {{ headers?: Record<string, string|undefined>, now?: number }} ctx
 * @returns {{ ok: false } | { ok: true, session: object, rows: object[] }}
 */
export function buildBatch(body, { headers = {}, now = Date.now() } = {}) {
  if (!body || typeof body !== 'object' || !body.s || typeof body.s !== 'object') return { ok: false };
  const s = body.s;
  if (!UUID.test(s.id || '') || !Array.isArray(body.e) || body.e.length > MAX_EVENTS) return { ok: false };

  const pt = pageType(body.pt);
  const session = {
    id: s.id.toLowerCase(),
    visitor_id: str(s.visitor_id, 64),
    consent: ['accepted', 'essential'].includes(s.consent) ? s.consent : null,
    duration_ms: int(s.duration_ms, MAX_DURATION_MS),
    max_scroll_pct: int(s.max_scroll_pct, 100),
    // Somados no banco a cada lote: nunca mais que os eventos que cabem num lote
    wa_clicks: int(s.wa_clicks, MAX_EVENTS) || 0,
    phone_clicks: int(s.phone_clicks, MAX_EVENTS) || 0,
  };
  // Atribuição e ambiente só chegam no primeiro lote da sessão
  if (s.landing_path) {
    const attr = {
      landing_path: str(s.landing_path, 300),
      referrer_host: str(s.referrer_host, 120),
      utm_source: str(s.utm_source), utm_medium: str(s.utm_medium), utm_campaign: str(s.utm_campaign),
      utm_content: str(s.utm_content), utm_term: str(s.utm_term),
      gclid: Boolean(s.gclid),
    };
    Object.assign(session, attr, parseUA(headers['user-agent'] || ''), {
      channel: classifyChannel(attr),
      landing_page_type: pt,
      screen_w: int(s.screen_w, MAX_SCREEN), screen_h: int(s.screen_h, MAX_SCREEN),
      city: decode(headers['x-vercel-ip-city']), region: decode(headers['x-vercel-ip-country-region']),
      country: headers['x-vercel-ip-country'] || null,
      returning: Boolean(s.returning),
    });
  }

  // t = ms desde o carregamento da página; reconstrói o horário relativo ao recebimento
  const maxT = Math.max(0, ...body.e.map((e) => int(e && e.t) || 0));
  const rows = body.e
    .filter((e) => e && typeof e === 'object' && EVENTS.has(e.n))
    .map((e) => ({
      session_id: session.id,
      ts: new Date(now - (maxT - (int(e.t) || 0))).toISOString(),
      name: e.n,
      page_type: pt,
      props: sanitize(e.p),
    }));

  return { ok: true, session, rows };
}

/** Só chaves simples, strings curtas e números finitos (até 2 casas). */
export function sanitize(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const out = {};
  for (const [k, v] of Object.entries(p).slice(0, 12)) {
    if (!/^[a-z_0-9]{1,32}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 160);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}
