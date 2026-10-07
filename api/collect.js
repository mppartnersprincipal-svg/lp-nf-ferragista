// POST /api/collect — recebe lotes anônimos do coletor (site/js/tracker.js) e grava no Supabase.
// Sem IP, sem cookies. Cidade/região vêm dos cabeçalhos de geolocalização da Vercel.
import { configured, rpc, insert } from './_lib/db.js';
import { isBotUA } from './_lib/classify.js';
import { buildBatch } from './_lib/payload.js';

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return null; } }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured()) return res.status(204).end(); // sem banco configurado: descarta em silêncio
  if (isBotUA(req.headers['user-agent'] || '')) return res.status(204).end();

  const batch = buildBatch(parseBody(req), { headers: req.headers });
  if (!batch.ok) return res.status(400).end();

  try {
    await rpc('novaferragista_upsert_session', { p: batch.session });
    if (batch.rows.length) await insert('novaferragista_events', batch.rows);
  } catch (err) {
    console.error('[collect]', err.message);
    return res.status(204).end(); // nunca quebra a página por causa de analytics
  }
  return res.status(204).end();
}
