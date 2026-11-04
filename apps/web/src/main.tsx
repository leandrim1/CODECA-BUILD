import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { preloadRoute } from './lib/routePreload.js';
import './index.css';

// O codigo da tela pedida comeca a descer ja, junto da consulta da sessao, em
// vez de esperar a sessao, os modulos e so entao o clique de rota.
preloadRoute(window.location.pathname);

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado no documento.');

createRoot(container).render(
  <StrictMode>
    {/*
      Fora do `BrowserRouter` de proposito: um erro na propria montagem do
      roteador tambem precisa virar texto, e nao tela branca.
    */}
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
