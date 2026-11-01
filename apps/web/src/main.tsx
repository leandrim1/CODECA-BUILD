import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root nao encontrado no documento.');

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
