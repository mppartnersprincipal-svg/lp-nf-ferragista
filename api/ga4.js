// GET /api/ga4?de=YYYY-MM-DD&ate=YYYY-MM-DD → relatório da propriedade GA4 (só leitura).
// Separado de /api/dashboard: se o GA4 demorar ou falhar, o resto do painel não espera nem zera.
// Autenticação: Authorization: Bearer <token de /api/login>
import { verifyToken, bearer } from './_lib/auth.js';
import { range } from './_lib/period.js';
import { fetchGa4Report } from './_lib/ga4.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyToken(bearer(req))) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  res.setHeader('Cache-Control', 'no-store');
  const r = range(req.query || {});
  // Sempre 200: o estado (ready | not_configured | error) vai no corpo, com mensagem segura.
  return res.status(200).json(await fetchGa4Report({ from: r.from, to: r.to, prevFrom: r.prevFrom, prevTo: r.prevTo }));
}
