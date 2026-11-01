import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Ultima barreira antes da tela branca.
 *
 * Sem isto, qualquer erro nao tratado durante a renderizacao desmonta a arvore
 * inteira e o React deixa a pagina **vazia**. O resultado e a pior tela
 * possivel para quem opera: branca, sem mensagem, sem endereco a reportar e
 * sem diferenca visivel entre "o codigo quebrou", "o bundle nao carregou" e
 * "a rede caiu". Esta classe existe para que um erro produza texto.
 *
 * Nao tenta se recuperar. Uma arvore que lancou esta num estado desconhecido,
 * e insistir nela trocaria uma falha clara por uma sequencia de falhas
 * estranhas. O que ela oferece e recarregar -- que e o que resolve a maioria
 * dos casos reais, um deploy novo com o `index.html` antigo em cache.
 */

interface Estado {
  erro: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, Estado> {
  override state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    // O console e o unico canal garantido: nao ha coletor de erros contratado,
    // e inventar um aqui seria enviar dado de cliente para um terceiro que
    // ninguem escolheu.
    console.error('[painel] erro nao tratado na renderizacao', erro, info.componentStack);
  }

  override render(): ReactNode {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          // Estilo embutido de proposito: se o que quebrou foi o CSS, uma
          // classe do Tailwind nao desenharia nada e a tela voltaria a ser
          // branca -- justamente no caminho que existe para nao ser.
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          color: '#0f172a',
          background: '#f8fafc',
        }}
      >
        <div style={{ maxWidth: '32rem', display: 'grid', gap: '12px' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            O painel encontrou um erro
          </h1>
          <p style={{ margin: 0, color: '#475569', lineHeight: 1.5 }}>
            A tela nao pode ser desenhada. Recarregar costuma resolver, sobretudo logo depois de
            uma atualizacao da plataforma. Se continuar, envie a mensagem abaixo para a CODECA IA.
          </p>
          <pre
            style={{
              margin: 0,
              padding: '12px',
              borderRadius: '8px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              color: '#b91c1c',
              fontSize: '0.8125rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {erro.message}
          </pre>
          <div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 0,
                background: '#1d4ed8',
                color: '#fff',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
