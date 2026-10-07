// Leitura de relatórios do GA4 (Data API v1beta / batchRunReports), mesmo formato da seção Google Ads.
// Só consulta: usa uma conta de serviço com papel de Leitor na propriedade. Credenciais só no servidor.
// Regras de cálculo e interpretação: DASHBOARD.md → "GA4".
import { sign } from 'node:crypto';

class Ga4Error extends Error {}

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 20_000;
const TOP_ROWS = 10;
// Eventos que o GTM envia ao GA4 (mesmos nomes do dataLayer das páginas).
export const GA4_EVENTS = ['click_whatsapp', 'click_phone', 'click_cta', 'click_maps', 'click_instagram', 'click_reviews'];

function numeric(value) {
  if (value === undefined) return 0;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Ga4Error('O GA4 retornou dados inválidos. Tente atualizar o painel.');
  return result;
}

function dateInDashboard(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

const validRange = (from, to) => from instanceof Date && to instanceof Date
  && Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to;

// O dashboard usa término exclusivo; o GA4 inclui ambos os dias.
const dateRange = (from, to, name) => ({
  startDate: dateInDashboard(from), endDate: dateInDashboard(new Date(to.getTime() - 1)), name,
});

function readServiceAccount(raw) {
  try {
    const account = JSON.parse(raw);
    if (typeof account?.client_email === 'string' && typeof account?.private_key === 'string'
      && account.private_key.includes('PRIVATE KEY')) {
      return { email: account.client_email, key: account.private_key };
    }
  } catch { /* cai na mensagem de configuração abaixo */ }
  return null;
}

function signedAssertion({ email, key }, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  try {
    return `${unsigned}.${sign('sha256', Buffer.from(unsigned), key).toString('base64url')}`;
  } catch {
    throw new Ga4Error('A chave da conta de serviço do GA4 é inválida. Gere uma nova chave JSON e atualize a variável.');
  }
}

function rowsOf(report) {
  if (!report || typeof report !== 'object' || (report.rows !== undefined && !Array.isArray(report.rows))) {
    throw new Ga4Error('O GA4 retornou uma resposta inesperada. Tente atualizar o painel.');
  }
  return (report.rows ?? []).map((row) => ({
    dims: (row.dimensionValues ?? []).map((d) => d?.value ?? ''),
    values: (row.metricValues ?? []).map((m) => numeric(m?.value)),
  }));
}

function totalsOf(rows, name) {
  // Com dois períodos o GA4 acrescenta a dimensão dateRange (o "name" de cada período).
  const row = rows.find((r) => r.dims[0] === name);
  const [sessions = 0, users = 0, newUsers = 0, engagementRate = 0, avgDuration = 0, keyEvents = 0] = row?.values ?? [];
  return {
    sessions, users, newUsers, engagementRate, averageSessionDuration: avgDuration, keyEvents,
    keyEventRate: sessions > 0 ? keyEvents / sessions : null,
  };
}

function buildRequests(current, previous) {
  const top = (dimension) => ({
    dateRanges: [current], dimensions: [{ name: dimension }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: TOP_ROWS,
  });
  return [
    {
      dateRanges: [current, previous],
      metrics: ['sessions', 'totalUsers', 'newUsers', 'engagementRate', 'averageSessionDuration', 'keyEvents'].map((name) => ({ name })),
    },
    {
      dateRanges: [current], dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    },
    top('sessionDefaultChannelGroup'),
    top('landingPage'),
    {
      dateRanges: [current, previous], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: GA4_EVENTS } } },
    },
  ];
}

/**
 * @param {{ from: Date, to: Date, prevFrom: Date, prevTo: Date }} range  término exclusivo (meia-noite de São Paulo)
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<{ status: 'ready', propertyId: string, from: string, to: string, timeZone: string|null, thresholded: boolean,
 *   totals: object, previous: object, daily: object[], channels: object[], landingPages: object[], events: object[], fetchedAt: string }
 *   | { status: 'not_configured' | 'error', message: string }>}
 */
