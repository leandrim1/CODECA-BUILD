/**
 * Folha de estilo base dos sites publicos.
 *
 * Nao usamos utilitarios compilados aqui: o site e renderizado no servidor e
 * precisa de uma folha estavel que leia as variaveis CSS do tema da empresa.
 * Assim a identidade visual troca sem rebuild e sem CSS gerado por tenant.
 *
 * Variantes do tema (estilo de botao, card, cabecalho e rodape) chegam como
 * atributos `data-*` no elemento raiz, valores vindos de enums validados.
 */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation-duration:.01ms !important;transition-duration:.01ms !important}}
body{margin:0;font-family:var(--ct-font-body);font-size:var(--ct-font-size);line-height:1.6;color:var(--ct-text);background:var(--ct-background);-webkit-font-smoothing:antialiased}
img,svg,video{max-width:100%;height:auto;display:block}
a{color:inherit;text-decoration:none}
a:hover{text-decoration:underline}
button{font:inherit;cursor:pointer}
:focus-visible{outline:3px solid var(--ct-accent);outline-offset:2px;border-radius:4px}
h1,h2,h3,h4,h5,h6{font-family:var(--ct-font-heading);line-height:1.15;margin:0 0 .5em;font-weight:700;letter-spacing:-.01em}
h1{font-size:clamp(2rem,1.3rem + 2.6vw,3.4rem)}
h2{font-size:clamp(1.6rem,1.1rem + 1.7vw,2.5rem)}
h3{font-size:clamp(1.25rem,1rem + .9vw,1.7rem)}
h4{font-size:1.15rem}
p{margin:0 0 1em}
p:last-child{margin-bottom:0}
ul,ol{margin:0 0 1em;padding-left:1.25em}
hr{border:0;border-top:1px solid var(--ct-border)}
.ct-skip{position:absolute;left:-9999px;top:0;background:var(--ct-primary);color:var(--ct-inverse);padding:.75rem 1rem;z-index:100}
.ct-skip:focus{left:.5rem;top:.5rem}
.ct-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* ----------------------------------------------------------- estrutura */
.ct-section{position:relative}
.ct-container{width:100%;max-width:var(--ct-section-width,var(--ct-content-width));margin:0 auto;padding-inline:clamp(1rem,4vw,2.5rem)}
.ct-narrow{max-width:min(var(--ct-section-max,72ch),100%)}
.ct-stack>*+*{margin-top:1rem}
.ct-eyebrow{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ct-accent);margin-bottom:.75rem}
.ct-lead{font-size:1.125rem;color:var(--ct-muted);max-width:68ch}
.ct-section[style*="text-align: center"] .ct-lead,.ct-center .ct-lead{margin-inline:auto}
.ct-head{margin-bottom:2.5rem}
.ct-head h2{margin-bottom:.35rem}

/* --------------------------------------------------------------- grade */
.ct-grid{display:grid;gap:1.5rem;grid-template-columns:repeat(var(--ct-cols,3),minmax(0,1fr))}
@media (max-width:1024px){.ct-grid{grid-template-columns:repeat(min(var(--ct-cols,3),2),minmax(0,1fr))}}
@media (max-width:640px){.ct-grid{grid-template-columns:1fr}}
.ct-split{display:grid;gap:clamp(1.5rem,4vw,3.5rem);align-items:center;grid-template-columns:var(--ct-split,1fr 1fr)}
@media (max-width:860px){.ct-split{grid-template-columns:1fr}.ct-split>.ct-split-media{order:-1}}

