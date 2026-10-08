// Agregações do /dashboard a partir das linhas cruas (sessões + eventos). Funções puras, sem rede.
// Usado por api/dashboard.js.
import { TZ_OFFSET_MS, localDate } from './period.js';

// Seções da LP, na ordem de leitura. A chave vem do tracker: id da <section>, aria-labelledby sem "-t"
// ou id do bloco pai (hero = #topo).
export const SECTIONS = {
  home: ['topo', 'numeros', 'dores', 'dif', 'categorias', 'produtos', 'obras', 'sobre', 'loja', 'como', 'avaliacoes', 'duvidas', 'final', 'contato'],
};
export const SECTION_LABEL = {
  topo: 'Hero', numeros: 'Números', dores: 'Dores', dif: 'Diferenciais', categorias: 'Categorias', produtos: 'Produtos mais procurados',
  obras: 'Construtores e empresas', sobre: 'Sobre', loja: 'Por dentro da loja', como: 'Como funciona',
  avaliacoes: 'Avaliações', duvidas: 'FAQ', final: 'CTA final', contato: 'Localização',
};

const MAX_JOURNEYS = 60;
const MAX_TRAIL = 40;
const MAX_CLICKS = 40;
const MAX_CITIES = 15;

const pct1 = (a, b) => (b ? +(a / b * 100).toFixed(1) : 0);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const contacts = (s) => (s.wa_clicks || 0) + (s.phone_clicks || 0);
const converted = (s) => contacts(s) > 0;

export function count(arr, fn) {
  const m = {};
  arr.forEach((x) => { const k = fn(x); if (k == null || k === '') return; m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export function pivot(arr, rowFn, colFn) {
  const rows = {};
  arr.forEach((x) => { const rk = rowFn(x), ck = colFn(x); rows[rk] ||= {}; rows[rk][ck] = (rows[rk][ck] || 0) + 1; });
  return Object.entries(rows).map(([row, cols]) => ({ row, cols })).sort((a, b) => sum(b.cols) - sum(a.cols));
}

export function kpis(ss) {
  const dur = ss.filter((s) => s.duration_ms > 0);
  const scrolls = ss.filter((s) => s.max_scroll_pct != null);
  const conv = ss.filter(converted).length;
  const wa = ss.reduce((a, s) => a + (s.wa_clicks || 0), 0);
  const phone = ss.reduce((a, s) => a + (s.phone_clicks || 0), 0);
  return {
    sessions: ss.length,
    visitors: new Set(ss.map((s) => s.visitor_id || `anon-${s.id}`)).size,
    wa_clicks: wa, phone_clicks: phone, contacts: wa + phone,
    converting_sessions: conv,
    conversion_rate: pct1(conv, ss.length),
    avg_duration_s: dur.length ? Math.round(dur.reduce((a, s) => a + s.duration_ms, 0) / dur.length / 1000) : 0,
    avg_scroll_pct: scrolls.length ? Math.round(scrolls.reduce((a, s) => a + s.max_scroll_pct, 0) / scrolls.length) : 0,
    google_ads_share: pct1(ss.filter((s) => s.channel === 'google_ads').length, ss.length),
  };
}

export function daily(sessions, from, to) {
  const out = {};
  for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86400000)) out[localDate(d)] = { date: localDate(d), sessions: 0, wa_clicks: 0, phone_clicks: 0 };
  sessions.forEach((s) => {
    const row = out[localDate(new Date(s.started_at))];
    if (!row) return;
    row.sessions++; row.wa_clicks += s.wa_clicks || 0; row.phone_clicks += s.phone_clicks || 0;
  });
  return Object.values(out);
}

/** Contatos (WhatsApp + ligação) por cta_location, com pivô por canal do visitante. */
export function contactReport(events, channelOf) {
  const wa = events.filter((e) => e.name === 'whatsapp_click');
  const phone = events.filter((e) => e.name === 'phone_click');
  const loc = (e) => e.props.cta_location || '(sem cta_location)';
  const both = wa.concat(phone);
  return {
    wa_by_location: count(wa, loc),
    phone_by_location: count(phone, loc),
    contact_by_page: count(both, (e) => `${e.page_type || '?'}|${e.name === 'phone_click' ? 'phone' : 'wa'}`),
    contact_location_x_channel: pivot(both, (e) => `${e.name === 'phone_click' ? 'phone' : 'wa'}|${loc(e)}`, (e) => channelOf(e.session_id)),
    cta_by_location: count(events.filter((e) => e.name === 'cta_click'), loc),
  };
}

/** Funil de leitura por página: % das sessões que abriram a página e viram cada seção. */
export function funnels(events) {
  const viewers = {}, seen = {};
  events.forEach((e) => {
    if (!e.page_type) return;
    if (e.name === 'page_view') (viewers[e.page_type] ||= new Set()).add(e.session_id);
    if (e.name === 'section_view' && e.props.section) (seen[`${e.page_type}|${e.props.section}`] ||= new Set()).add(e.session_id);
  });
  const out = {};
  Object.entries(SECTIONS).forEach(([page, keys]) => {
    const base = viewers[page]?.size || 0;
    out[page] = {
      sessions: base,
      steps: keys.map((k) => {
        const value = seen[`${page}|${k}`]?.size || 0;
        return { key: k, label: SECTION_LABEL[k] || k, value, pct: base ? Math.round(value / base * 100) : 0 };
      }),
    };
  });
  return out;
}

export function campaigns(sessions) {
  const map = {};
  sessions.filter((s) => s.channel === 'google_ads' || s.utm_campaign).forEach((s) => {
    const k = [s.utm_campaign || '(sem utm_campaign)', s.utm_content || '', s.utm_term || ''].join('|');
    map[k] ||= { campaign: s.utm_campaign || '(sem utm_campaign)', content: s.utm_content || '', term: s.utm_term || '', channel: s.channel, page: s.landing_page_type, sessions: 0, wa_clicks: 0, phone_clicks: 0, converting: 0 };
    const c = map[k];
    c.sessions++; c.wa_clicks += s.wa_clicks || 0; c.phone_clicks += s.phone_clicks || 0; if (converted(s)) c.converting++;
  });
  return Object.values(map).sort((a, b) => b.sessions - a.sessions);
}

export function heatmap(sessions) {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0));
  sessions.forEach((s) => { const d = new Date(new Date(s.started_at).getTime() + TZ_OFFSET_MS); m[d.getUTCDay()][d.getUTCHours()]++; });
  return m;
}

