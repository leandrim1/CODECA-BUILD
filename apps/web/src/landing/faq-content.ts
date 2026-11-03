import type { PublicPlan } from '../services/endpoints.js';
import { listar, nomeDoPlano, planosCom, planosComDominio, planosSemPainel } from './plans.js';

export interface Pergunta {
  pergunta: string;
  resposta: string;
}

/**
 * As respostas que citam plano saem dos planos que a API devolve.
 *
 * Sem os dados, caem numa forma geral ("conforme o plano contratado") em vez
 * de repetir nomes e numeros escritos a mao -- que ficariam errados no dia em
 * que um plano mudasse.
 */
export function montarPerguntas(planos: readonly PublicPlan[] | null): Pergunta[] {
  const p = planos ?? [];
  const comPainel = planosCom(p, 'cms_panel');
  const semPainel = planosSemPainel(p);
  const hospedagem = planosCom(p, 'included_hosting');
  const comDominio = planosComDominio(p);
  const maisUsuarios = p.length ? Math.max(...p.map((x) => x.limits.maxUsers)) : null;
  const avaliacao = p.find((x) => x.priceCents === 0 && x.trialDays);

  return [
    {
      pergunta: 'O que é o CODECA Build?',
      resposta:
        'É uma plataforma de gestão de conteúdo para sites empresariais personalizados. A CODECA IA desenvolve o site da sua empresa e o integra à plataforma. Pelo painel, sua equipe gerencia textos, imagens, banners, produtos, serviços, imóveis, projetos, equipes e outros conteúdos disponibilizados para o seu site, e as alterações chegam ao site pela API, sem novo deploy.',
    },
    {
      pergunta: 'Preciso ter um site desenvolvido pela CODECA IA?',
      resposta:
        'O CODECA Build foi concebido para os sites que a CODECA IA desenvolve e integra à plataforma: é essa integração que liga o painel ao conteúdo exibido no site. Se você já tem um site e quer saber se ele pode ser integrado, converse com a CODECA IA.',
    },
    {
      pergunta: 'Posso editar o conteúdo do meu site?',
      resposta: comPainel.length
        ? `Sim, nos planos que incluem o painel de conteúdo para o cliente: ${listar(comPainel)}.${
            semPainel.length
              ? ` ${semPainel.length > 1 ? `Nos planos ${listar(semPainel)}` : `No plano ${semPainel[0]}`}, o conteúdo é mantido pela CODECA IA.`
              : ''
          } Você edita o que foi disponibilizado para o seu projeto e o site passa a exibir a versão nova.`
        : 'Sim, nos planos que incluem o painel de conteúdo para o cliente. Você edita o que foi disponibilizado para o seu projeto e o site passa a exibir a versão nova.',
    },
    {
      pergunta: 'Preciso saber programar?',
      resposta:
        'Não. O painel funciona com formulários, listas e botões. Qualquer ajuste na estrutura do site, como novas seções, módulos ou campos, é feito pela CODECA IA.',
    },
    {
      pergunta: 'Posso utilizar meu próprio domínio?',
      resposta: comDominio.length
        ? `Sim. Os planos ${listar(comDominio.map(nomeDoPlano))} permitem conectar o domínio da empresa. Você cadastra o endereço no painel e, quando o plano inclui hospedagem, acompanha também as instruções de DNS e a verificação por lá. Nos demais, o painel registra o domínio e o apontamento é feito no provedor onde o site está hospedado.`
        : 'Sim, conforme o plano contratado. Você cadastra o endereço no painel e acompanha o que o plano permite: com hospedagem incluída, as instruções de DNS e a verificação aparecem por lá; sem ela, o painel registra o domínio e o apontamento é feito onde o site está hospedado.',
    },
    {
      pergunta: 'A hospedagem está incluída em todos os planos?',
      resposta: hospedagem.length
        ? `Não. A hospedagem está incluída no plano ${listar(hospedagem)}. Nos demais, ela não faz parte do plano contratado; converse com a CODECA IA sobre onde o seu site ficará hospedado.`
        : 'Não. A hospedagem é um recurso de plano e não está incluída em todos. Converse com a CODECA IA sobre onde o seu site ficará hospedado.',
    },
    {
      pergunta: 'Posso ter diferentes módulos no meu painel?',
      resposta:
        'Sim. Cada painel mostra os módulos do seu projeto: imóveis, produtos, serviços, obras, equipe, galerias e outros. A CODECA IA define quais ficam ativos e pode criar módulos e campos específicos para o seu negócio.',
    },
    {
      pergunta: 'O que são conteúdos cadastrados?',
      resposta:
        'São os registros dos módulos do seu site: produtos, serviços, imóveis, projetos, profissionais, equipe, cursos e turmas, cardápios, veículos, portfólio, galerias e os módulos personalizados do seu projeto. O limite do plano é geral, não por tipo: uma loja pode usar todas as vagas em produtos, uma clínica em serviços e profissionais, uma imobiliária em imóveis. Rascunhos e arquivados também contam, e o que você exclui libera a vaga na hora.',
    },
    {
      pergunta: 'Posso adicionar colaboradores?',
      resposta: `Sim, dentro do limite de usuários do plano${maisUsuarios ? ` (de 2 até ${maisUsuarios}, conforme o plano)` : ''}. Você convida cada pessoa por e-mail e define o papel: Administrador, Editor de conteúdo ou Somente leitura. As permissões são conferidas no servidor.`,
    },
    {
      pergunta: 'Como funciona a contratação?',
      resposta: `Você cria a conta da empresa e começa pelo plano de avaliação${avaliacao?.trialDays ? `, por ${avaliacao.trialDays} dias` : ''}, sem pagamento. Para contratar um plano pago, abra Plano e assinatura no painel, escolha o plano e a forma de pagamento disponível e conclua a contratação.`,
    },
    {
      pergunta: 'Posso trocar de plano?',
      resposta:
        'Sim. Em Plano e assinatura você escolhe outro plano, vê a simulação da troca antes de confirmar e, depois disso, os limites e recursos do novo plano passam a valer.',
    },
  ];
}