/* --------------------------------------------------------------- botoes */
.ct-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.8rem 1.5rem;border-radius:var(--ct-radius-button);border:2px solid transparent;font-weight:600;text-transform:var(--ct-button-transform);letter-spacing:var(--ct-button-letter-spacing);transition:transform .15s ease,box-shadow .15s ease,background-color .15s ease;text-decoration:none;min-height:44px}
.ct-btn:hover{text-decoration:none;transform:translateY(-1px)}
.ct-btn:active{transform:none}
.ct-btn-primary{background:var(--ct-primary);color:var(--ct-inverse)}
.ct-btn-secondary{background:var(--ct-secondary);color:var(--ct-inverse)}
.ct-btn-accent{background:var(--ct-accent);color:var(--ct-secondary)}
.ct-btn-outline{border-color:currentColor;color:inherit;background:transparent}
.ct-btn-ghost{background:color-mix(in srgb,currentColor 10%,transparent);color:inherit}
[data-buttons="outline"] .ct-btn-primary{background:transparent;border-color:var(--ct-primary);color:var(--ct-primary)}
[data-buttons="soft"] .ct-btn-primary{background:color-mix(in srgb,var(--ct-primary) 14%,transparent);color:var(--ct-primary)}
[data-buttons="link"] .ct-btn{padding:.25rem 0;background:none;border:0;color:var(--ct-primary);text-decoration:underline;min-height:0}
.ct-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.75rem}
.ct-section[style*="text-align: center"] .ct-actions,.ct-center .ct-actions{justify-content:center}

/* ---------------------------------------------------------------- cards */
.ct-card{background:var(--ct-background);border-radius:var(--ct-radius);overflow:hidden;display:flex;flex-direction:column;height:100%;text-align:left;transition:transform .18s ease,box-shadow .18s ease}
[data-card="outlined"] .ct-card{border:1px solid var(--ct-border)}
[data-card="elevated"] .ct-card{box-shadow:0 1px 2px rgba(15,23,42,.06),0 12px 28px -12px rgba(15,23,42,.18)}
[data-card="elevated"] .ct-card:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(15,23,42,.08),0 18px 36px -14px rgba(15,23,42,.24)}
[data-card="flat"] .ct-card{background:var(--ct-surface)}
.ct-card-body{padding:1.25rem 1.35rem 1.5rem;display:flex;flex-direction:column;gap:.5rem;flex:1}
.ct-card-title{font-family:var(--ct-font-heading);font-size:1.1rem;font-weight:700;margin:0;line-height:1.3}
.ct-card-text{color:var(--ct-muted);font-size:.94rem;margin:0}
.ct-card-foot{margin-top:auto;padding-top:.85rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem}
.ct-media{position:relative;background:var(--ct-surface);overflow:hidden}
.ct-media img{width:100%;height:100%;object-fit:cover;transition:transform .4s ease}
.ct-card:hover .ct-media img{transform:scale(1.03)}
.ct-ratio-16-9{aspect-ratio:16/9}
.ct-ratio-4-3{aspect-ratio:4/3}
.ct-ratio-1-1{aspect-ratio:1/1}
.ct-ratio-3-4{aspect-ratio:3/4}

/* Espaco reservado quando a empresa ainda nao enviou a imagem. */
.ct-placeholder{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,color-mix(in srgb,var(--ct-primary) 12%,var(--ct-surface)),color-mix(in srgb,var(--ct-secondary) 10%,var(--ct-surface)));color:color-mix(in srgb,var(--ct-secondary) 55%,transparent)}
.ct-placeholder svg{width:34px;height:34px;opacity:.65}

/* --------------------------------------------------------------- chips */
.ct-chips{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;margin:0;padding:0}
.ct-chip{display:inline-flex;align-items:center;gap:.3rem;font-size:.8rem;font-weight:600;padding:.3rem .6rem;border-radius:999px;background:var(--ct-surface);color:var(--ct-muted);border:1px solid var(--ct-border)}
.ct-badge{display:inline-flex;align-items:center;gap:.35rem;font-size:.75rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:.3rem .6rem;border-radius:999px;background:var(--ct-accent);color:var(--ct-secondary)}
.ct-badge-muted{background:var(--ct-surface);color:var(--ct-muted);border:1px solid var(--ct-border)}
.ct-price{font-family:var(--ct-font-heading);font-size:1.2rem;font-weight:700;color:var(--ct-primary)}
.ct-facts{display:flex;flex-wrap:wrap;gap:.75rem 1.1rem;list-style:none;margin:0;padding:0;font-size:.88rem;color:var(--ct-muted)}
.ct-facts li{display:flex;align-items:center;gap:.35rem}
.ct-facts svg{width:16px;height:16px;flex:none;opacity:.8}