export async function fetchGa4Report(range, env = process.env) {
  const propertyId = env.GA4_PROPERTY_ID?.trim().replace(/^properties\//, '');
  // Aceita o mesmo nome do dashboard da LP Construção (mesma conta de serviço dashboard-ga4@).
  const rawAccount = (env.GA4_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON)?.trim();

  if (!propertyId || !rawAccount) {
    return {
      status: 'not_configured',
      message: 'Conecte a propriedade do GA4 para ver sessões, eventos-chave e origens medidos pelo Google Analytics neste painel.',
    };
  }
  if (!/^\d{6,12}$/.test(propertyId)) {
    return { status: 'error', message: 'Use o ID numérico da propriedade do GA4 (Administrador → Detalhes da propriedade), não o ID de medição G-.' };
  }
  const account = readServiceAccount(rawAccount);
  if (!account) {
    return { status: 'error', message: 'A conta de serviço do GA4 precisa ser revisada: cole o arquivo JSON completo da chave na variável.' };
  }

  try {
    if (!validRange(range?.from, range?.to) || !validRange(range?.prevFrom, range?.prevTo)) {
      throw new Ga4Error('Selecione um período válido para consultar o GA4.');
    }
    const current = dateRange(range.from, range.to, 'atual');
    const previous = dateRange(range.prevFrom, range.prevTo, 'anterior');
    const signal = AbortSignal.timeout(TIMEOUT_MS);

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(account),
      }),
      cache: 'no-store',
      signal,
    });
    if (!tokenResponse.ok) {
      throw new Ga4Error(tokenResponse.status >= 500 || tokenResponse.status === 429
        ? 'O GA4 está temporariamente indisponível. Tente atualizar o painel em alguns minutos.'
        : 'Não foi possível autorizar a conta de serviço. Revise a chave JSON do GA4.');
    }
    const token = await tokenResponse.json();
    if (!token?.access_token) throw new Ga4Error('Não foi possível autorizar a conexão com o GA4.');

    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` },
      body: JSON.stringify({ requests: buildRequests(current, previous) }),
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      // Não propagar payloads de erro do provedor: podem conter informações da propriedade.
      if (response.status === 401 || response.status === 403) {
        throw new Ga4Error('A conta de serviço não tem acesso a esta propriedade. Adicione o e-mail dela como Leitor no GA4.');
      }
      if (response.status === 404) throw new Ga4Error('Propriedade do GA4 não encontrada. Confira o ID numérico da propriedade.');
      if (response.status === 429) throw new Ga4Error('O limite de consultas do GA4 foi atingido. Tente novamente em alguns minutos.');
      throw new Ga4Error('Não foi possível consultar o GA4. Tente atualizar o painel; se persistir, revise a conexão.');
    }
    const body = await response.json();
    if (!Array.isArray(body?.reports) || body.reports.length !== 5) {
      throw new Ga4Error('O GA4 retornou uma resposta inesperada. Tente atualizar o painel.');
    }
    const [totalsRows, dailyRows, channelRows, landingRows, eventRows] = body.reports.map(rowsOf);
    const metadata = body.reports[0].metadata ?? {};
    const breakdown = (rows) => rows.map((r) => ({
      key: r.dims[0] || '(não definido)', sessions: r.values[0], users: r.values[1], keyEvents: r.values[2],
    }));
    const eventCount = (name, period) => eventRows.find((r) => r.dims[0] === name && r.dims[1] === period)?.values[0] ?? 0;

    return {
      status: 'ready',
      propertyId,
      from: current.startDate,
      to: current.endDate,
      timeZone: typeof metadata.timeZone === 'string' ? metadata.timeZone : null,
      thresholded: body.reports.some((r) => r.metadata?.subjectToThresholding === true),
      totals: totalsOf(totalsRows, 'atual'),
      previous: totalsOf(totalsRows, 'anterior'),
      daily: dailyRows.map((r) => ({
        date: `${r.dims[0].slice(0, 4)}-${r.dims[0].slice(4, 6)}-${r.dims[0].slice(6, 8)}`,
        sessions: r.values[0], keyEvents: r.values[1],
      })),
      channels: breakdown(channelRows),
      landingPages: breakdown(landingRows),
      events: GA4_EVENTS.map((name) => ({ name, count: eventCount(name, 'atual'), previous: eventCount(name, 'anterior') })),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Ga4Error ? error.message
        : 'A consulta ao GA4 não foi concluída. Tente atualizar o painel em alguns minutos.',
    };
  }
}
