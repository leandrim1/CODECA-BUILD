import { useEffect, useState } from 'react';
import { Button, Modal, Switch } from '@codeca/ui';
import { useConsentimento } from './ConsentimentoProvider.js';
import {
  COOKIES_DO_PAINEL,
  NOME_DA_CATEGORIA,
  TEXTO_DA_CATEGORIA,
  type CategoriaOpcional,
} from './inventario.js';
import { type Escolha } from './armazenamento.js';

/**
 * As preferencias de cookies, por categoria.
 *
 * Monta sobre o `Modal` do pacote de UI, que usa o `<dialog>` nativo: foco
 * preso dentro, Esc fecha e o fundo fica inerte vem do navegador -- escrever
 * isso de novo aqui so acrescentaria defeitos.
 *
 * Mostra as categorias que o INVENTARIO justifica, e nao as tres sempre. Um
 * interruptor que nao governa nada e pior do que a ausencia dele: ele promete
 * um controle que nao existe.
 */
export function PreferenciasDeCookies() {
  const { preferenciasAbertas, fecharPreferencias, escolha, salvar, opcionaisEmUso, ferramentas, decisao } =
    useConsentimento();

  // Rascunho local: mexer no interruptor nao e consentir -- consentir e
  // apertar "Salvar". Fechar sem salvar nao muda nada.
  const [rascunho, setRascunho] = useState<Escolha>(escolha);
  useEffect(() => {
    if (preferenciasAbertas) setRascunho(escolha);
  }, [preferenciasAbertas, escolha]);

  const necessarios = COOKIES_DO_PAINEL.filter((cookie) => cookie.categoria === 'necessarios');
  const semEscolha = opcionaisEmUso.length === 0;

  return (
    <Modal
      open={preferenciasAbertas}
      onClose={fecharPreferencias}
      title="Preferências de cookies"
      description="Escolha o que o painel pode usar. O necessário não pode ser desligado — sem ele não há como entrar."
      size="lg"
      footer={
        /*
          Sem categoria opcional NAO ha o que salvar -- e gravar assim mesmo
          seria pior do que inutil: a decisao guardada faria o banner nao
          aparecer no dia em que a primeira ferramenta fosse declarada, e a
          pessoa nunca seria perguntada. Entao a tela so informa, e fecha.
        */
        semEscolha ? (
          <Button onClick={fecharPreferencias}>Entendi</Button>
        ) : (
          <>
            <Button variant="outline" onClick={fecharPreferencias}>
              Cancelar
            </Button>
            <Button onClick={() => salvar(rascunho)}>Salvar preferências</Button>
          </>
        )
      }
    >
      <div className="grid gap-5">
        {/*
          O proprio `Switch` traz rotulo e descricao ao lado da chavinha --
          por isso nao ha titulo separado aqui. Escrever o nome da categoria
          duas vezes faria o leitor de tela anuncia-lo duas vezes.
        */}
        <section className="grid gap-2 rounded-xl border border-slate-200 p-4">
          <Switch
            label={NOME_DA_CATEGORIA.necessarios}
            hint={TEXTO_DA_CATEGORIA.necessarios}
            checked
            disabled
            onChange={() => undefined}
          />
          <ul className="mt-1 grid gap-1 text-xs text-slate-600">
            {necessarios.map((cookie) => (
              <li key={cookie.nome}>
                <span className="font-mono text-[11px] text-slate-700">{cookie.nome}</span> — {cookie.finalidade}{' '}
                <span className="text-slate-500">({cookie.duracao})</span>
              </li>
            ))}
          </ul>
        </section>

        {opcionaisEmUso.map((categoria: CategoriaOpcional) => {
          const daCategoria = ferramentas.filter((ferramenta) => ferramenta.categoria === categoria);
          return (
            <section key={categoria} className="grid gap-2 rounded-xl border border-slate-200 p-4">
              <Switch
                label={NOME_DA_CATEGORIA[categoria]}
                hint={TEXTO_DA_CATEGORIA[categoria]}
                checked={rascunho[categoria]}
                onChange={(ligado) => setRascunho((atual) => ({ ...atual, [categoria]: ligado }))}
              />
              {daCategoria.length > 0 ? (
                <ul className="mt-1 grid gap-1 text-xs text-slate-600">
                  {daCategoria.map((ferramenta) => (
                    <li key={ferramenta.chave}>
                      <span className="font-medium text-slate-700">{ferramenta.nome}</span>
                      {ferramenta.fornecedor ? ` (${ferramenta.fornecedor})` : ''} — {ferramenta.finalidade}
                      {ferramenta.cookies.length > 0 ? (
                        <span className="text-slate-500"> · {ferramenta.cookies.join(', ')}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}

        {semEscolha ? (
          <p className="text-sm text-slate-600">
            Hoje o painel não carrega nenhuma ferramenta opcional: não há medição de audiência, pixel nem
            cookie de terceiro aqui dentro. Se isso mudar, esta tela passa a listar a categoria e a
            ferramenta, e nada carrega antes de você decidir.
          </p>
        ) : null}

        {decisao ? (
          <p className="text-xs text-slate-500">
            Sua escolha foi registrada em {new Date(decisao.data).toLocaleString('pt-BR')} (versão{' '}
            {decisao.versao} da política).
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