/* ------------------------------------------------------------ cabecalho */
.ct-header{background:var(--ct-background);border-bottom:1px solid var(--ct-border);position:relative;z-index:30}
.ct-header[data-sticky="true"]{position:sticky;top:0}
.ct-header[data-variant="dark"]{background:var(--ct-secondary);color:var(--ct-inverse);border-bottom-color:transparent}
.ct-header[data-variant="transparent"]{background:transparent;border-bottom-color:transparent;position:absolute;inset-inline:0}
.ct-header-inner{display:flex;align-items:center;gap:1.25rem;min-height:72px;padding-block:.75rem}
.ct-header[data-layout="logo-center"] .ct-header-inner{justify-content:center;flex-wrap:wrap}
.ct-logo{display:flex;align-items:center;gap:.6rem;font-family:var(--ct-font-heading);font-weight:700;font-size:1.1rem;flex:none}
.ct-logo img{max-height:46px;width:auto}
.ct-nav{margin-left:auto;display:flex;align-items:center;gap:.35rem}
.ct-nav ul{display:flex;align-items:center;gap:.15rem;list-style:none;margin:0;padding:0}
.ct-nav a{padding:.55rem .8rem;border-radius:var(--ct-radius);font-weight:500;font-size:.95rem}
.ct-nav a:hover{background:color-mix(in srgb,currentColor 10%,transparent);text-decoration:none}
.ct-nav a[aria-current="page"]{color:var(--ct-primary);font-weight:700}
.ct-header[data-variant="dark"] .ct-nav a[aria-current="page"]{color:var(--ct-accent)}
.ct-header-contact{display:flex;align-items:center;gap:.5rem;flex:none}
.ct-header-phone{display:inline-flex;align-items:center;gap:.4rem;font-weight:600;font-size:.95rem}
.ct-burger{display:none}
.ct-burger-label{display:none;margin-left:auto;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid var(--ct-border);border-radius:var(--ct-radius);flex:none}
@media (max-width:980px){
  .ct-burger-label{display:inline-flex}
  .ct-nav,.ct-header-contact{display:none;width:100%}
  .ct-header-inner{flex-wrap:wrap}
  .ct-burger:checked ~ .ct-nav,.ct-burger:checked ~ .ct-header-contact{display:flex;flex-direction:column;align-items:stretch;gap:.2rem;margin:0 0 1rem;padding-top:.5rem;border-top:1px solid var(--ct-border)}
  .ct-burger:checked ~ .ct-nav ul{flex-direction:column;align-items:stretch;width:100%}
  .ct-burger:checked ~ .ct-nav a{padding:.8rem .6rem}
}

/* ------------------------------------------------------------------ hero */
.ct-hero{display:flex;align-items:center}
.ct-hero-small{min-height:min(34vh,280px)}
.ct-hero-medium{min-height:min(52vh,420px)}
.ct-hero-large{min-height:min(68vh,580px)}
.ct-hero-full{min-height:88vh}
.ct-hero-body{max-width:62ch}
.ct-hero[data-position="center"] .ct-hero-body{margin-inline:auto;text-align:center}
.ct-hero[data-position="right"] .ct-hero-body{margin-left:auto;text-align:right}
.ct-hero h1{margin-bottom:.6rem}
.ct-hero .ct-lead{color:inherit;opacity:.92}

