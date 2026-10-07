// Classificação de canal e de dispositivo/navegador (sem bibliotecas, sem IP).
// Mesmas regras da LP Gaspar Lopes (herdadas da Sólida).

export function classifyChannel({ gclid, utm_source, utm_medium, utm_term, referrer_host }) {
  const src = (utm_source || '').toLowerCase();
  const med = (utm_medium || '').toLowerCase();
  const ref = (referrer_host || '').toLowerCase();
  const paid = /cpc|ppc|paid|ads|display/.test(med);
  // Link aberto de dentro do painel do Ads ou UTM de teste com ValueTrack cru ({keyword}) → direto
  if (/ads\.google\.com/.test(ref) || /\{keyword\}|\{[a-z_]+\}/i.test(utm_term || '')) return 'direct';
  if (gclid) return 'google_ads';
  if (src === 'google' && paid) return 'google_ads';
  if (/instagram|^ig$/.test(src)) return paid ? 'meta_ads' : 'instagram';
  if (/facebook|^fb$|meta/.test(src)) return paid ? 'meta_ads' : 'facebook';
  if (src) return 'other';
  if (!ref) return 'direct';
  if (/google\./.test(ref)) return 'google_organic';
  if (/instagram\.com/.test(ref)) return 'instagram';
  if (/facebook\.com|fb\.com|messenger/.test(ref)) return 'facebook';
  if (/bing\.com|yahoo\.|duckduckgo/.test(ref)) return 'search_other';
  return 'referral';
}

export function parseUA(ua = '') {
  const u = ua.toLowerCase();
  const device = /ipad|tablet|(android(?!.*mobile))/.test(u) ? 'tablet' : /mobi|iphone|android/.test(u) ? 'mobile' : 'desktop';
  let browser = 'Outro';
  if (/edg\//.test(u)) browser = 'Edge';
  else if (/opr\/|opera/.test(u)) browser = 'Opera';
  else if (/samsungbrowser/.test(u)) browser = 'Samsung Internet';
  else if (/chrome|crios/.test(u)) browser = 'Chrome';
  else if (/firefox|fxios/.test(u)) browser = 'Firefox';
  else if (/safari/.test(u)) browser = 'Safari';
  let os = 'Outro';
  if (/iphone|ipad|ipod/.test(u)) os = 'iOS';
  else if (/android/.test(u)) os = 'Android';
  else if (/windows/.test(u)) os = 'Windows';
  else if (/mac os/.test(u)) os = 'macOS';
  else if (/linux/.test(u)) os = 'Linux';
  return { device, browser, os };
}

export const isBotUA = (ua = '') =>
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|vercel-screenshot|python|curl|wget/i.test(ua);
