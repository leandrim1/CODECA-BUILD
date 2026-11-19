'use client';

import { useState } from 'react';
import { CodecaError } from '@codeca/sdk';
import { clienteDoNavegador } from '@/lib/codeca-navegador';

/**
 * Formulario de contato.
 *
 * Envia direto do navegador, com a chave publicavel. A plataforma aceita
 * CRIAR um interessado por ela; nao existe escopo que permita LISTAR. Nome e
 * telefone sao dado pessoal e ficam atras do painel autenticado.
 *
 * A tela de obrigado se monta com o que ja esta no formulario: `leads.create`
 * devolve so a confirmacao, de proposito.
 */
export function FormularioDeContato() {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const nome = String(dados.get('nome') ?? '');

    setEnviando(true);
    setErro(null);
    try {
      await clienteDoNavegador().leads.create({
        name: nome,
        phone: String(dados.get('telefone') ?? ''),
        email: String(dados.get('email') ?? '') || undefined,
        // Obrigatorio. Troque pelo tipo que faz sentido no seu segmento --
        // a plataforma aceita texto, e o painel mostra o que vier.
        interestType: 'contato',
        message: String(dados.get('mensagem') ?? ''),
        // De onde o contato veio: aparece no painel e ajuda a empresa a saber
        // qual pagina traz cliente.
        sourcePath: window.location.pathname,
        // Campo oculto: pessoa nao ve, robo preenche. Preenchido, a
        // plataforma descarta sem avisar o remetente.
        honeypot: String(dados.get('apelido') ?? ''),
        // Sem consentimento a plataforma recusa: o registro do aceite e o que
        // sustenta o tratamento do dado pessoal (LGPD).
        consent: true,
      });
      setEnviado(nome);
    } catch (falha) {
      setErro(
        falha instanceof CodecaError && falha.isRateLimited
          ? 'Muitas tentativas seguidas. Tente de novo em instantes.'
          : 'Não foi possível enviar agora. Tente de novo em instantes.',
      );
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return <p role="status">Obrigado, {enviado}. Recebemos o seu contato e retornamos em breve.</p>;
  }

  return (
    <form onSubmit={enviar}>
      <label htmlFor="nome">Nome</label>
      <input id="nome" name="nome" required />

      <label htmlFor="telefone">Telefone</label>
      <input id="telefone" name="telefone" required />

      <label htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" />

      {/*
        Armadilha de robo: fora da tela e fora do caminho do teclado, mas
        presente no formulario. `display:none` seria mais simples e alguns
        robos pulam campo escondido -- este eles preenchem.
      */}
      <input
        type="text"
        name="apelido"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px' }}
      />

      <label htmlFor="mensagem">Mensagem</label>
      <textarea id="mensagem" name="mensagem" />

      {erro ? <p role="alert">{erro}</p> : null}

      <button type="submit" disabled={enviando}>
        {enviando ? 'Enviando...' : 'Enviar'}
      </button>
    </form>
  );
}
