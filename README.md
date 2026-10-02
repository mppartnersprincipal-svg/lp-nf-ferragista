# LP Nova Ferragista — build estático

Página única (`index.html`) + `assets/` (imagens WebP e vídeos). Sem build, sem dependências: é só publicar a pasta `site/` em qualquer hospedagem estática.

## Dados já preenchidos (fonte: Google Meu Negócio + Instagram)

- WhatsApp e telefone: (62) 4103-5123 → `wa.me/556241035123`, `tel:+556241035123`
- Endereço: Av. Delvaux Vieira Prudente — Jardim Monte Serrat, Aparecida de Goiânia - GO, 74917-470
- Horário: Seg a Sex 7h–18h · Sáb 7h–12h · Dom fechado
- Instagram: https://www.instagram.com/novaferragista_/
- Maps: link de busca do Google Maps (trocar pelo link "Compartilhar" da ficha, se preferir)
- Selo "4,7 no Google · 119 avaliações" na barra de confiança — **atualizar periodicamente**

## Ainda falta (buscar `{{` no `index.html`)

| Placeholder | O que é |
|---|---|
| `{{POLITICA_ENTREGA}}` | Resposta do FAQ "Vocês fazem entrega?" |
| `{{FORMAS_PAGAMENTO}}` | Resposta do FAQ de pagamento |
| `{{RAZAO_SOCIAL}}`, `{{CNPJ}}` | Rodapé |
| `{{URL_SITE}}` | Domínio final, sem barra no fim (canonical, OG, schema) |
| `{{DEPOIMENTO_*}}` | Seção oculta `#depoimentos` — preencher com depoimentos reais e remover `hidden` |

## Rastreamento

No fim do `index.html`, em `window.NF_TRACKING`:

- **Com GTM (recomendado):** preencha só `gtmId`. Todo clique em CTA de WhatsApp dispara `dataLayer.push({event: 'whatsapp_click', cta_id})`. No GTM, crie o gatilho "Evento personalizado = whatsapp_click" e ligue nele a conversão do Google Ads e o evento `Contact` do Meta Pixel (`Lead` quando `cta_id = cta_orcamento_obra`).
- **Sem GTM:** preencha `googleAdsId` + `googleAdsLabel` e/ou `metaPixelId`; a página dispara conversão/`Contact`/`Lead` direto.
- Não preencha os dois modos ao mesmo tempo (conversão contada em dobro).

IDs de origem (`cta_id`): `cta_whatsapp_navbar`, `cta_whatsapp_hero`, `cta_whatsapp_diferenciais`, `cta_whatsapp_categorias`, `cta_orcamento_obra`, `cta_whatsapp_final`, `cta_whatsapp_footer`, `fab_whatsapp`. Cliques de telefone, Instagram e Maps geram `phone_click`, `instagram_click`, `maps_click`.

## Mídia

Fotos e vídeos vêm da pasta `../Fotos` (originais). Os vídeos carregam só quando o visitante dá play (`preload="none"`), então não pesam na abertura da página. Vídeos não usados: o de horário (diz "Segunda a Sábado 07h às 18h", conflita com o Google) e o de duchas ("melhor preço da região" — promessa não confirmada).

## Design system

Cores, fontes (Oswald/Barlow) e escala de espaçamento vêm de `../Nova Ferragista design system/tokens/`. Por decisão da M|P (02/10/2026), esta LP se afasta do DS em três pontos:

- fundo branco (`--bg`) com seções em ink-50, em vez da base escura;
- CTAs em pílula e cards com cantos arredondados (`--r-*`), em vez de cantos retos;
- palavra destacada com marca-texto amarelo sobre fundo claro (amarelo como texto em fundo branco não tem contraste).

Hero, bloco B2B e rodapé continuam escuros para dar ritmo. Animações respeitam `prefers-reduced-motion`. O selo "Aberto agora" é calculado no navegador pelo horário de Brasília (Seg–Sex 7h–18h, Sáb 7h–12h) — se o horário mudar, atualizar o script no fim do `index.html`.
