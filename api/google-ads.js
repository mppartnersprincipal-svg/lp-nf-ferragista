// GET /api/google-ads?de=YYYY-MM-DD&ate=YYYY-MM-DD → relatório da conta (só leitura).
// Separado de /api/dashboard: se o Google Ads demorar ou falhar, o resto do painel não espera nem zera.
// Autenticação: Authorization: Bearer <token de /api/login>
import { verifyToken, bearer } from './_lib/auth.js';
import { range } from './_lib/period.js';
import { fetchGoogleAdsReport } from './_lib/google-ads.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyToken(bearer(req))) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  res.setHeader('Cache-Control', 'no-store');
  const r = range(req.query || {});
  // Sempre 200: o estado (ready | not_configured | error) vai no corpo, com mensagem segura.
  return res.status(200).json(await fetchGoogleAdsReport({ from: r.from, to: r.to }));
}
