import { aviso, lista, p, type Documento } from './types.js';

/**
 * Termos de Uso do CODECA Build.
 *
 * Mesmas regras da politica de privacidade: so o que o codigo confirma. Valores
 * de planos, prazos de reembolso, foro e condicoes comerciais especificas NAO
 * estao aqui, porque nao ha fonte confirmada para eles.
 *
 * Rascunho tecnico: o conteudo deve ser revisado por assessoria juridica.
 */
export const TERMOS: Documento = {
  titulo: 'Termos de uso',
  resumo: 'As condições para usar o CODECA Build, plataforma de gestão de conteúdo para sites empresariais.',
  secoes: [
    {
      id: 'aceite',
      titulo: '1. Aceitação',
      blocos: [
        p(
          'Estes Termos regem o uso do CODECA Build, plataforma desenvolvida e operada pela CODECA IA. Ao criar uma conta ou uma empresa e marcar que aceita os Termos e a Política de privacidade, você declara que os leu e concorda com eles. Registramos a data do aceite e a versão do texto aceito.',
        ),
        p(
          'Se você usa a plataforma em nome de uma empresa, declara ter poderes para vinculá-la a estes Termos. O serviço é destinado a empresas e profissionais, e o uso por menores de 18 anos não é permitido.',
        ),
      ],
    },
    {
      id: 'servico',
      titulo: '2. O serviço',
      blocos: [
        p(
          'O CODECA Build oferece um painel para a empresa cliente gerenciar informações, imagens, textos e outros conteúdos do seu site, além de módulos e funcionalidades que variam conforme o plano contratado e o tipo de site. O conteúdo é entregue ao site por meio de uma API de integração, com credenciais próprias de cada site.',
        ),
        lista(
          'O site em si é desenvolvido e publicado conforme o que a empresa contratou separadamente com a CODECA IA. A plataforma não é o site: ela fornece o painel e a entrega do conteúdo.',
          'Os recursos disponíveis (módulos, limites de usuários, conteúdos, domínios e armazenamento, hospedagem, exportações) dependem do plano e podem mudar ao longo do tempo.',
          'Funcionalidades que dependem de serviços externos, como a integração com o Google Analytics, podem não estar disponíveis para todas as empresas e dependem de habilitação na plataforma.',
        ),
      ],
    },
    {
      id: 'conta',
      titulo: '3. Conta, acesso e papéis',
      blocos: [
        lista(
          'Você deve fornecer informações verdadeiras e mantê-las atualizadas.',
          'O acesso é por e-mail e senha ou, opcionalmente, pela conta Google, e pode exigir um código de verificação enviado ao e-mail. Alguns recursos exigem e-mail confirmado.',
          'Você é responsável por guardar as suas credenciais e por tudo o que for feito com elas. Não as compartilhe. Avise-nos imediatamente se suspeitar de uso indevido.',
          'Após várias tentativas de acesso incorretas, a conta pode ser bloqueada temporariamente, por segurança.',
          'Cada empresa tem usuários com papéis (proprietário, administrador, editor e somente leitura), com permissões diferentes. O proprietário e os administradores respondem por conceder e remover acessos de acordo com a necessidade da empresa.',
        ),
      ],
    },
    {
      id: 'planos',
      titulo: '4. Planos, avaliação e pagamento',
      blocos: [
        lista(
          'Planos e valores: os planos, seus recursos, limites e valores vigentes são os exibidos na página de planos e no momento da contratação.',
          'Avaliação: ao cadastrar uma empresa, é concedido um período de avaliação de 14 dias, com os recursos e limites do plano de avaliação.',
          'Pagamento: é processado pela ValidaPay, provedor de pagamentos, pelas formas exibidas na contratação. O cartão é informado na página do provedor e não passa pelos nossos servidores. Pix e boleto, quando disponíveis, exigem pagamento a cada ciclo, sem débito automático.',
          'Troca de plano e cancelamento: podem ser feitos pelo painel por quem tem permissão. O cancelamento pode ser agendado para o fim do período ou imediato, e seus efeitos financeiros, inclusive a cobrança proporcional em trocas de plano, seguem o período já pago e as regras do provedor de pagamentos.',
          'Falta de pagamento: após o vencimento há um período de tolerância (por padrão, 5 dias, que a CODECA IA pode ajustar por empresa). Passado esse prazo, o acesso pode ser restringido: o painel pode passar a modo somente leitura e a entrega de conteúdo ao site pode ser limitada ou suspensa até a regularização.',
          'Estorno, contestação de pagamento ou suspeita de fraude também podem levar à suspensão do serviço enquanto o caso é analisado.',
        ),
      ],
    },
    {
      id: 'conteudo',
      titulo: '5. Conteúdo e dados dos visitantes',
      blocos: [
        p('A empresa cliente é a responsável por tudo o que cadastra e publica por meio da plataforma. Isso inclui:'),
        lista(
          'a veracidade das informações divulgadas e o cumprimento das normas que se aplicam ao seu setor e à sua publicidade;',
          'ter os direitos e as licenças necessários sobre textos, imagens, marcas e demais materiais que envia;',
          'os dados pessoais de visitantes coletados pelo site, em relação aos quais a empresa é controladora (ver Política de privacidade): informar os visitantes, ter base legal para a coleta e atender os pedidos dos titulares;',
          'cookies, ferramentas de análise e demais tecnologias do seu site, inclusive o Google Analytics, que a plataforma não instala nem configura no site.',
        ),
        p('Você nos concede a licença limitada e necessária para armazenar, processar e entregar o seu conteúdo ao seu site e para operar a plataforma. O conteúdo continua sendo seu.'),
      ],
    },
    {
      id: 'uso-aceitavel',
      titulo: '6. Uso aceitável',
      blocos: [
        p('É proibido usar a plataforma para:'),
        lista(
          'violar a lei ou direitos de terceiros, incluindo propriedade intelectual e privacidade;',
          'publicar conteúdo ilícito, fraudulento, enganoso, ofensivo ou que viole direitos;',
          'acessar, ou tentar acessar, dados de outras empresas, contas ou sistemas sem autorização, ou contornar os mecanismos de isolamento, autenticação e permissão;',
          'burlar limites do plano, limites de requisição ou mecanismos de segurança, ou sobrecarregar a plataforma de forma abusiva;',
          'enviar spam ou mensagens não solicitadas por meio dos formulários e funcionalidades;',
          'introduzir códigos maliciosos ou realizar engenharia reversa da plataforma, salvo nos limites permitidos em lei.',
        ),
      ],
    },
    {
      id: 'integracoes',
      titulo: '7. Integrações e serviços de terceiros',
      blocos: [
        p(
          'A plataforma se integra a serviços de terceiros, como Google (login e Google Analytics), ValidaPay (pagamentos), Vercel e Neon (infraestrutura e dados) e Resend (e-mail). O uso desses serviços também se sujeita aos termos e políticas de cada um, e a CODECA IA não se responsabiliza por falhas ou mudanças que dependam deles.',
        ),
        lista(
          'A conexão com o Google Analytics é opcional, feita somente por quem tem permissão, concedida por você ao Google com permissão de leitura, e pode ser desconectada a qualquer momento. Os detalhes estão na Política de privacidade.',
          'As credenciais de integração do site (chaves de API) são de responsabilidade da empresa. A chave secreta deve ser mantida em sigilo e não deve ser exposta no navegador. Em caso de vazamento, a chave deve ser revogada e substituída.',
        ),
      ],
    },
    {
      id: 'propriedade',
      titulo: '8. Propriedade intelectual',
      blocos: [
        p(
          'A plataforma CODECA Build, sua marca, seu código, seu design e sua documentação pertencem à CODECA IA. O uso da plataforma não transfere ao cliente nenhum direito sobre eles, além do direito de uso conforme estes Termos. A titularidade de sites personalizados e de materiais desenvolvidos sob encomenda segue o que for acordado em contrato específico.',
        ),
      ],
    },
    {
      id: 'disponibilidade',
      titulo: '9. Disponibilidade e suporte',
      blocos: [
        p(
          'Trabalhamos para manter a plataforma disponível e segura, mas não garantimos funcionamento ininterrupto ou livre de erros. Podem ocorrer manutenções, atualizações, indisponibilidades de provedores e outras interrupções. Recomendamos manter cópia dos conteúdos e dados importantes da empresa, como a exportação de interessados, quando o plano a inclui.',
        ),
      ],
    },
    {
      id: 'responsabilidade',
      titulo: '10. Limitação de responsabilidade',
      blocos: [
        p('Na extensão permitida pela lei, a CODECA IA não responde por:'),
        lista(
          'conteúdo cadastrado pela empresa e uso que ela ou seus usuários façam da plataforma;',
          'indisponibilidade, falhas ou alterações em serviços de terceiros;',
          'acessos indevidos decorrentes de credenciais compartilhadas, vazadas ou mal guardadas pelo cliente;',
          'lucros cessantes, perda de oportunidades de negócio ou danos indiretos decorrentes de interrupções ou limitações do serviço.',
        ),
        p('Nada nestes Termos exclui responsabilidades que a lei não permita excluir.'),
      ],
    },
    {
      id: 'encerramento',
      titulo: '11. Suspensão e encerramento',
      blocos: [
        lista(
          'Você pode cancelar a assinatura e deixar de usar a plataforma quando quiser (seção 4).',
          'Podemos suspender ou encerrar o acesso em caso de violação destes Termos, falta de pagamento, risco à segurança da plataforma ou de terceiros, ou determinação legal.',
          'Depois do encerramento, os dados são tratados conforme a Política de privacidade, inclusive quanto à retenção e à exclusão.',
        ),
      ],
    },
    {
      id: 'privacidade',
      titulo: '12. Privacidade',
      blocos: [
        p('O tratamento de dados pessoais está descrito na Política de privacidade, que integra estes Termos.'),
      ],
    },
    {
      id: 'alteracoes',
      titulo: '13. Alterações dos Termos',
      blocos: [
        p(
          'Podemos atualizar estes Termos. A versão em vigor é identificada pela data no topo desta página. Quando a mudança for relevante, daremos destaque a ela e, se necessário, solicitaremos novo aceite. O uso continuado da plataforma após a mudança indica concordância com a nova versão.',
        ),
      ],
    },
    {
      id: 'lei',
      titulo: '14. Lei aplicável e contato',
      blocos: [
        p('Estes Termos são regidos pela legislação brasileira. Para dúvidas sobre eles:'),
        { tipo: 'contato' },
        aviso('Estes Termos e a Política de privacidade devem ser lidos em conjunto.'),
      ],
    },
  ],
};
