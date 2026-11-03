# Página inicial (landing)

A apresentação pública da plataforma: o que ela é, como funciona, o que inclui e
quanto custa. Código em `apps/web/src/landing/`, montado por
`apps/web/src/pages/LandingPage.tsx`.

## 1. Estrutura

| Seção | Arquivo | Fundo |
| --- | --- | --- |
| Cabeçalho (âncoras, entrar, criar conta) | `Header.tsx` | claro |
| 1. Hero | `Hero.tsx` | claro, com malha de projeto |
| 2. Pilares (`#plataforma`) | `Pillars.tsx` | cinza claro |
| 3. Como funciona (`#como-funciona`) | `HowItWorks.tsx` | azul institucional |
| Demonstração do painel | `Tour.tsx` | claro |
| 4. Recursos (`#recursos`) | `Features.tsx` | cinza claro |
| 5. Diferencial | `Differential.tsx` | azul institucional |
| 6. Segurança e organização | `Security.tsx` | claro |
| 7. Planos (`#planos`) | `Pricing.tsx` | cinza claro |
| 8. Perguntas frequentes (`#perguntas`) | `Faq.tsx`, `faq-content.ts` | claro |
| 9. CTA final | `FinalCta.tsx` | azul |
| 10. Rodapé | `Footer.tsx` | azul-escuro |

Hierarquia de títulos: um `h1` (hero), um `h2` por seção, `h3` dentro delas.
`landing.css` e a fonte (Inter, `@fontsource-variable/inter`, embarcada) são
importados só pela página, que carrega sob demanda: quem entra direto no painel
não baixa nada disso.

Identidade: a paleta azul do painel (`brand-*`) e o `slate`, sem cores novas. O
único motivo gráfico recorrente é a malha fina de projeto (`.lp-grid`), usada no
hero e nas áreas azuis.

## 2. De onde vem cada número

**Nenhum preço, limite ou benefício é escrito à mão.**

- `GET /api/public/plans` (`apps/api/src/routes/public-plans.ts`) devolve os
  planos ativos e públicos do banco -- a mesma fonte da cobrança. Sem sessão,
  com cache de 5 minutos. **Não** expõe id, ids da ValidaPay, erro de
  sincronização nem política de suspensão (teste dedicado).
- `landing/plans.ts` transforma esses dados em texto: lista de benefícios,
  preço, tamanho de armazenamento, singular/plural.
- O FAQ cita plano (quais têm painel, qual inclui hospedagem, teto de usuários,
  duração da avaliação) a partir dos mesmos dados. Sem eles, as respostas ficam
  gerais e **nunca** com nome ou número.
- Se a consulta falha, a seção de planos diz isso e oferece tentar de novo. Não
  mostra valores de semente: poderia anunciar um preço que já não é cobrado.

Mudar um preço, um limite ou um recurso no painel mestre muda a página (e as
respostas do FAQ) em até 5 minutos.

### O que é editorial

- A frase de apresentação de cada plano (`apresentacao`) vale **enquanto
  descreve o plano real**: a do Essencial diz que o conteúdo fica com a CODECA IA,
  e só aparece se o plano continua sem `cms_panel`. Fora disso entra a descrição
  cadastrada no painel mestre.
- Os rótulos de recurso são reescritos com acento (o sistema os guarda sem). O
  que decide se um recurso aparece é `limits.features`.
- O nome `Avaliacao` da semente é exibido como `Avaliação`; um nome que o
  superadmin tenha trocado aparece como ele escreveu.
- O destaque "Recomendado" é do plano de código `profissional`. É uma
  recomendação de produto (é onde está a autonomia que a página vende), **não** uma
  afirmação de que é o mais contratado -- não há dado que a sustente.

### Os botões de plano

Levam ao fluxo que já existe: quem não tem sessão vai a `/criar-conta` (o cadastro
cria a empresa na avaliação) e quem já entrou vai a `/painel/plano`, onde a
contratação e a troca de plano acontecem. Nada do cadastro ou da cobrança foi
alterado.

## 3. Demonstração do produto

As capturas em `src/assets/landing/*.webp` são da **interface real**, com dados de
demonstração (uma empresa fictícia, ilustrações vetoriais no lugar de fotos). A
página diz isso em legenda. Nada nelas é função que o painel não tenha.

Para refazê-las: subir a API com um banco de teste, cadastrar uma empresa com
imóveis, obras, serviços, banners e contatos de exemplo, entrar pelo painel e
fotografar visão geral, lista de imóveis, edição (viewport 1440x900, escala 2) e
visão geral no celular (390x844, escala 3); converter para WebP (qualidade 80,
largura 1920 / 780). A imagem de compartilhamento (`public/og-image.jpg`, 1200x630)
usa a mesma captura da visão geral.

O painel ainda escreve seus textos **sem acento** ("Visao geral", "Imoveis"), e as
capturas mostram isso. É uma convenção do projeto inteiro, fora do escopo da página.

## 4. SEO

- `index.html` traz título, descrição e Open Graph/Twitter da página inicial -- é o
  que rastreadores e prévias de link leem, sem executar JavaScript.
- `RouteMeta` ajusta o título da aba por rota e marca como `noindex` tudo que é
  área logada ou de acesso (painel, plataforma, entrar, criar conta, recuperação).
  `/`, `/termos` e `/privacidade` ficam indexáveis.
- `og:image`, canônico, `og:url` e `sitemap.xml` exigem URL absoluta. Vêm de
  `SITE_URL` ou, na Vercel, de `VERCEL_PROJECT_PRODUCTION_URL`. **Sem nenhuma das
  duas essas tags não são emitidas** (melhor omitir do que apontar para um domínio
  errado). Defina `SITE_URL` no ambiente de build quando o domínio definitivo
  existir.
- `robots.txt` (gerado no build) libera `/` e bloqueia `/painel`, `/plataforma` e
  `/api/`; cita o sitemap quando a URL é conhecida.

## 5. Termos de uso e política de privacidade

**Os textos não existem no projeto.** `/termos` e `/privacidade` existem como
páginas, linkadas no rodapé, e dizem exatamente isso ("documento ainda não
publicado"). Redigir termos e política não cabe a quem programa: eles obrigam a
empresa. Quando o texto estiver pronto, preencha `DOCUMENTOS` em
`pages/LegalPage.tsx`; a página passa a exibi-lo no lugar do aviso.

O cadastro já pede "Aceito os termos de uso e a política de privacidade" sem
linkar nada -- lacuna anterior a esta página, que continua aberta até o texto
existir.

## 6. Acessibilidade e desempenho

- Navegação por teclado em tudo (abas, segmentos, FAQ com `<details>`); link
  "Ir para o conteúdo"; `aria-label` nos esquemas; toda imagem tem `alt`.
- Animações discretas (opacidade e 12px de deslocamento) que respeitam
  `prefers-reduced-motion`; não alteram o tamanho, então não geram deslocamento de
  layout.
- Hero com `fetchpriority="high"`; demais imagens `loading="lazy"`; largura e
  altura declaradas em todas. Capturas em WebP (33 a 94 KB cada).
- Sem rolagem lateral de 320px a 1920px.