export function clicks(events) {
  return count(events.filter((e) => e.name === 'click'), (e) => JSON.stringify([e.props.text || '(sem texto)', e.props.section || '', e.page_type || '']))
    .slice(0, MAX_CLICKS)
    .map((c) => { const [text, section, page] = JSON.parse(c.key); return { text, section, page, value: c.value }; });
}

const PAGE_NAME = { home: 'a página' };
export function trail(evs) {
  const steps = [];
  evs.forEach((e) => {
    const p = e.props;
    if (e.name === 'page_view') steps.push({ t: e.ts, kind: 'page', text: `Abriu ${PAGE_NAME[e.page_type] || 'a página'}` });
    else if (e.name === 'section_view') steps.push({ t: e.ts, kind: 'section', text: SECTION_LABEL[p.section] || p.section });
    else if (e.name === 'whatsapp_click') steps.push({ t: e.ts, kind: 'wa', text: `WhatsApp (${p.cta_location || ''})` });
    else if (e.name === 'phone_click') steps.push({ t: e.ts, kind: 'wa', text: `Ligação (${p.cta_location || ''})` });
    else if (e.name === 'cta_click') steps.push({ t: e.ts, kind: 'action', text: `Link: ${p.cta_location || ''}` });
    else if (e.name === 'faq_open') steps.push({ t: e.ts, kind: 'action', text: `FAQ: ${p.faq_question}` });
    else if (e.name === 'click' && p.text && !/wa\.me|tel:/.test(p.href || '')) steps.push({ t: e.ts, kind: 'click', text: `${p.text}${p.section ? ' · ' + p.section : ''}` });
    else if (e.name === 'page_leave') steps.push({ t: e.ts, kind: 'leave', text: `Saiu (${Math.round((p.duration_ms || 0) / 1000)} s, ${p.max_scroll_pct || 0}% da página)` });
  });
  return steps.slice(0, MAX_TRAIL);
}

/** jornadas = conv (WhatsApp ou ligação) | todas */
export function journeys(sessions, evBySession, mode) {
  const keep = mode === 'todas' ? () => true : converted;
  return sessions.filter(keep).slice(0, MAX_JOURNEYS).map((s) => ({
    id: s.id, started_at: s.started_at, channel: s.channel, campaign: s.utm_campaign, content: s.utm_content, term: s.utm_term,
    page: s.landing_page_type, device: s.device, browser: s.browser, os: s.os, city: s.city, region: s.region, returning: s.is_returning,
    duration_s: Math.round((s.duration_ms || 0) / 1000), max_scroll_pct: s.max_scroll_pct,
    wa_clicks: s.wa_clicks, phone_clicks: s.phone_clicks,
    trail: trail(evBySession[s.id] || []),
  }));
}

/** Monta o relatório completo. sessionsAll/prevAll já vêm do período; filtros aplicados aqui. */
export function buildReport({ r, sessionsAll, prevAll, eventsAll, origem, pagina, jornadas }) {
  const pass = (s) => (!origem || s.channel === origem) && (!pagina || s.landing_page_type === pagina);
  const sessions = sessionsAll.filter(pass);
  const sid = new Set(sessions.map((s) => s.id));
  const events = eventsAll.filter((e) => sid.has(e.session_id));
  const byIdAll = Object.fromEntries(sessionsAll.map((s) => [s.id, s]));
  const channelOf = (id) => byIdAll[id]?.channel || 'other';
  const evBySession = {};
  events.forEach((e) => (evBySession[e.session_id] ||= []).push(e));

  return {
    kpis: { current: kpis(sessions), previous: kpis(prevAll.filter(pass)) },
    daily: daily(sessions, r.from, r.to),
    // Origem e página de entrada mostram o período inteiro de propósito (ignoram o próprio filtro)
    channels: count(sessionsAll.filter((s) => !pagina || s.landing_page_type === pagina), (s) => s.channel || 'other'),
    pages: count(sessionsAll.filter((s) => !origem || s.channel === origem), (s) => s.landing_page_type || '?'),
    devices: count(sessions, (s) => s.device),
    browsers: count(sessions, (s) => s.browser),
    os: count(sessions, (s) => s.os),
    cities: count(sessions, (s) => (s.city ? `${s.city}${s.region ? ' · ' + s.region : ''}` : null)).slice(0, MAX_CITIES),
    regions: count(sessions, (s) => s.region),
    consent: count(sessions, (s) => s.consent || 'nao_respondeu'),
    audience: count(sessions, (s) => (s.is_returning ? 'recorrente' : 'novo')),
    ...contactReport(events, channelOf),
    funnels: funnels(events),
    faq: count(events.filter((e) => e.name === 'faq_open'), (e) => `${e.page_type || '?'}|${e.props.faq_question || '?'}`),
    campaigns: campaigns(sessions),
    clicks: clicks(events),
    heatmap: heatmap(sessions),
    journeys: journeys(sessions, evBySession, jornadas),
  };
}
