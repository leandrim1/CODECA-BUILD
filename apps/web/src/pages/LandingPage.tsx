import { useEffect } from 'react';
import '@fontsource-variable/inter';
import '../landing/landing.css';
import { Differential } from '../landing/Differential.js';
import { Faq } from '../landing/Faq.js';
import { Features } from '../landing/Features.js';
import { FinalCta } from '../landing/FinalCta.js';
import { Footer } from '../landing/Footer.js';
import { Header } from '../landing/Header.js';
import { Hero } from '../landing/Hero.js';
import { HowItWorks } from '../landing/HowItWorks.js';
import { Pillars } from '../landing/Pillars.js';
import { Pricing } from '../landing/Pricing.js';
import { Security } from '../landing/Security.js';
import { Segments } from '../landing/Segments.js';
import { Tour } from '../landing/Tour.js';

/**
 * Pagina inicial da plataforma.
 *
 * As secoes vivem em `landing/`; esta pagina so as ordena. A ordem alterna
 * fundo claro e azul institucional, e cada secao e um `<section>` com o seu
 * titulo (`h2`) -- o unico `h1` e o do hero.
 */
export function LandingPage() {
  // Rolagem suave nas ancoras do menu, so enquanto esta pagina esta aberta e
  // se a pessoa nao pediu menos movimento.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const raiz = document.documentElement;
    const anterior = raiz.style.scrollBehavior;
    raiz.style.scrollBehavior = 'smooth';
    return () => {
      raiz.style.scrollBehavior = anterior;
    };
  }, []);

  return (
    <div className="landing bg-white text-slate-800">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-overlay"
      >
        Ir para o conteúdo
      </a>
      <Header />
      <main id="conteudo">
        <Hero />
        <Segments />
        <Pillars />
        <HowItWorks />
        <Tour />
        <Features />
        <Differential />
        <Security />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
