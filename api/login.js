// POST /api/login { password } → { token } (30 dias). Senha única em DASHBOARD_PASSWORD.
import { authConfigured, checkPassword, issueToken } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!authConfigured()) return res.status(503).json({ error: 'Dashboard não configurado: defina DASHBOARD_PASSWORD (≥ 8) e DASHBOARD_SECRET (≥ 16) na Vercel.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  // Atraso fixo contra força bruta trivial
  await new Promise((r) => setTimeout(r, 400));
  if (!body || !checkPassword(body.password)) return res.status(401).json({ error: 'Senha incorreta.' });
  return res.status(200).json({ token: issueToken() });
}
