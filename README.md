# LP Nova Ferragista — build estático

Página única (`site/index.html`) + `site/assets/` (imagens WebP e vídeos), sem build. No ar em https://www.novaferragista.com.br (Vercel, deploy automático a cada push na `main`).

Painel de métricas em **/dashboard** (coleta própria + GA4 + Google Ads): ver [DASHBOARD.md](DASHBOARD.md).

## Dados já preenchidos (fonte: Google Meu Negócio + Instagram)

- WhatsApp e telefone: (62) 4103-5123 → `wa.me/556241035123`, `tel:+556241035123`
- Endereço: Av. Delvaux Vieira Prudente — Jardim Monte Serrat, Aparecida de Goiânia - GO, 74917-470
- Horário: Seg a Sex 7h–18h · Sáb 7h–12h · Dom fechado
- Instagram: https://www.instagram.com/novaferragista_/
- Maps: link de busca do Google Maps (trocar pelo link "Compartilhar" da ficha, se preferir)
- Selo "4,7 no Google · 119 avaliações" na barra de confiança — **atualizar periodicamente**

## Ainda falta (buscar `{{` no `site/index.html`)

| Placeholder | O que é |
|---|---|
| `{{POLITICA_ENTREGA}}` | Resposta do FAQ "Vocês fazem entrega?" |
| `{{FORMAS_PAGAMENTO}}` | Resposta do FAQ de pagamento |
| `{{RAZAO_SOCIAL}}`, `{{CNPJ}}` | Rodapé |
| `{{DEPOIMENTO_*}}` | Seção oculta `#depoimentos` — preencher com depoimentos reais e remover `hidden` |

## Rastreamento (ativo desde 07/10/2026)

Tudo passa pelo GTM `GTM-KWF7SCQX`. A página só carrega o GTM e envia eventos ao `dataLayer`; não colocar gtag nem pixel direto no HTML.

Configuração do container: importar [gtm/GTM-KWF7SCQX-importar.json](gtm/GTM-KWF7SCQX-importar.json) (Admin > Importar contêiner > Mesclar). Ele cria:

| Tag | Acionador |
|---|---|
| GA4 - Google Tag (config) `G-0QJEW1S61L` | All Pages |
| GA4 - Evento - Eventos da LP (nome = `{{Event}}`, envia `cta_id`, `section_id`, `percent_scrolled` e UTMs) | eventos da tabela abaixo |
| Google Ads - Conversão - Clique no Botão de Wpp `18487795040` / `Yto-CPqs45QdEOC61e9E` | `click_whatsapp` |
| Google Ads - Vinculador de conversões | All Pages |

Meta Pixel: ainda não configurado — quando houver, criar no GTM (`Contact` em `click_whatsapp`, `Lead` quando `cta_id = cta_orcamento_obra`).

UTMs da URL de entrada ficam no `sessionStorage` (`nf_utms`) e seguem em todos os eventos da sessão.

Eventos:

| Evento | Quando | Parâmetros |
|---|---|---|
| `click_whatsapp` | clique em qualquer botão de WhatsApp | `cta_id` |
| `click_cta` | "Ver categorias" | `cta_id` |
| `click_phone`, `click_maps`, `click_instagram`, `click_reviews` | links de telefone, Maps, Instagram e avaliações | — |
| `scroll_25/50/75/100` | profundidade de rolagem, uma vez por página | `percent_scrolled` |
| `section_view` | seção cruza o meio da tela, uma vez por seção | `section_id` |

`cta_id` dos botões de WhatsApp: `cta_whatsapp_navbar`, `cta_whatsapp_hero`, `cta_whatsapp_diferenciais`, `cta_whatsapp_categorias`, `cta_orcamento_obra`, `cta_whatsapp_faq`, `cta_whatsapp_final`, `cta_whatsapp_footer`, `fab_whatsapp`.

`section_id`: `topo`, `dores`, `dif`, `categorias`, `obras`, `sobre`, `loja`, `como`, `avaliacoes`, `duvidas`, `final`, `contato`.

Não há formulário na página, então não existe `form_submit`.

## Mídia

Fotos e vídeos vêm da pasta `../Fotos` (originais). Os vídeos carregam só quando o visitante dá play (`preload="none"`), então não pesam na abertura da página. Vídeos não usados: o de horário (diz "Segunda a Sábado 07h às 18h", conflita com o Google) e o de duchas ("melhor preço da região" — promessa não confirmada).

## Design system

Cores, fontes (Oswald/Barlow) e escala de espaçamento vêm de `../Nova Ferragista design system/tokens/`. Por decisão da M|P (02/10/2026), esta LP se afasta do DS em três pontos:

- fundo branco (`--bg`) com seções em ink-50, em vez da base escura;
- CTAs em pílula e cards com cantos arredondados (`--r-*`), em vez de cantos retos;
- palavra destacada com marca-texto amarelo sobre fundo claro (amarelo como texto em fundo branco não tem contraste).

Hero, bloco B2B e rodapé continuam escuros para dar ritmo. Animações respeitam `prefers-reduced-motion`. O selo "Aberto agora" é calculado no navegador pelo horário de Brasília (Seg–Sex 7h–18h, Sáb 7h–12h) — se o horário mudar, atualizar o script no fim do `index.html`.