/* -------------------------------------------------------------- galeria */
.ct-gallery{display:grid;grid-template-columns:repeat(var(--ct-cols,3),minmax(0,1fr));gap:var(--ct-gap,1rem)}
@media (max-width:1024px){.ct-gallery{grid-template-columns:repeat(min(var(--ct-cols,3),2),minmax(0,1fr))}}
@media (max-width:560px){.ct-gallery{grid-template-columns:1fr}}
.ct-gallery a{display:block;border-radius:var(--ct-radius);overflow:hidden;background:var(--ct-surface)}
.ct-gallery img{width:100%;height:100%;object-fit:cover}
/* Ampliacao sem JavaScript, usando :target. */
.ct-lightbox{position:fixed;inset:0;background:rgba(8,12,20,.92);display:flex;align-items:center;justify-content:center;padding:2rem;z-index:80;opacity:0;pointer-events:none}
.ct-lightbox:target{opacity:1;pointer-events:auto}
.ct-lightbox img{max-width:min(96vw,1400px);max-height:88vh;width:auto;object-fit:contain;border-radius:var(--ct-radius)}
.ct-lightbox-close{position:absolute;top:1rem;right:1.25rem;color:#fff;font-size:2rem;line-height:1;padding:.5rem 1rem;border-radius:var(--ct-radius);background:rgba(255,255,255,.12)}

/* ----------------------------------------------------------- acordeao */
.ct-faq{display:grid;gap:.65rem;max-width:80ch;margin-inline:auto;text-align:left}
.ct-faq details{border:1px solid var(--ct-border);border-radius:var(--ct-radius);background:var(--ct-background);overflow:hidden}
.ct-faq summary{padding:1.05rem 1.25rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:1rem;list-style:none}
.ct-faq summary::-webkit-details-marker{display:none}
.ct-faq summary::after{content:"+";font-size:1.4rem;line-height:1;color:var(--ct-primary);flex:none}
.ct-faq details[open] summary::after{content:"\\2212"}
.ct-faq-answer{padding:0 1.25rem 1.2rem;color:var(--ct-muted)}

/* ----------------------------------------------------------- depoimentos */
.ct-quote{background:var(--ct-surface);border-radius:var(--ct-radius);padding:1.6rem;display:flex;flex-direction:column;gap:1rem;height:100%;text-align:left}
.ct-quote blockquote{margin:0;font-size:1.02rem}
.ct-quote-author{display:flex;align-items:center;gap:.75rem;margin-top:auto}
.ct-avatar{width:48px;height:48px;border-radius:999px;object-fit:cover;flex:none;background:var(--ct-border)}
.ct-stars{color:var(--ct-accent);letter-spacing:.1em;font-size:.95rem}

/* -------------------------------------------------------------- numeros */
.ct-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1.25rem;margin-top:1.75rem;list-style:none;padding:0}
.ct-stat-value{font-family:var(--ct-font-heading);font-size:1.9rem;font-weight:700;color:var(--ct-primary);display:block;line-height:1.1}
.ct-stat-label{font-size:.88rem;color:var(--ct-muted)}

/* ----------------------------------------------------- progresso de obra */
.ct-progress{display:flex;align-items:center;gap:.6rem;font-size:.85rem;color:var(--ct-muted)}
.ct-progress-track{flex:1;height:7px;border-radius:999px;background:var(--ct-border);overflow:hidden}
.ct-progress-fill{height:100%;background:var(--ct-primary);border-radius:999px}
.ct-timeline{list-style:none;margin:2rem 0 0;padding:0;display:grid;gap:1.25rem}
.ct-timeline li{display:grid;gap:.4rem;padding-left:1.4rem;border-left:2px solid var(--ct-border);position:relative}
.ct-timeline li::before{content:"";position:absolute;left:-6px;top:.4rem;width:10px;height:10px;border-radius:999px;background:var(--ct-primary)}
.ct-timeline-date{font-size:.8rem;color:var(--ct-muted);font-weight:600}

