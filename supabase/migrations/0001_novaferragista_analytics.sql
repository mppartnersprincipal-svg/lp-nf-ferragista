-- Dashboard first-party da LP Nova Ferragista
-- Coleta anônima: sem IP, sem cookie, sem dados pessoais.
-- Acesso só pela service role (API na Vercel). RLS ligado sem policies = bloqueado para anon.
-- Projeto compartilhado com Sólida, Gaspar e Construbloc: tudo daqui começa com novaferragista_.
-- Idempotente: pode rodar de novo sem perder dados.

create table if not exists public.novaferragista_sessions (
  id                uuid primary key,               -- gerado no navegador (sessionStorage, renova após 30 min parado)
  visitor_id        text,                           -- id aleatório persistente (localStorage, 13 meses); null se "Só o essencial"
  started_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  landing_path      text,
  landing_page_type text,                           -- home
  referrer_host     text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  gclid             boolean not null default false,
  channel           text,                           -- google_ads | google_organic | instagram | meta_ads | facebook | search_other | direct | referral | other
  device            text,                           -- mobile | tablet | desktop
  browser           text,
  os                text,
  screen_w          int,
  screen_h          int,
  city              text,                           -- cabeçalhos de geolocalização da Vercel (sem IP)
  region            text,
  country           text,
  consent           text,                           -- accepted | essential | null (não respondeu; a LP ainda não tem banner)
  is_returning      boolean not null default false,
  duration_ms       int,
  max_scroll_pct    int,
  wa_clicks         int not null default 0,
  phone_clicks      int not null default 0
);

create table if not exists public.novaferragista_events (
  id          bigserial primary key,
  session_id  uuid not null references public.novaferragista_sessions(id) on delete cascade,
  ts          timestamptz not null default now(),
  name        text not null,                        -- page_view | page_leave | click | section_view | whatsapp_click | phone_click | cta_click | faq_open
  page_type   text,                                 -- home
  props       jsonb not null default '{}'::jsonb
);

create index if not exists novaferragista_sessions_started_at_idx on public.novaferragista_sessions (started_at desc);
create index if not exists novaferragista_sessions_channel_idx    on public.novaferragista_sessions (channel);
create index if not exists novaferragista_events_session_idx      on public.novaferragista_events (session_id);
create index if not exists novaferragista_events_ts_idx           on public.novaferragista_events (ts desc);
create index if not exists novaferragista_events_name_idx         on public.novaferragista_events (name);

alter table public.novaferragista_sessions enable row level security;
alter table public.novaferragista_events   enable row level security;
-- Sem policies: anon/authenticated não leem nem escrevem. A API usa a service role.

-- Upsert de sessão chamado pela API (/api/collect)
create or replace function public.novaferragista_upsert_session(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.novaferragista_sessions as s (
    id, visitor_id, landing_path, landing_page_type, referrer_host,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, channel,
    device, browser, os, screen_w, screen_h, city, region, country, consent, is_returning,
    duration_ms, max_scroll_pct, wa_clicks, phone_clicks
  ) values (
    (p->>'id')::uuid, p->>'visitor_id', p->>'landing_path', p->>'landing_page_type', p->>'referrer_host',
    p->>'utm_source', p->>'utm_medium', p->>'utm_campaign', p->>'utm_content', p->>'utm_term',
    coalesce((p->>'gclid')::boolean, false), p->>'channel',
    p->>'device', p->>'browser', p->>'os', (p->>'screen_w')::int, (p->>'screen_h')::int,
    p->>'city', p->>'region', p->>'country', p->>'consent', coalesce((p->>'returning')::boolean, false),
    (p->>'duration_ms')::int, (p->>'max_scroll_pct')::int,
    coalesce((p->>'wa_clicks')::int, 0), coalesce((p->>'phone_clicks')::int, 0)
  )
  on conflict (id) do update set
    last_seen_at   = now(),
    -- Se um lote posterior chegou antes do primeiro, a atribuição ainda não estava na linha
    landing_path      = coalesce(s.landing_path, excluded.landing_path),
    landing_page_type = coalesce(s.landing_page_type, excluded.landing_page_type),
    referrer_host     = coalesce(s.referrer_host, excluded.referrer_host),
    utm_source     = coalesce(s.utm_source, excluded.utm_source),
    utm_medium     = coalesce(s.utm_medium, excluded.utm_medium),
    utm_campaign   = coalesce(s.utm_campaign, excluded.utm_campaign),
    utm_content    = coalesce(s.utm_content, excluded.utm_content),
    utm_term       = coalesce(s.utm_term, excluded.utm_term),
    gclid          = s.gclid or excluded.gclid,
    channel        = coalesce(s.channel, excluded.channel),
    device         = coalesce(s.device, excluded.device),
    browser        = coalesce(s.browser, excluded.browser),
    os             = coalesce(s.os, excluded.os),
    screen_w       = coalesce(s.screen_w, excluded.screen_w),
    screen_h       = coalesce(s.screen_h, excluded.screen_h),
    city           = coalesce(s.city, excluded.city),
    region         = coalesce(s.region, excluded.region),
    country        = coalesce(s.country, excluded.country),
    is_returning   = s.is_returning or excluded.is_returning,
    visitor_id     = coalesce(excluded.visitor_id, s.visitor_id),
    consent        = coalesce(excluded.consent, s.consent),
    duration_ms    = greatest(coalesce(excluded.duration_ms, 0), coalesce(s.duration_ms, 0)),
    max_scroll_pct = greatest(coalesce(excluded.max_scroll_pct, 0), coalesce(s.max_scroll_pct, 0)),
    wa_clicks      = s.wa_clicks + coalesce(excluded.wa_clicks, 0),
    phone_clicks   = s.phone_clicks + coalesce(excluded.phone_clicks, 0);
end;
$$;

revoke all on function public.novaferragista_upsert_session(jsonb) from public, anon, authenticated;
