// Acesso ao Supabase via REST (PostgREST) com fetch nativo: zero dependências.
// Só roda no servidor (Vercel Functions) com a SERVICE ROLE KEY.
const url = () => process.env.SUPABASE_URL;
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export const configured = () => Boolean(url() && key());

async function rest(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  // 201/204 com Prefer: return=minimal podem vir sem corpo (mesmo com content-type json)
  const text = await res.text();
  if (!text) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? JSON.parse(text) : text;
}

export const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: args });
export const insert = (table, rows) => rest(table, { method: 'POST', body: rows, headers: { Prefer: 'return=minimal' } });

/** SELECT paginado (o PostgREST do Supabase limita a 1000 linhas por requisição). */
export async function selectAll(table, query, pageSize = 1000, max = 50000) {
  const out = [];
  for (let from = 0; from < max; from += pageSize) {
    const rows = await rest(`${table}?${query}`, { headers: { Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' } });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