/* ----------------------------------------------------------- formulario */
.ct-form{display:grid;gap:1rem;text-align:left}
.ct-field{display:grid;gap:.35rem}
.ct-field label{font-size:.88rem;font-weight:600}
.ct-field .ct-req{color:var(--ct-primary)}
.ct-input,.ct-select,.ct-textarea{width:100%;padding:.75rem .9rem;border:1px solid var(--ct-border);border-radius:var(--ct-radius);background:var(--ct-background);color:var(--ct-text);font:inherit;min-height:46px}
.ct-textarea{min-height:130px;resize:vertical}
.ct-input:focus,.ct-select:focus,.ct-textarea:focus{outline:none;border-color:var(--ct-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--ct-primary) 22%,transparent)}
.ct-row{display:grid;gap:1rem;grid-template-columns:1fr 1fr}
@media (max-width:640px){.ct-row{grid-template-columns:1fr}}
.ct-consent{display:flex;gap:.6rem;align-items:flex-start;font-size:.86rem;color:var(--ct-muted)}
.ct-consent input{margin-top:.25rem;width:18px;height:18px;flex:none}
.ct-form-status{padding:.85rem 1rem;border-radius:var(--ct-radius);font-size:.92rem;display:none}
.ct-form-status[data-state="success"]{display:block;background:color-mix(in srgb,#16a34a 14%,transparent);color:#15803d}
.ct-form-status[data-state="error"]{display:block;background:color-mix(in srgb,#dc2626 12%,transparent);color:#b91c1c}
.ct-honeypot{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.ct-contact-info{display:grid;gap:1rem;align-content:start;text-align:left}
.ct-contact-line{display:flex;gap:.65rem;align-items:flex-start}
.ct-contact-line svg{width:20px;height:20px;flex:none;color:var(--ct-primary);margin-top:.15rem}
.ct-contact-line strong{display:block;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ct-muted);font-weight:700}

/* -------------------------------------------------------------- rodape */
.ct-footer{background:var(--ct-surface);color:var(--ct-text)}
.ct-footer[data-variant="dark"]{background:var(--ct-secondary);color:var(--ct-inverse)}
.ct-footer[data-variant="brand"]{background:var(--ct-primary);color:var(--ct-inverse)}
.ct-footer-inner{display:grid;gap:2.5rem;grid-template-columns:minmax(220px,1.3fr) repeat(auto-fit,minmax(150px,1fr));padding-block:3.5rem 2rem;text-align:left}
.ct-footer h3{font-size:.86rem;text-transform:uppercase;letter-spacing:.09em;opacity:.75;margin-bottom:.9rem}
.ct-footer ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem;font-size:.94rem}
.ct-footer-about{font-size:.94rem;opacity:.85;max-width:40ch}
.ct-social{display:flex;gap:.6rem;margin-top:1.1rem}
.ct-social a{width:40px;height:40px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,currentColor 14%,transparent)}
.ct-footer-bottom{border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);padding-block:1.25rem;display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;justify-content:space-between;font-size:.84rem;opacity:.8}

/* ------------------------------------------------------- whatsapp flutuante */
.ct-wa-float{position:fixed;right:1.1rem;bottom:1.1rem;z-index:60;display:inline-flex;align-items:center;gap:.55rem;padding:.85rem 1.15rem;border-radius:999px;background:#25d366;color:#04281a;font-weight:700;box-shadow:0 10px 26px -8px rgba(5,40,25,.5)}
.ct-wa-float:hover{text-decoration:none;transform:translateY(-2px)}
.ct-wa-float span{display:none}
@media (min-width:720px){.ct-wa-float span{display:inline}}

/* ------------------------------------------------------------- diversos */
.ct-divider{border:0;border-top-style:solid;margin:0 auto}
.ct-icon-box{width:52px;height:52px;border-radius:var(--ct-radius);display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--ct-primary) 12%,transparent);color:var(--ct-primary);margin-bottom:1rem}
.ct-icon-box svg{width:26px;height:26px}
.ct-empty{padding:2.5rem 1rem;text-align:center;color:var(--ct-muted);border:1px dashed var(--ct-border);border-radius:var(--ct-radius)}
.ct-platform-badge{font-size:.8rem;opacity:.7}
.ct-preview-flag{position:fixed;left:50%;transform:translateX(-50%);bottom:1rem;z-index:90;background:#1f2937;color:#fff;font-size:.8rem;font-weight:600;padding:.5rem 1rem;border-radius:999px;box-shadow:0 8px 20px -6px rgba(0,0,0,.4)}
.ct-detail-head{display:grid;gap:1rem;margin-bottom:2rem}
.ct-detail-grid{display:grid;gap:clamp(1.5rem,4vw,3rem);grid-template-columns:minmax(0,2fr) minmax(260px,1fr);align-items:start}
@media (max-width:980px){.ct-detail-grid{grid-template-columns:1fr}}
.ct-aside{background:var(--ct-surface);border-radius:var(--ct-radius);padding:1.5rem;display:grid;gap:1rem;position:sticky;top:96px;text-align:left}
@media (max-width:980px){.ct-aside{position:static}}
.ct-prose{max-width:72ch}
.ct-prose p{white-space:pre-line}
.ct-breadcrumb{font-size:.86rem;color:var(--ct-muted);display:flex;gap:.4rem;flex-wrap:wrap}
`;
