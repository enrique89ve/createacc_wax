import { BRAND } from '@/consts/branding'
import type { Messages } from './types'

export const pt: Messages = {
  localeSwitch: {
    label: 'Idioma',
  },
  common: {
    cancel: 'Cancelar',
    download: 'Baixar',
    error: 'Erro',
    success: 'Sucesso',
    loading: 'Carregando...',
    close: 'Fechar',
  },
  home: {
    title: 'Crie sua conta no Hive',
    metaDescription: 'Crie sua conta no Hive.',
    usernameLabel: 'Nome de usuário',
    accessCodeLabel: 'Código de acesso',
    accessCodeVerify: 'Verificar',
    accessCodeVerified: 'Formato válido',
    accessCodeRemove: 'Remover código de acesso',
    continue: 'Continuar',
    verifying: 'Verificando...',
    continueError: 'Não foi possível continuar. Tente novamente.',
    continueErrorButton: 'Erro — Tente novamente',
    flowErrors: {
      pow: 'Não foi possível verificar a solicitação. Tente novamente.',
      timing: 'A verificação de tempo não foi concluída. Tente novamente.',
      rateLimited: 'Muitas tentativas. Tente novamente em {seconds} segundos.',
      usernameRequired: 'Digite um nome de usuário para continuar.',
      serviceUnavailable:
        'Não foi possível iniciar a sessão devido a um problema temporário. Tente novamente.',
    },
  },
  stepper: {
    ariaLabel: 'Progresso de criação da conta',
    account: 'Conta',
    security: 'Segurança',
    ready: 'Pronto',
  },
  username: {
    available: '@{username} está disponível',
    taken: '@{username} já está em uso',
    notAllowed: 'Este nome de usuário não é permitido',
    tooSimilar: 'Este nome de usuário é muito parecido com uma conta recente',
    chainError: 'Não foi possível conectar ao Hive',
    checkUnavailable: 'Não foi possível verificar o nome. Tente novamente.',
    checkRateLimited:
      'Muitas tentativas. Tente novamente em {seconds} segundos.',
    format: {
      empty: 'Digite um nome de usuário.',
      tooShort: 'Use pelo menos 3 caracteres.',
      tooLong: 'Use no máximo 16 caracteres.',
      startLowercase: 'Deve começar com uma letra minúscula.',
      onlyAllowed: 'Use apenas letras minúsculas, números ou hífens.',
      endLowerOrDigit: 'Deve terminar com uma letra ou um número.',
      segmentStartLowercase:
        'Cada segmento deve começar com uma letra minúscula.',
      segmentOnlyAllowed:
        'Cada segmento só pode usar letras minúsculas, números ou hífens.',
      segmentEndLowerOrDigit:
        'Cada segmento deve terminar com uma letra ou um número.',
      segmentTooShort: 'Cada segmento deve ter pelo menos 3 caracteres.',
    },
  },
  accessCode: {
    validating: 'Validando...',
    invalid: 'Código de acesso inválido',
    verifyError: 'Não foi possível validar o código. Tente novamente.',
    format: {
      empty: 'Digite seu código de acesso.',
      tooShort: 'O código de acesso é muito curto.',
      tooLong: 'O código de acesso é muito longo.',
      invalidChars: 'O código de acesso só pode conter letras e números.',
      onlyNumbers: 'O código de acesso não pode ser só números.',
      invalidFormat: 'O código de acesso não é válido.',
    },
    validationErrors: {
      invalidCode: 'O código de acesso é inválido.',
      notFound: 'O código de acesso não foi encontrado.',
      invalidRecord: 'O código de acesso é inválido.',
      temporarilyUnavailable:
        'O código de acesso está temporariamente indisponível.',
      inactive: 'O código de acesso está inativo.',
      noUses: 'O código de acesso não tem usos disponíveis.',
      internalError: 'Não foi possível validar o código de acesso.',
    },
  },
  details: {
    title: 'Proteja sua conta',
    metaDescription: 'Proteja sua conta e guarde sua Master Password.',
    accountToCreate: 'Conta a criar:',
    masterPasswordLabel: 'Master Password',
    generatingKeys: 'Gerando chaves seguras...',
    masterPasswordHidden:
      'Sua Master Password está oculta. Pressione Mostrar para revelá-la.',
    clickToCopy: 'Clique para copiar Master Password',
    copy: 'Copiar',
    masterPasswordCopied: 'Master Password copiada',
    beforeContinueHelp:
      'Baixe ou copie sua Master Password antes de continuar.',
    masterPasswordHelp:
      'Sua Master Password controla sua conta. Guarde-a em um lugar seguro.',
    masterPasswordPrivacy:
      'Ela é gerada no seu dispositivo e a HolaHive não a armazena.',
    show: 'Mostrar',
    hide: 'Ocultar',
    showMasterPassword: 'Mostrar Master Password',
    hideMasterPassword: 'Ocultar Master Password',
    downloadBackup: 'Baixar backup',
    downloadKeys: 'Baixar chaves',
    downloadKeysAria: 'Baixar chaves',
    copyMasterPassword: 'Copiar Master Password',
    backupDownloaded: 'Backup baixado',
    downloadStarted: 'Download iniciado',
    confirmation:
      'Guardei minha Master Password e entendo que a HolaHive não pode recuperá-la por mim.',
    keysSavedCheckbox: 'Verifiquei que minhas chaves estão guardadas.',
    keysAckCheckbox: 'Reconheço que se perder minhas chaves, perco a conta.',
    createAccount: 'Criar conta',
    creatingAccount: 'Criando conta...',
    downloadKeysRequired: 'Você deve baixar as chaves primeiro!',
    generateKeysError:
      'Não foi possível gerar as chaves neste navegador. Verifique a compatibilidade e tente novamente.',
    retryKeyGeneration: 'Tentar gerar as chaves novamente',
    reloadNewKeys: 'Novas chaves foram geradas. Você deve baixá-las novamente.',
    keysDownloadedBoth:
      'Os downloads TXT e PDF foram iniciados. Confirme que guardou as chaves.',
    fileDownloadFailed:
      'Não foi possível iniciar o download do arquivo de chaves.',
    keyConfirmationRequired:
      'Aguardando confirmação do servidor. Tente novamente no menu de download.',
    keyConfirmationFailed:
      'O arquivo foi gerado, mas a confirmação não foi registrada. Tente novamente aqui; não é necessário baixar outra vez.',
    keyConfirmationSucceeded: 'A confirmação das chaves foi registrada.',
    retryKeyConfirmation: 'Tentar confirmar novamente',
    retryingKeyConfirmation: 'Confirmando...',
    verificationError:
      'Não foi possível preparar a verificação; a solicitação não foi enviada. Tente novamente.',
    submitDisabledTitle: 'Você deve baixar o arquivo de chaves primeiro',
    creationRateLimited:
      'Muitas solicitações. Tente novamente em {seconds} segundos.',
    creationOutcomeUnknown:
      'A conexão foi interrompida antes de recebermos o resultado. A Hive pode ter processado a solicitação. Mantenha esta página e suas chaves; tente novamente aqui para verificar a mesma tentativa.',
    creationPending:
      'A Hive ainda não confirmou o resultado final. Mantenha esta página e suas chaves; você pode tentar novamente mais tarde. Referência: {correlationId}.',
    creationErrors: {
      accountAlreadyExists:
        'Esse nome de usuário já existe na Hive. Confira o nome antes de continuar.',
      ticketNotFound: 'O ticket não existe no banco de dados.',
      ticketInUse:
        'Outra solicitação está usando este ticket. Tente mais tarde.',
      ticketUsed: 'O ticket não tem usos disponíveis.',
      creationInProgress:
        'Já existe uma solicitação para esta conta em andamento. Aguarde e tente novamente.',
      usernameNotAllowed: 'Este nome de usuário não é permitido.',
      usernameTooSimilar:
        'Este nome é muito parecido com uma conta criada recentemente.',
      keysNotConfirmed:
        'O download das chaves não foi confirmado. Tente confirmar novamente.',
      serviceUnavailable:
        'Não foi possível concluir uma verificação do serviço. Tente mais tarde.',
      generic:
        'Não foi possível concluir a criação. Confira o nome de usuário e o ticket.',
    },
    createPrefix: 'Criar',
    advancedKeys: 'Ver chaves avançadas',
  },
  progress: {
    modalTitle: 'Criando sua conta',
    modalSubtitle: 'Por favor, aguarde enquanto processamos sua solicitação',
    stepVerifying: 'Verificando informações',
    stepCreating: 'Criando a conta',
    stepRedirecting: 'Redirecionando',
    statusActive: 'Em progresso...',
    statusCompleted: 'Concluído',
    statusError: 'Erro',
    creatingPrefix: 'Criando',
    preparing: 'Preparando sua conta',
    creatingOnHive: 'Criando no Hive',
    confirming: 'Confirmando',
    created: 'Conta criada',
  },
  success: {
    title: 'Sua conta está pronta',
    metaDescription: 'Sua conta no Hive está pronta.',
    welcomeTitle: 'Bem-vindo ao Hive!',
    accountCreatedLead: 'Parabéns, a conta',
    accountCreatedTail: 'foi criada com sucesso.',
    body: 'Você já pode usar sua conta no Hive.',
    readySubtitle: 'Sua conta está pronta para acessar o Hive.',
    activeBody: 'já está ativo no Hive.',
    keychainCta: 'Baixar Keychain',
    keychainTitle: 'Configure o Hive Keychain',
    keychainDownloadTitle: 'Baixar Hive Keychain',
    keychainDownloadBody: 'Gerencie suas chaves e assine transações',
    keychainBody:
      'Use seu usuário e a Master Password que você acabou de guardar para adicionar sua conta.',
    keychainInstall: 'Instalar Hive Keychain',
    keychainBadgeExtension: 'Extensão',
    keychainBadgeGooglePlay: 'Google Play',
    keychainBadgeAppStore: 'App Store',
    exploreTitle: 'Aplicativos do ecossistema',
    exploreBody:
      'Explore e comece a interagir com a comunidade usando estas DApps.',
    favoriteBadge: 'Favorita',
    appIconAlt: 'Ícone',
    communityTitle: 'Precisa de ajuda? Junte-se à comunidade!',
    communityBody:
      'Entre no nosso grupo do Telegram para receber apoio, compartilhar ideias e aprender mais sobre o Hive.',
    communityCta: 'Entrar no grupo',
    apps: {
      peakd: 'Plataforma social avançada',
      hiveblog: 'Portal social clássico',
      threespeak: 'Vídeo descentralizado',
      ecency: 'Social + mobile',
      inleo: 'Microblogging & finance',
      liketu: 'Fotos e lifestyle',
    },
  },
  keys: {
    header: 'CHAVES DA CONTA HIVE - {USERNAME}',
    footer: `Gerado com ${BRAND.NAME} - ${BRAND.URL}`,
    keepSafe: '⚠️  MANTENHA ESSAS CHAVES SEGURAS - NUNCA AS COMPARTILHE ⚠️',
    masterKey: 'CHAVE MESTRE',
    ownerKey: 'CHAVE PRIVADA OWNER',
    activeKey: 'CHAVE PRIVADA ACTIVE',
    postingKey: 'CHAVE PRIVADA POSTING',
    memoKey: 'CHAVE PRIVADA MEMO',
    generatedAtLabel: 'Gerado:',
    keysetIdLabel: 'ID do lote:',
    pdfTitle: 'Seu usuário: {username}',
    pdfMasterPasswordLabel: 'Master Password',
    pdfRolesHeading: 'Funções',
    pdfRoleKeyTitle: '{role} Key:',
    pdfWindowTitle: 'Chaves de {username}',
    roleNames: {
      owner: 'OWNER',
      active: 'ACTIVE',
      posting: 'POSTING',
      memo: 'MEMO',
      master: 'MASTER',
    },
    descriptions: {
      posting:
        'Esta chave é usada para atividades sociais (postar, comentar e votar). Esta chave tem um conjunto limitado de permissões e não pode ser usada para ações monetárias. Portanto, você não pode perder dinheiro se outra pessoa acessar esta chave.',
      active:
        'Esta chave tem permissões adicionais para ações mais sensíveis relacionadas ao dinheiro, como transferir e trocar moedas.',
      owner:
        'A chave do proprietário é necessária para alterar as outras chaves. Esta chave tem permissões adicionais para recuperar sua conta ou alterar suas outras chaves.',
      memo: 'A única coisa que a chave Memo pode fazer é criptografar e descriptografar mensagens privadas enviadas através da blockchain.',
      master:
        'É a chave principal da qual todas as outras chaves de uma conta são derivadas, usada apenas em situações críticas para garantir máxima segurança.',
    },
  },
  downloadModal: {
    title: 'Selecionar formato de download',
    subtitle: 'Escolha como você quer salvar suas chaves',
    formats: {
      txt: {
        title: 'Arquivo de texto (.txt)',
        description: 'Formato simples e universal',
      },
      pdf: {
        title: 'Documento PDF (.pdf)',
        description: 'Formato profissional com descrições',
      },
    },
  },
  messages: {
    keysDownloaded: 'Chaves baixadas no formato {format}',
    downloadError: 'Erro ao baixar as chaves',
    pdfGenerationFailed: 'Erro ao gerar o PDF.',
    unsupportedFormat: 'Formato não suportado: {format}',
  },
}
