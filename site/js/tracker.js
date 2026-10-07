/* ============================================================================
 * Coletor first-party da LP Nova Ferragista (dashboard /dashboard)
 * Mesmo modelo das LPs Gaspar Lopes e Construbloc:
 * - Anônimo: sem IP, sem cookies; sessão em sessionStorage (renova após 30 min parado);
 *   id de visitante persistente (localStorage, 13 meses) SÓ se o visitante não
 *   escolheu "Só o essencial" (chave nf-consent; a LP ainda não tem banner).
 * - Independente do GTM/GA4/Ads: não altera o contêiner nem o dataLayer.
 * - Não roda para bots (navigator.webdriver / UA) nem na página /dashboard.
 * - Fila com flush a cada 10 eventos / 5 s / aba oculta / pagehide (sendBeacon).
 *
 * Eventos próprios: page_view {sw, sh, ref_host}, page_leave {duration_ms (tempo
 * VISÍVEL), max_scroll_pct}, click {tag, text, href, section, x_pct, y_pct},
 * section_view {section} (1x por seção por página, só para o coletor).
 * Os eventos do dataLayer chegam por window.nfCollect(name, props), chamado pelo track()
 * da página já traduzidos: click_whatsapp → whatsapp_click, click_phone → phone_click,
 * click_cta/maps/instagram/reviews → cta_click (todos com cta_location), faq_open.
 * ========================================================================== */
