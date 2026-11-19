import { Link } from "react-router-dom";
import { Check, PartyPopper, X } from "lucide-react";
import { Button, Card, CardBody, cx } from "@codeca/ui";
import type { TenantCapability } from "@codeca/shared";
import { progressoDosPassos } from "../lib/primeirosPassos.js";
import type { OverviewResponse } from "../types/index.js";

/**
 * Primeiros passos, no topo da visao geral.
 *
 * Nada aqui se marca a mao. Cada passo pergunta aos dados do site se ja foi
 * feito, e a lista se atualiza sozinha quando a pessoa volta da tela que
 * acabou de preencher. Dar baixa manualmente criaria duas verdades -- a lista
 * e o site -- e a lista seria a errada.
 *
 * O cartao nao bloqueia nada: e dispensavel a qualquer momento, e o menu de
 * ajuda o traz de volta.
 */
export function OnboardingChecklist({
  visao,
  pode,
  onDispensar,
}: {
  visao: OverviewResponse;
  pode: (c: TenantCapability) => boolean;
  onDispensar: () => void;
}) {
  const { passos, feitos, total, tudoFeito } = progressoDosPassos(visao, pode);

  // Sem nenhum passo ao alcance deste papel, o cartao nao tem o que dizer.
  if (total === 0) return null;

  const porcento = Math.round((feitos / total) * 100);

  return (
    /*
      O `data-tour` fica NUM ELEMENTO DE VERDADE, e nao no `Card`.
      `Card` nao repassa props soltas, e o TypeScript nao confere atributo JSX
      com hifen: `<Card data-tour=...>` compila e some na renderizacao. O tour
      apontaria para um alvo que nao existe, sem erro em lugar nenhum.
    */
    <div data-tour="primeiros-passos">
      <Card>
        <CardBody className="grid gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                {tudoFeito ? "Tudo pronto por aqui" : "Primeiros passos"}
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                {tudoFeito
                  ? "Você concluiu a configuração inicial do seu site."
                  : "Siga estes passos para colocar seu site no ar."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDispensar}
              icon={<X aria-hidden="true" className="size-4" />}
            >
              Dispensar
            </Button>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-slate-700">
                {feitos} de {total} concluídos
              </span>
              <span className="tabular-nums text-slate-600">{porcento}%</span>
            </div>
            {/*
            `progressbar`, e nao `meter`: um e o avanco de uma tarefa, o outro
            e uma medida dentro de uma faixa (o uso do plano, por exemplo).
            Para o leitor de tela a diferenca muda o que e anunciado.
          */}
            <div
              role="progressbar"
              aria-label="Progresso dos primeiros passos"
              aria-valuenow={feitos}
              aria-valuemin={0}
              aria-valuemax={total}
              className="h-2 overflow-hidden rounded-full bg-slate-200"
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-[var(--ease-out-soft)]"
                style={{ width: `${porcento}%` }}
              />
            </div>
          </div>

          {tudoFeito ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-inset ring-emerald-200">
              <PartyPopper
                aria-hidden="true"
                className="size-5 flex-none text-emerald-700"
              />
              <p className="min-w-0 flex-1 text-sm text-emerald-900">
                Seu site tem o essencial no lugar. Você pode ocultar esta lista
                — ela volta pelo menu de ajuda.
              </p>
              <Button variant="outline" size="sm" onClick={onDispensar}>
                Ocultar
              </Button>
            </div>
          ) : (
            <ul className="grid gap-2">
              {passos.map((passo) => (
                <li
                  key={passo.id}
                  className={cx(
                    "flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5",
                    passo.feito
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-white",
                  )}
                >
                  {/*
                  Feito e pendente nao se separam so pela cor: o circulo cheio
                  com visto, contra o contorno vazio, e a diferenca que se ve
                  sem distinguir verde de cinza.
                */}
                  <span
                    aria-hidden="true"
                    className={cx(
                      "grid size-6 flex-none place-items-center rounded-full",
                      passo.feito
                        ? "bg-emerald-600 text-white"
                        : "border-2 border-dashed border-slate-300 text-transparent",
                    )}
                  >
                    <Check className="size-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cx(
                        "text-sm font-medium",
                        passo.feito ? "text-emerald-900" : "text-slate-900",
                      )}
                    >
                      {passo.titulo}
                      <span className="sr-only">
                        {passo.feito ? " - concluído" : " - pendente"}
                      </span>
                    </p>
                    <p
                      className={cx(
                        "text-sm",
                        passo.feito ? "text-emerald-800" : "text-slate-600",
                      )}
                    >
                      {passo.descricao}
                    </p>
                  </div>

                  <Link
                    to={passo.para}
                    className={cx(
                      "rounded-lg px-3 py-1.5 text-sm font-medium",
                      "transition-colors duration-200",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                      passo.feito
                        ? "text-emerald-800 hover:bg-emerald-100"
                        : "bg-brand-600 text-white hover:bg-brand-700",
                    )}
                  >
                    {passo.feito ? "Revisar" : (passo.acao ?? "Ir para")}
                    <span className="sr-only"> {passo.titulo}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
