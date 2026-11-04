import { aviso, lista, p, sub, tabela, type Documento } from './types.js';

/**
 * Politica de Privacidade do CODECA Build.
 *
 * Cada afirmacao foi conferida no codigo (ver `docs/legal.md`). O que o codigo
 * nao confirma -- prazos numericos de retencao, regioes dos provedores, CNPJ,
 * endereco, canal de contato -- NAO aparece aqui como fato. Sempre que a
 * plataforma passar a fazer algo diferente, o texto e a `LEGAL_VERSION` mudam
 * juntos.
 *
 * Rascunho tecnico: o conteudo deve ser revisado por assessoria juridica.
 */
export const PRIVACIDADE: Documento = {
  titulo: 'Política de privacidade',
  resumo:
    'Como o CODECA Build trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, a LGPD).',
  secoes: [
    {
      id: 'quem-somos',
      titulo: '1. Quem somos e a quem esta política se aplica',
      blocos: [
        p(
          'O CODECA Build é uma plataforma de gestão de conteúdo para sites empresariais, desenvolvida e operada pela CODECA IA. Por ela, empresas clientes acessam um painel para gerenciar textos, imagens e demais conteúdos dos seus sites, conforme o plano contratado.',
        ),
        p('Esta política se aplica a duas situações:'),
        lista(
          'Usuários da plataforma: pessoas que criam uma conta ou acessam o painel de uma empresa cliente.',
          'Visitantes dos sites das empresas clientes: pessoas que preenchem formulários ou interagem com funcionalidades de um site administrado pelo CODECA Build.',
        ),
        sub('Nosso papel em cada tratamento'),
        p('A LGPD distingue quem decide sobre os dados (controlador) de quem os trata em nome de outro (operador). No CODECA Build:'),
        lista(
          'A CODECA IA é controladora dos dados de conta, autenticação, segurança, suporte e cobrança dos usuários e das empresas clientes, tratados para prestar o serviço contratado.',
          'A empresa cliente é controladora dos dados dos visitantes dos seus sites (por exemplo, as mensagens enviadas pelos formulários) e do conteúdo que ela cadastra. Nesses casos, a CODECA IA atua como operadora, tratando os dados para disponibilizar a plataforma, conforme as instruções da empresa cliente.',
        ),
        p(
          'Se você é visitante de um site e quer exercer direitos sobre os dados que enviou, dirija-se primeiro à empresa responsável por aquele site. Também podemos auxiliar, pelo contato da seção 12.',
        ),
      ],
    },
    {
      id: 'dados',
      titulo: '2. Dados que tratamos',
      blocos: [
        p('Tratamos apenas dados ligados às funcionalidades que existem hoje na plataforma:'),
        sub('2.1 Conta e identificação'),
        lista(
          'Nome, endereço de e-mail e telefone, informados no cadastro.',
          'Senha: guardada apenas como um código irreversível (hash), nunca em texto legível.',
          'Situação da conta: e-mail confirmado ou não, data do último acesso, bloqueios temporários por tentativas incorretas e papel do usuário na empresa (proprietário, administrador, editor ou somente leitura).',
          'Registro do aceite dos Termos de uso e desta política: data e versão do texto aceito.',
        ),
        sub('2.2 Login com Google'),
        p(
          'Se você usa a conta Google para entrar: o identificador único da sua conta Google, seu nome e seu endereço de e-mail, com a indicação de que o Google o verificou. Detalhes na seção 4.',
        ),
        sub('2.3 Código de verificação por e-mail'),
        p(
          'Quando a verificação por código está ativa, enviamos um código ao seu e-mail a cada acesso. Guardamos apenas um código irreversível derivado dele, o número de tentativas e a validade, nunca o código em si.',
        ),
        sub('2.4 Dados técnicos e de segurança'),
        lista(
          'Endereço IP: não é guardado em texto legível. Armazenamos apenas um código irreversível (hash) dele, usado para limitar abusos e investigar acessos indevidos.',
          'Navegador e dispositivo (user agent), e datas e horários de sessões e de ações realizadas.',
          'Registros de auditoria de ações relevantes (quem fez, o quê e quando), como criação de empresa, alteração de acessos, publicação de conteúdo e conexão de integrações. Esses registros não guardam senhas nem tokens.',
          'Registros técnicos de funcionamento do servidor (por exemplo, erros e tempo de resposta). Eles não incluem o conteúdo das suas requisições, senhas, cookies nem tokens.',
        ),
        sub('2.5 Dados da empresa cliente'),
        p(
          'Nome e razão social, CNPJ ou CPF (quando informado), descrição, contatos (e-mail, telefone, WhatsApp), endereço, horários de atendimento, redes sociais, plano e situação da assinatura.',
        ),
        sub('2.6 Conteúdo dos sites'),
        p(
          'Textos, imagens, documentos e demais conteúdos que a empresa cadastra no painel, além dos domínios vinculados ao site. Arquivos enviados ficam em serviço de armazenamento de arquivos (seção 7).',
        ),
        sub('2.7 Dados de visitantes dos sites'),
        p(
          'Quando o site de uma empresa cliente oferece formulário de contato ou de interesse, os dados enviados são entregues ao painel da empresa: nome, telefone, e-mail (quando solicitado), mensagem, tipo de interesse, página de origem, o momento do consentimento para contato, o navegador e um código irreversível (hash) do IP. Esses dados pertencem à empresa responsável pelo site (seção 1).',
        ),
        sub('2.8 Cobrança e assinatura'),
        lista(
          'Plano contratado, situação da assinatura e histórico de cobranças (valor, situação, forma de pagamento, datas e motivo de falha, quando houver).',
          'Para processar o pagamento, enviamos ao provedor de pagamentos (ValidaPay) o nome da empresa, e-mail, telefone e documento (CNPJ ou CPF), quando informados.',
          'Não armazenamos dados de cartão de crédito: o pagamento é concluído na página do provedor de pagamentos.',
        ),
        sub('2.9 Google Analytics'),
        p('Se você optar por conectar o Google Analytics, aplica-se o que está descrito na seção 5.'),
        sub('2.10 Cookies e armazenamento local'),
        p('As páginas da plataforma usam apenas armazenamento necessário ao funcionamento. Não usamos cookies de publicidade nem ferramentas de análise de terceiros nelas.'),
        tabela(
          ['Item', 'Para que serve', 'Duração'],
          ['codeca_session (cookie)', 'Mantém você conectado. Não acessível por scripts.', 'Até o fim da sessão (12 horas ou 30 dias com "manter conectado")'],
          ['codeca_csrf (cookie)', 'Proteção contra requisições forjadas.', 'Igual à sessão'],
          ['Cookies temporários de conexão', 'Confirmam que o retorno do login com Google ou da conexão com o Google Analytics foi iniciado por você, no seu navegador.', '10 minutos'],
          ['Empresa selecionada (armazenamento local do navegador)', 'Lembra qual empresa você estava administrando.', 'Até você sair ou limpar o navegador'],
        ),
        aviso(
          'Os sites das empresas clientes são independentes desta plataforma. Eventuais cookies, ferramentas de análise ou formulários presentes nesses sites são de responsabilidade da empresa titular de cada site.',
        ),
      ],
    },
    {
      id: 'finalidades',
      titulo: '3. Para que usamos os dados',
      blocos: [
        tabela(
          ['Finalidade', 'Base legal predominante (LGPD)'],
          ['Criar e administrar contas e empresas', 'Execução de contrato (art. 7º, V)'],
          ['Autenticar usuários e controlar permissões', 'Execução de contrato; legítimo interesse em segurança (art. 7º, V e IX)'],
          ['Disponibilizar os serviços contratados, o painel e os módulos do plano', 'Execução de contrato (art. 7º, V)'],
          ['Processar assinaturas, cobranças e reconciliação financeira', 'Execução de contrato; cumprimento de obrigação legal ou regulatória (art. 7º, II e V)'],
          ['Prevenir fraudes, abusos e acessos indevidos; manter registros de auditoria', 'Legítimo interesse; exercício regular de direitos (art. 7º, IX e VI)'],
          ['Prestar suporte e comunicar sobre a conta (confirmação de e-mail, redefinição de senha, avisos de cobrança)', 'Execução de contrato; legítimo interesse'],
          ['Melhorar a plataforma e corrigir falhas, a partir de registros técnicos de funcionamento', 'Legítimo interesse'],
          ['Conectar o Google Analytics e exibir estatísticas do site', 'Consentimento, dado por você ao autorizar a conexão (art. 7º, I)'],
          ['Cumprir obrigações legais e atender solicitações de autoridades', 'Obrigação legal ou regulatória (art. 7º, II)'],
        ),
        p('Não vendemos dados pessoais e não os usamos para publicidade.'),
      ],
    },
    {
      id: 'google-login',
      titulo: '4. Login com Google',
      blocos: [
        p('Você pode, se quiser, entrar no CODECA Build com a sua conta Google. É uma opção: o cadastro e o acesso também funcionam com e-mail e senha.'),
        lista(
          'O que pedimos ao Google: apenas a identificação básica da conta (permissões "openid", e-mail e perfil). Usamos o identificador único da conta, o nome e o e-mail para reconhecer você e criar ou acessar a sua conta.',
          'O que não fazemos: a autenticação não dá à CODECA IA acesso irrestrito à sua conta Google. Não acessamos seus e-mails, arquivos, contatos, agenda nem qualquer outro dado do Google, e não recebemos a sua senha do Google.',
          'Tokens: no login com Google, não guardamos tokens de acesso do Google. Guardamos o identificador da conta vinculada.',
          'Vincular a uma conta existente: quem já tem conta com senha só pode vincular o Google depois de confirmar a senha. Desvincular também exige a senha e é feito em Configurações da empresa.',
          'Verificação adicional: quando ativa, o acesso por Google também pede o código enviado ao e-mail da conta.',
        ),
        p(
          'Você pode revogar a qualquer momento as permissões concedidas ao CODECA Build nas configurações de segurança da sua conta Google (myaccount.google.com/permissions).',
        ),
      ],
    },
    {
      id: 'google-analytics',
      titulo: '5. Integração com o Google Analytics 4',
      blocos: [
        p('O CODECA Build oferece, como recurso opcional, a exibição das estatísticas do site de uma empresa a partir do Google Analytics 4 (GA4).'),
        lista(
          'É opcional. Nada é solicitado ao Google até que um proprietário ou administrador da empresa clique em "Conectar Google Analytics". Quem não conecta continua usando a plataforma normalmente.',
          'Disponibilidade. A integração depende de habilitação pela CODECA IA na plataforma e pode não estar disponível em todas as instalações ou para todas as empresas.',
          'Quem autoriza. A empresa escolhe a conta Google e, depois, a propriedade GA4 que deseja vincular ao seu site. A integração fica restrita a essa propriedade.',
          'Permissão solicitada. Somente leitura: https://www.googleapis.com/auth/analytics.readonly.',
          'O que consultamos. Métricas e relatórios agregados de desempenho da propriedade escolhida (usuários, sessões, visualizações de página, engajamento, duração das sessões, páginas mais vistas, origem do tráfego e dispositivos) e a lista de contas e propriedades acessíveis, para você escolher qual vincular.',
          'O que não fazemos. Não alteramos, não administramos e não excluímos nada na sua propriedade ou conta do Google Analytics, e não temos permissão para isso.',
          'O que guardamos. O token de renovação da autorização, protegido com criptografia antes de ser armazenado; a identificação da propriedade e da conta escolhidas; e quem conectou e quando. Os relatórios não são armazenados de forma permanente: ficam apenas por alguns minutos em memória, para agilizar a consulta.',
          'Quem vê. As estatísticas são exibidas aos usuários da própria empresa, conforme o papel de cada um. Somente proprietários e administradores conectam, trocam a propriedade ou desconectam.',
        ),
        sub('Como desconectar e revogar o acesso'),
        lista(
          'Na plataforma: em Estatísticas do site, use "Desconectar". O acesso é revogado no Google e a conexão guardada é apagada.',
          'No Google: você também pode revogar o acesso a qualquer momento em myaccount.google.com/permissions. Nesse caso, a plataforma passa a indicar que é preciso reconectar.',
        ),
        sub('Uso das informações recebidas do Google'),
        p(
          'O uso e a transferência, pelo CODECA Build, das informações recebidas das APIs do Google seguem a Política de Dados do Usuário dos Serviços de API do Google, inclusive os requisitos de Uso Limitado. Usamos esses dados somente para exibir as estatísticas ao próprio cliente, e não os vendemos, não os usamos para publicidade e não os transferimos a terceiros, exceto quando necessário para prestar o serviço, cumprir a lei ou com a sua autorização.',
        ),
        aviso(
          'A plataforma não instala o Google Analytics no site da empresa. Se o site usa o GA4, a empresa titular do site é responsável por informar os seus visitantes e, quando necessário, obter o consentimento para cookies e coleta de dados.',
        ),
      ],
    },
    {
      id: 'seguranca',
      titulo: '6. Armazenamento e segurança',
      blocos: [
        p('Adotamos medidas técnicas e organizacionais compatíveis com o serviço. As principais, hoje, são:'),
        lista(
          'Isolamento entre clientes: os dados de cada empresa são separados no banco de dados, e cada consulta é restrita à empresa do usuário. Quem não pertence a uma empresa não consegue sequer saber se ela existe.',
          'Controle de permissões: cada usuário tem um papel (proprietário, administrador, editor ou somente leitura), e o servidor confere a permissão em cada operação.',
          'Proteção de credenciais: senhas guardadas com algoritmo de hash próprio para senhas e salt individual; tokens de sessão e de uso único guardados apenas em forma irreversível; cookies de sessão inacessíveis a scripts e enviados apenas por conexão segura.',
          'Criptografia de tokens de integração: o token de renovação do Google Analytics é cifrado (AES-256-GCM) antes de ir ao banco de dados, vinculado à empresa e ao site a que pertence. O token de acesso não é gravado.',
          'Prevenção de acessos indevidos: limite de tentativas de login e de outras operações sensíveis, bloqueio temporário após senhas incorretas, confirmação de e-mail para operações sensíveis, proteção contra requisições forjadas (CSRF) e cabeçalhos de segurança.',
          'Acesso de suporte: a equipe da CODECA IA só acessa o conteúdo de uma empresa mediante concessão de suporte temporária, somente leitura e registrada em auditoria.',
          'Monitoramento: registros de auditoria das ações relevantes e registros técnicos de erros e de desempenho.',
        ),
        p(
          'Nenhum sistema é totalmente imune a falhas. Se houver um incidente de segurança que possa acarretar risco ou dano relevante aos titulares, comunicaremos a Autoridade Nacional de Proteção de Dados (ANPD) e os titulares afetados, nos termos da LGPD.',
        ),
      ],
    },
    {
      id: 'compartilhamento',
      titulo: '7. Com quem compartilhamos dados',
      blocos: [
        p('Compartilhamos dados somente na medida necessária para o funcionamento do serviço, com os provedores abaixo:'),
        tabela(
          ['Provedor', 'Para quê', 'Dados envolvidos'],
          ['Vercel', 'Hospedagem e execução da plataforma, armazenamento de arquivos (Vercel Blob) e gerenciamento de domínios', 'Todo dado processado pela plataforma; arquivos enviados; domínios'],
          ['Neon (PostgreSQL)', 'Banco de dados', 'Dados de conta, empresas, conteúdo, interessados, cobranças e auditoria'],
          ['Google', 'Login com Google e, se você conectar, Google Analytics', 'Identificação da conta Google; métricas da propriedade GA4 escolhida (seções 4 e 5)'],
          ['ValidaPay', 'Processamento de pagamentos e assinaturas', 'Nome da empresa, e-mail, telefone, documento (quando informado), plano e dados da cobrança'],
          ['Resend', 'Envio de e-mails da plataforma, quando o envio está habilitado (confirmação de e-mail, código de acesso, redefinição de senha, convites)', 'Endereço de e-mail do destinatário e o conteúdo da mensagem'],
        ),
        p('Além disso:'),
        lista(
          'Dentro da empresa: outros usuários da mesma empresa veem os dados conforme o papel de cada um.',
          'Autoridades: poderemos compartilhar dados quando houver obrigação legal ou ordem de autoridade competente.',
          'Não vendemos nem cedemos dados pessoais a terceiros para fins de marketing.',
        ),
        p(
          'Alguns desses provedores são empresas internacionais e podem tratar dados fora do Brasil. Quando isso ocorrer, a transferência observará as hipóteses e garantias previstas na LGPD (arts. 33 e seguintes).',
        ),
      ],
    },
    {
      id: 'direitos',
      titulo: '8. Seus direitos',
      blocos: [
        p('Como titular, você pode solicitar à CODECA IA, a qualquer momento e mediante requisição:'),
        lista(
          'a confirmação de que tratamos seus dados;',
          'o acesso aos dados;',
          'a correção de dados incompletos, inexatos ou desatualizados;',
          'a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD;',
          'a portabilidade dos dados, nos termos da regulamentação;',
          'a eliminação dos dados tratados com base no seu consentimento, ressalvadas as hipóteses legais de conservação;',
          'informação sobre as entidades com as quais compartilhamos dados;',
          'informação sobre a possibilidade de não fornecer consentimento e sobre as consequências da recusa;',
          'a revogação do consentimento, por procedimento gratuito e facilitado, como desconectar o Google Analytics ou desvincular o Google.',
        ),
        p(
          'Para exercer seus direitos, use o contato da seção 12. Podemos pedir informações para confirmar a sua identidade antes de atender, e responderemos nos prazos da LGPD. Quando a CODECA IA atuar como operadora (visitantes de sites), poderemos encaminhar a solicitação à empresa controladora. Você também pode apresentar petição à ANPD.',
        ),
        p(
          'Parte dos dados pode ser corrigida ou excluída diretamente no painel pelos usuários com permissão (por exemplo, dados da empresa, arquivos de mídia e interessados). Pedidos que dependam da CODECA IA são atendidos pelo canal de contato.',
        ),
      ],
    },
    {
      id: 'retencao',
      titulo: '9. Por quanto tempo guardamos os dados e como podem ser excluídos',
      blocos: [
        p('Mantemos os dados enquanto a conta estiver ativa e pelo tempo necessário às finalidades desta política, observadas as exceções abaixo.'),
        lista(
          'Dados temporários de segurança são apagados automaticamente: sessões vencidas ou encerradas, 30 dias depois; códigos de verificação, 1 dia depois de vencerem; tokens de uso único (confirmação de e-mail, redefinição de senha, convites), 30 dias depois de vencerem; contadores de limite de tentativas, quando expiram.',
          'Conexão com o Google Analytics: o token e os dados da conexão são apagados quando você desconecta, e também quando a empresa é excluída.',
          'Arquivos e interessados: podem ser excluídos no painel por quem tem permissão. A exclusão de arquivos também os remove do armazenamento.',
          'Registros de auditoria e de cobrança podem ser mantidos pelo tempo necessário para segurança, prevenção a fraudes, exercício regular de direitos e cumprimento de obrigações legais e fiscais, mesmo depois do encerramento da conta (LGPD, art. 16).',
          'Cópias de segurança e histórico mantidos pelos provedores de infraestrutura podem conservar dados por um período limitado depois da exclusão.',
        ),
        p(
          'Para solicitar a exclusão da conta ou da empresa, use o contato da seção 12. Atenderemos o pedido, ressalvadas as hipóteses de conservação previstas em lei.',
        ),
      ],
    },
    {
      id: 'menores',
      titulo: '10. Crianças e adolescentes',
      blocos: [
        p('O CODECA Build é destinado a empresas e profissionais e não é direcionado a menores de 18 anos. Não coletamos intencionalmente dados de crianças e adolescentes.'),
      ],
    },
    {
      id: 'alteracoes',
      titulo: '11. Alterações desta política',
      blocos: [
        p(
          'Podemos atualizar esta política. A versão em vigor é identificada pela data no topo desta página. Quando a mudança for relevante, daremos destaque a ela e, se necessário, solicitaremos novo aceite.',
        ),
      ],
    },
    {
      id: 'contato',
      titulo: '12. Contato',
      blocos: [
        p('Para dúvidas sobre esta política ou para exercer seus direitos como titular:'),
        { tipo: 'contato' },
      ],
    },
  ],
};