(function () {
  'use strict';
  if (/\/dashboard/.test(location.pathname)) return;
  if (navigator.webdriver) return;
  if (/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp/i.test(navigator.userAgent)) return;

  var ENDPOINT = '/api/collect';
  var SESSION_KEY = 'nf-s';
  var VISITOR_KEY = 'nf-v';
  var CONSENT_KEY = 'nf-consent';
  var IDLE_MS = 30 * 60 * 1000;
  var VISITOR_TTL = 13 * 30 * 24 * 60 * 60 * 1000;
  var FLUSH_MS = 5000;
  var FLUSH_AT = 10;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function store(kind) { try { return kind === 'local' ? localStorage : sessionStorage; } catch (e) { return null; } }
  function get(kind, k) { var s = store(kind); try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function set(kind, k, v) { var s = store(kind); try { if (s) s.setItem(k, v); } catch (e) {} }
  function del(kind, k) { var s = store(kind); try { if (s) s.removeItem(k); } catch (e) {} }

  // ---- consentimento (decisão do banner, quando existir) ----
  function consent() { return get('local', CONSENT_KEY); }

  // ---- tipo de página (dataLayer.push({ page_type }) antes do GTM; LP de página única = home) ----
  function pageType() {
    var dl = window.dataLayer || [];
    for (var i = 0; i < dl.length; i++) if (dl[i] && dl[i].page_type) return dl[i].page_type;
    return null;
  }
  var PT = pageType() || 'home';

  // ---- visitante persistente (novo × recorrente) ----
  var isReturning = false;
  function visitorId() {
    if (consent() === 'essential') { del('local', VISITOR_KEY); return null; }
    var raw = get('local', VISITOR_KEY);
    if (raw) {
      try {
        var v = JSON.parse(raw);
        if (v && v.id && (Date.now() - v.at) < VISITOR_TTL) { isReturning = true; set('local', VISITOR_KEY, JSON.stringify({ id: v.id, at: Date.now() })); return v.id; }
      } catch (e) {}
    }
    var id = uuid();
    set('local', VISITOR_KEY, JSON.stringify({ id: id, at: Date.now() }));
    return id;
  }

  // ---- sessão ----
  var isNewSession = false;
  function sessionId() {
    var raw = get('session', SESSION_KEY);
    if (raw) {
      try { var s = JSON.parse(raw); if (s && s.id && (Date.now() - s.at) < IDLE_MS) { set('session', SESSION_KEY, JSON.stringify({ id: s.id, at: Date.now() })); return s.id; } } catch (e) {}
    }
    isNewSession = true;
    var id = uuid();
    set('session', SESSION_KEY, JSON.stringify({ id: id, at: Date.now() }));
    return id;
  }
  var SID = sessionId();
  var VID = visitorId();

  // ---- atribuição ----
  var q = new URLSearchParams(location.search);
  var refHost = '';
  try { refHost = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  function utm(k) { var v = q.get(k); return v ? v.slice(0, 120) : null; }
  var session = {
    id: SID,
    visitor_id: VID,
    landing_path: location.pathname + (location.search ? location.search : ''),
    referrer_host: refHost || null,
    utm_source: utm('utm_source'), utm_medium: utm('utm_medium'), utm_campaign: utm('utm_campaign'),
    utm_content: utm('utm_content'), utm_term: utm('utm_term'),
    gclid: q.has('gclid') || q.has('gbraid') || q.has('wbraid'),
    screen_w: screen.width, screen_h: screen.height,
    consent: consent(),
    returning: isReturning
  };
  // Só a primeira página da sessão carrega atribuição (evita sobrescrever com refresh ou navegação interna)
  if (!isNewSession) { ['landing_path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { delete session[k]; }); session.gclid = false; }

  // ---- fila ----
  var queue = [];
  var timer = null;
  var t0 = performance.now();
  function send(useBeacon) {
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);
    var body = JSON.stringify({ s: session, e: batch, pt: PT });
    session = { id: SID, visitor_id: VID, consent: consent() }; // lotes seguintes só atualizam
    if (useBeacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return; } catch (e) {}
    }
    try { fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }
  function schedule() { if (!timer) timer = setTimeout(function () { timer = null; send(false); }, FLUSH_MS); }
  function track(name, props) {
    queue.push({ n: name, t: Math.round(performance.now() - t0), p: props || {} });
    if (name === 'whatsapp_click') session.wa_clicks = (session.wa_clicks || 0) + 1;
    if (name === 'phone_click') session.phone_clicks = (session.phone_clicks || 0) + 1;
    if (queue.length >= FLUSH_AT) send(false); else schedule();
  }
  // Espelho dos eventos do dataLayer (chamado pelo track() de cada página)
  window.nfCollect = function (name, props) { if (name && name !== 'page_view') track(name, props); };

  // ---- page_view ----
  track('page_view', { sw: innerWidth, sh: innerHeight, ref_host: refHost || null });

  // ---- tempo visível + scroll ----
  var visibleMs = 0, lastVisible = document.visibilityState === 'visible' ? Date.now() : null;
  var maxScroll = 0;
  function scrollPct() {
    var h = document.documentElement.scrollHeight - innerHeight;
    return h > 0 ? Math.min(100, Math.round((scrollY / h) * 100)) : 100;
  }
  addEventListener('scroll', function () { var p = scrollPct(); if (p > maxScroll) maxScroll = p; }, { passive: true });
  function accumulate() { if (lastVisible !== null) { visibleMs += Date.now() - lastVisible; lastVisible = null; } }
  var leaveSent = false;
  function leave(final) {
    accumulate();
    if (maxScroll === 0) maxScroll = scrollPct();
    if (!leaveSent || final) {
      queue.push({ n: 'page_leave', t: Math.round(performance.now() - t0), p: { duration_ms: visibleMs, max_scroll_pct: maxScroll } });
      leaveSent = true;
      session.duration_ms = visibleMs; session.max_scroll_pct = maxScroll;
    }
    send(true);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { leave(false); }
    else { lastVisible = Date.now(); leaveSent = false; }
  });
  addEventListener('pagehide', function () { leave(true); });

  // ---- seções vistas (funil de leitura) ----
  // Chave = id da <section>, aria-labelledby sem "-t" ou id do bloco pai (hero). Conta quando 40% da seção
  // aparece OU ela ocupa metade da tela (seções altas no celular nunca chegam a 40%).
  function sectionKey(sec) {
    return sec.id || (sec.getAttribute('aria-labelledby') || '').replace(/-t(itle)?$/, '') || (sec.parentElement && sec.parentElement.id) || '';
  }
  function watchSections() {
    if (!('IntersectionObserver' in window)) return;
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        if (en.intersectionRatio < 0.4 && en.intersectionRect.height < innerHeight * 0.5) return;
        var k = sectionKey(en.target);
        io.unobserve(en.target);
        if (!k || seen[k]) return;
        seen[k] = true;
        track('section_view', { section: k });
      });
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    document.querySelectorAll('section').forEach(function (s) { io.observe(s); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchSections); else watchSections();

  // ---- cliques genéricos (com nome do botão e de onde veio) ----
  function hrefKind(a) {
    var href = a.getAttribute('href') || '';
    if (/wa\.me|api\.whatsapp\.com/.test(href)) return 'wa.me';
    if (/^tel:/.test(href)) return 'tel:';
    if (/^mailto:/.test(href)) return 'mailto:';
    if (/^#/.test(href)) return href;
    try { var u = new URL(href, location.href); return u.host === location.host ? (u.pathname + u.hash) : u.hostname; } catch (e) { return href.slice(0, 80); }
  }
  function sectionOf(el) {
    if (el.closest('.fab')) return 'flutuante';
    if (el.closest('.header')) return 'header';
    if (el.closest('.footer')) return 'footer';
    var sec = el.closest('section');
    return sec ? sectionKey(sec) : '';
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a,button,[role=button],input[type=submit],summary,select');
    if (!el) return;
    var text = (el.getAttribute('data-cta') || el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var p = { tag: el.tagName.toLowerCase(), text: text, section: sectionOf(el), x_pct: Math.round(e.clientX / innerWidth * 100), y_pct: Math.round(e.clientY / innerHeight * 100) };
    if (el.tagName === 'A') p.href = hrefKind(el);
    track('click', p);
  }, true);

  // Link para outra página do mesmo site: envia a fila antes do unload, porque alguns
  // navegadores (in-app, headless) descartam requisições disparadas no pagehide. Fica no bubble de
  // window para rodar DEPOIS do track() da página (cta_click entra no mesmo lote).
  addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (a.host === location.host && a.pathname !== location.pathname) send(true);
  });
})();
