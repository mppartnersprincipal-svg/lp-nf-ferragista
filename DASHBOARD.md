# Dashboard first-party da LP Nova Ferragista

Painel de comportamento dos visitantes em **/dashboard**, no mesmo modelo das LPs Construbloc e Gaspar Lopes:
coleta **própria, anônima e sempre ativa**, gravada no Supabase, **sem tocar** no GTM/GA4/Ads (que seguem o
`README.md` e o `gtm/GTM-KWF7SCQX-importar.json`). Inclui as seções **Google Ads** e **GA4**, lidas das APIs
oficiais (só leitura).

## Como funciona

| Peça | Arquivo | O quê |
|---|---|---|
| Coletor | `site/js/tracker.js` | Sessão anônima em `sessionStorage` (renova após 30 min parado), id de visitante em `localStorage` por 13 meses (apagado se `nf-consent = essential`), fila com envio a cada 10 eventos / 5 s / aba oculta / `pagehide` (`sendBeacon`). Sem IP, sem cookies. Não roda para bots nem no /dashboard. |
| Eventos | `tracker.js` + `track()` no `site/index.html` | Próprios: `page_view`, `page_leave` (tempo visível + rolagem máx.), `click` (texto, seção, posição), `section_view` (funil). Espelhados do `dataLayer` por `window.nfCollect`: `click_whatsapp` → `whatsapp_click`, `click_phone` → `phone_click`, `click_cta`/`click_maps`/`click_instagram`/`click_reviews` → `cta_click` (todos com `cta_location`), `faq_open` (`faq_question`). |
| Ingestão | `api/collect.js` + `api/_lib/payload.js` | Valida o lote, descarta bots, deriva dispositivo/navegador/SO do user-agent e cidade/UF dos cabeçalhos de geolocalização da Vercel. |
| Banco | `supabase/migrations/0001_novaferragista_analytics.sql` | `novaferragista_sessions` / `novaferragista_events` + RPC `novaferragista_upsert_session`. RLS ligado sem policies (só a service role acessa). **Já aplicada** no projeto `khipnjfbxjgvmjvyxero` em 07/10/2026. |
| Atribuição | `api/_lib/classify.js` | `gclid` → Google Ads; UTM/referrer → orgânico, Instagram, Meta, Facebook, direto, indicação. Mesmas regras da Sólida/Gaspar/Construbloc. |
| Login | `api/login.js` + `api/_lib/auth.js` | Senha única (`DASHBOARD_PASSWORD`) → token HMAC de 30 dias (`DASHBOARD_SECRET`). |
| Consulta | `api/dashboard.js` + `api/_lib/report.js` | KPIs com comparação de período, série diária, origens, dispositivos, WhatsApp por botão (`cta_id`) + pivô por canal, ligações, outros links, funil de leitura, FAQ, campanhas UTM, jornadas, heatmap 7×24, geografia, cliques, consentimento, novo × recorrente, feed ao vivo. |
| Google Ads | `api/google-ads.js` + `api/_lib/google-ads.js` | Consulta separada: se o Ads falhar, o resto do painel não espera nem zera. |
| GA4 | `api/ga4.js` + `api/_lib/ga4.js` | GA4 Data API (conta de serviço, só leitura). Conta os eventos `click_whatsapp`, `click_phone`, `click_cta`, `click_maps`, `click_instagram`, `click_reviews`. |
| UI | `site/dashboard/index.html` + `app.js` | Chart.js via CDN, filtros na URL, identidade visual da Nova (amarelo, bordô, Oswald/Barlow). `noindex` + `robots.txt`. |

Seções do funil (ordem da página): Hero (`topo`), Números, Dores, Diferenciais, Categorias, Construtores e empresas
(`obras`), Sobre, Por dentro da loja, Como funciona, Avaliações, FAQ, CTA final, Localização (`contato`).

## Variáveis de ambiente (Vercel → projeto `lp-nf-ferragista` → Settings → Environment Variables)

Nenhuma chave vai no código nem no front. Depois de cadastrar, faça **Redeploy**.

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | `https://khipnjfbxjgvmjvyxero.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | mesma do projeto da Construbloc (Supabase → Project Settings → API keys → `service_role`) (**secreta**) |
| `DASHBOARD_PASSWORD` | senha da tela de login (mín. 8) |
| `DASHBOARD_SECRET` | string aleatória longa (mín. 16) |
| `GOOGLE_ADS_CUSTOMER_ID` | ID da conta de anúncios da Nova Ferragista (10 dígitos; **não** é o `AW-18487795040`) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | `603-989-2603` (MCC) |
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` | mesmos valores da Construbloc |
| `GOOGLE_ADS_API_VERSION` | opcional; padrão `v25` |
| `GA4_PROPERTY_ID` | ID numérico da propriedade (Administrador → Detalhes da propriedade), não o `G-0QJEW1S61L` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | mesmo JSON da conta de serviço `dashboard-ga4@` da Construbloc (**secreto**). Adicione o e-mail dela como **Leitor** na propriedade GA4 da Nova. |

Sem as duas do Supabase, a coleta descarta em silêncio (a LP nunca quebra por causa de analytics). Sem senha/segredo,
o login responde 503. Sem as do Ads/GA4, cada seção mostra "conexão pendente".

## Desenvolvimento local

```
cp .env.example .env.local   # e preencha
npm run dev                  # http://localhost:4173 (site + /api + /dashboard)
npm test                     # classify, collect, agregações, Google Ads e GA4 (respostas simuladas)
```

## Deploy

- `vercel.json` publica `site/` (`outputDirectory: "site"`, `cleanUrls`); `api/` vira Vercel Functions.
- `/dashboard` e `/api/*` saem com `noindex` e `Cache-Control: no-store`; o `robots.txt` bloqueia os dois.
- `.vercelignore` tira do deploy `supabase/`, `gtm/`, `tests/`, `scripts/` e documentos.

## QA depois do deploy

- Abrir a LP, rolar, clicar em WhatsApp/telefone/Maps, abrir uma pergunta do FAQ e conferir em /dashboard (período "Hoje", seção "Ao vivo").
- **Nunca** rode `drop`/`delete` sem o prefixo `novaferragista_` nesse projeto: ele é compartilhado com Sólida, Gaspar, LM Tubos e Construbloc.

## LGPD

Coleta anônima e agregada: sem IP, sem cookies, sem dados pessoais. A LP ainda não tem banner de cookies; se entrar,
basta gravar `localStorage['nf-consent'] = 'accepted' | 'essential'`. Recomenda-se publicar uma Política de Privacidade simples.
