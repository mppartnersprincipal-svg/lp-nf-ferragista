// GET /api/dashboard?de=YYYY-MM-DD&ate=YYYY-MM-DD&origem=<canal>&jornadas=conv|todas
// GET /api/dashboard?live=1  → últimos eventos (feed ao vivo)
// Autenticação: Authorization: Bearer <token de /api/login>
// O Google Ads fica em /api/google-ads (consulta separada, não segura o painel).
import { configured, selectAll } from './_lib/db.js';
import { verifyToken, bearer } from './_lib/auth.js';
import { range } from './_lib/period.js';
import { buildReport } from './_lib/report.js';
import { PAGE_TYPES } from './_lib/payload.js';

const CHANNELS = new Set(['google_ads', 'google_organic', 'instagram', 'meta_ads', 'facebook', 'search_other', 'direct', 'referral', 'other']);
const LIVE_EVENTS = 40;
const MAX_ROWS = 50000; // teto padrão do selectAll

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyToken(bearer(req))) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  if (!configured()) return res.status(503).json({ error: 'Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' });
  res.setHeader('Cache-Control', 'no-store');

  const q = req.query || {};
  try {
    if (q.live) return res.status(200).json(await live());
    return res.status(200).json(await report(q));
  } catch (err) {
    console.error('[dashboard]', err.message);
    return res.status(500).json({ error: 'Falha ao consultar o banco.' });
  }
}

async function live() {
  const events = await selectAll('novaferragista_events', 'select=ts,name,page_type,props,session_id&order=ts.desc&name=not.in.(page_leave,section_view)', LIVE_EVENTS, LIVE_EVENTS);
  const ids = [...new Set(events.map((e) => e.session_id))];
  const sessions = ids.length ? await selectAll('novaferragista_sessions', `select=id,channel,device,city,utm_campaign&id=in.(${ids.join(',')})`) : [];
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  return { events: events.map((e) => ({ ...e, session: byId[e.session_id] || null })) };
}

async function report(q) {
  const r = range(q);
  // Filtros só aceitam valores conhecidos (entram na comparação, nunca na URL do PostgREST)
  const origem = CHANNELS.has(q.origem) ? q.origem : null;
  const pagina = PAGE_TYPES.has(q.pagina) ? q.pagina : null;
  const jornadas = q.jornadas === 'todas' ? 'todas' : 'conv';
  const [sessionsAll, prevAll, eventsAll] = await Promise.all([
    selectAll('novaferragista_sessions', `select=*&started_at=gte.${r.from.toISOString()}&started_at=lt.${r.to.toISOString()}&order=started_at.desc,id.asc`),
    selectAll('novaferragista_sessions', `select=id,visitor_id,wa_clicks,phone_clicks,duration_ms,max_scroll_pct,channel,landing_page_type&started_at=gte.${r.prevFrom.toISOString()}&started_at=lt.${r.prevTo.toISOString()}&order=id.asc`),
    selectAll('novaferragista_events', `select=session_id,ts,name,page_type,props&ts=gte.${r.from.toISOString()}&ts=lt.${r.to.toISOString()}&order=ts.asc,id.asc`),
  ]);

  return {
    range: { de: r.de, ate: r.ate, days: r.days },
    origem: origem || 'todas', pagina: pagina || 'todas', jornadas,
    ...buildReport({ r, sessionsAll, prevAll, eventsAll, origem, pagina, jornadas }),
    // selectAll para em MAX_ROWS: avisa o painel em vez de cortar em silêncio
    truncated: [sessionsAll, prevAll, eventsAll].some((rows) => rows.length >= MAX_ROWS),
    generated_at: new Date().toISOString(),
  };
}
