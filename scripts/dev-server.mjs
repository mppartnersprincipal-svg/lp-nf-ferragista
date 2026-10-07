// Servidor local que imita a Vercel: estáticos de site/ + funções de api/ (para testar coletor e dashboard).
// Uso: node scripts/dev-server.mjs  (lê variáveis de .env.local)
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'site');
const PORT = Number(process.env.PORT) || 4173;

// .env.local → process.env
const envFile = path.join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function runFunction(req, res, url) {
  const file = path.join(ROOT, 'api', url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '') + '.js');
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  let raw = ''; for await (const c of req) raw += c;
  req.query = Object.fromEntries(url.searchParams);
  try { req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : raw; } catch { req.body = raw; }
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  res.send = (b) => { res.end(b); return res; };
  try { const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`); await mod.default(req, res); }
  catch (e) { console.error(e); res.statusCode = 500; res.end('erro'); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) return runFunction(req, res, url);
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p === '/dashboard' || p === '/dashboard/') p = '/dashboard/index.html';
  let file = path.join(SITE, decodeURIComponent(p));
  // espelha o cleanUrls:true da Vercel: /pagina serve pagina.html
  if (!path.extname(file) && existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(SITE) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`dev-server: http://localhost:${PORT}  (api: ${process.env.SUPABASE_URL ? 'Supabase ok' : 'SEM Supabase'}; login: ${process.env.DASHBOARD_PASSWORD ? 'ok' : 'SEM senha'}; Google Ads: ${process.env.GOOGLE_ADS_REFRESH_TOKEN ? 'ok' : 'pendente'}; GA4: ${(process.env.GA4_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) ? 'ok' : 'pendente'})`));
