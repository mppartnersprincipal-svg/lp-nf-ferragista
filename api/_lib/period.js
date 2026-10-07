// Período do dashboard (?de=YYYY-MM-DD&ate=YYYY-MM-DD) no fuso de Goiânia.
// Usado por api/dashboard.js e api/google-ads.js.
export const TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // America/Sao_Paulo (sem horário de verão)
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;
const validYmd = (v) => YMD.test(v || '') && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export function localDate(d) { return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10); }
export function localStart(ymd) { return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - TZ_OFFSET_MS); }
export function addDays(ymd, n) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** Início inclusivo e término exclusivo (meia-noite local), mais o período anterior de mesmo tamanho. */
export function range(q = {}) {
  const today = localDate(new Date());
  const ate = validYmd(q.ate) ? q.ate : today;
  let de = validYmd(q.de) && q.de <= ate ? q.de : addDays(ate, -(DEFAULT_DAYS - 1));
  if (de < addDays(ate, -(MAX_DAYS - 1))) de = addDays(ate, -(MAX_DAYS - 1));
  const from = localStart(de), to = localStart(addDays(ate, 1));
  const days = Math.max(1, Math.round((to - from) / 86400000));
  return { de, ate, from, to, prevFrom: new Date(from.getTime() - days * 86400000), prevTo: from, days };
}
