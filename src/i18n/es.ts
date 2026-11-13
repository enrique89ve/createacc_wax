import { BRAND } from '@/consts/branding'
import { privateEs } from './private-copy'

export const es = {
  localeSwitch: {
    label: 'Idioma',
  },
  common: {
    cancel: 'Cancelar',
    download: 'Descargar',
    error: 'Error',
    success: 'Éxito',
    loading: 'Cargando...',
    close: 'Cerrar',
  },
  invite: {
    title: 'Crea tu cuenta en Hive',
    introduction: 'Obtén un enlace personal para crear tu cuenta gratis.',
    signInGithub: 'Continuar con GitHub',
    signInTwitter: 'Continuar con X',
    personal:
      'Una invitación por cuenta social. Vuelve a iniciar sesión para retomar tu proceso.',
    preparing: 'Preparando tu enlace...',
    ready: 'Tu acceso está listo',
    welcomeDeveloper: '¡Bienvenido, Dev',
    welcomeCreator: '¡Bienvenido',
    welcomeEnd: '!',
    developerDescription: 'Estás a un paso de empezar a construir en Hive.',
    creatorDescription:
      'Tu camino como creador de contenido en Web3 está a punto de comenzar en Hive.',
    codeLabel: 'Código de acceso',
    copyCode: 'Copiar',
    codeCopied: 'Código copiado',
    oneUse: 'Se usa una sola vez.',
    linkLabel: 'Tu enlace de creación',
    copy: 'Copiar enlace',
    copied: 'Enlace copiado',
    copyError: 'No se pudo copiar. Vuelve a intentarlo.',
    continue: 'Seguir con la creación',
    processing: 'Estamos comprobando tu cuenta',
    processingDescription:
      'Tu creación sigue en curso. Conservamos tu invitación mientras comprobamos el resultado.',
    completed: 'Tu cuenta ya está creada',
    completedDescription: 'Esta invitación ya fue utilizada para crear',
    simulatedCompleted: 'Completaste el ensayo',
    simulatedCompletedDescription:
      'Esta invitación ya se usó para el usuario de prueba',
    unavailable: 'Las invitaciones no están disponibles en este momento.',
    quota:
      'Se agotaron las invitaciones de esta campaña. Si ya tienes una, puedes retomarla al iniciar sesión.',
    paused:
      'La campaña está pausada. Vuelve más tarde para solicitar tu enlace.',
    error: 'No se pudo completar la solicitud. Inténtalo de nuevo.',
    retry: 'Volver a intentar',
    refresh: 'Comprobar estado',
    connecting: 'Conectando...',
    signOut: 'Cerrar sesión',
    loginAgain: 'Vuelve a iniciar sesión para continuar.',
  },
  home: {
    title: 'Crea tu cuenta en Hive',
    metaDescription: 'Crea tu cuenta en Hive.',
    usernameLabel: 'Nombre de usuario',
    accessCodeLabel: 'Código de acceso',
    accessCodeVerify: 'Verificar',
    accessCodeVerified: 'Código verificado',
    accessCodeRemove: 'Quitar código de acceso',
    continue: 'Continuar',
    verifying: 'Verificando...',
    continueError: 'No se pudo continuar. Inténtalo de nuevo.',
    continueErrorButton: 'Error — Inténtalo de nuevo',
    flowErrors: {
      pow: 'No se pudo verificar la solicitud. Inténtalo de nuevo.',
      timing: 'La verificación de tiempo no se completó. Inténtalo de nuevo.',
      rateLimited:
        'Demasiados intentos. Vuelve a probar en {seconds} segundos.',
      usernameRequired: 'Escribe un nombre de usuario para continuar.',
      serviceUnavailable:
        'No se pudo iniciar la sesión por un problema temporal. Inténtalo de nuevo.',
    },
  },
  stepper: {
    ariaLabel: 'Progreso de creación de cuenta',
    account: 'Cuenta',
    security: 'Seguridad',
    ready: 'Listo',
  },
  username: {
    available: '@{username} está disponible',
    taken: '@{username} ya está en uso',
    notAllowed: 'Este nombre de usuario no está permitido',
    tooSimilar: 'Este nombre de usuario es muy similar a una cuenta reciente',
    chainError: 'No se pudo conectar con Hive',
    checkUnavailable: 'No se pudo comprobar el nombre. Inténtalo de nuevo.',
    checkRateLimited:
      'Demasiados intentos. Vuelve a probar en {seconds} segundos.',
    format: {
      empty: 'Escribe un nombre de usuario.',
      tooShort: 'Usa al menos 3 caracteres.',
      tooLong: 'Usa como máximo 16 caracteres.',
      startLowercase: 'Debe empezar con una letra minúscula.',
      onlyAllowed: 'Solo puedes usar letras minúsculas, números o guiones.',
      endLowerOrDigit: 'Debe terminar con una letra o un número.',
      segmentStartLowercase:
        'Cada segmento debe empezar con una letra minúscula.',
      segmentOnlyAllowed:
        'Cada segmento solo puede usar letras minúsculas, números o guiones.',
      segmentEndLowerOrDigit:
        'Cada segmento debe terminar con una letra o un número.',
      segmentTooShort: 'Cada segmento debe tener al menos 3 caracteres.',
    },
  },
  accessCode: {
    validating: 'Validando...',
    invalid: 'Código de acceso inválido',
    verifyError: 'No se pudo validar el código. Inténtalo de nuevo.',
    format: {
      empty: 'Escribe tu código de acceso.',
      tooShort: 'El código de acceso es demasiado corto.',
      tooLong: 'El código de acceso es demasiado largo.',
      invalidChars: 'El código de acceso solo puede contener letras y números.',
      onlyNumbers: 'El código de acceso no puede ser solo números.',
      invalidFormat: 'El código de acceso no es válido.',
    },
    validationErrors: {
      invalidCode: 'El código de acceso no es válido.',
      notFound: 'El código de acceso no existe.',
      invalidRecord: 'El código de acceso no es válido.',
      temporarilyUnavailable:
        'El código de acceso no está disponible temporalmente.',
      inactive: 'El código de acceso está inactivo.',
      noUses: 'El código de acceso no tiene usos disponibles.',
      internalError: 'No se pudo validar el código de acceso.',
    },
  },
  details: {
    title: 'Detalles de la cuenta',
    metaDescription: 'Revisa los detalles y guarda las claves de tu cuenta.',
    accountToCreate: 'Cuenta a crear:',
    masterPasswordLabel: 'Contraseña maestra',
    generatingKeys: 'Generando claves seguras…',
    masterPasswordHidden: 'Contraseña maestra oculta.',
    masterPasswordHelp:
      'Tu contraseña maestra da acceso a tu cuenta. Guárdala en un lugar seguro.',
    masterPasswordPrivacy:
      'Se genera en tu dispositivo y HolaHive no la almacena.',
    showMasterPassword: 'Mostrar contraseña maestra',
    hideMasterPassword: 'Ocultar contraseña maestra',
    copy: 'Copiar',
    copied: 'Copiado',
    copyMasterPassword: 'Copiar contraseña maestra',
    masterPasswordCopied: 'Contraseña maestra copiada.',
    masterPasswordCopyFailed:
      'No se pudo copiar. Revélala y selecciónala para copiarla manualmente.',
    downloadBackup: 'Descargar respaldo',
    downloadKeysAria: 'Descargar las claves de la cuenta',
    backupDownloaded: 'Respaldo descargado',
    downloadStarted: 'Descarga iniciada',
    confirmation:
      'He guardado mi contraseña maestra y entiendo que HolaHive no puede recuperarla por mí.',
    keysSafetyCheckbox:
      'He guardado mis claves. Sin ellas, perderé el acceso a mi cuenta.',
    createAccount: 'Crear cuenta',
    creatingAccount: 'Creando cuenta...',
    downloadKeysRequired: 'Descarga las claves primero.',
    generateKeysError:
      'No se pudieron generar las claves en este navegador. Comprueba que sea compatible e inténtalo de nuevo.',
    retryKeyGeneration: 'Reintentar generación de claves',
    reloadNewKeys:
      'Se generaron unas claves nuevas. Debes descargar nuevamente.',
    keysDownloadedBoth:
      'Se iniciaron las descargas TXT y PDF. Confirma que guardaste las claves.',
    fileDownloadFailed: 'No se pudo iniciar la descarga del archivo de claves.',
    keyConfirmationRequired:
      'Espera la confirmación del servidor o reinténtala desde el menú de descarga.',
    keyConfirmationFailed:
      'El archivo se generó, pero no se registró la confirmación. Reinténtala desde aquí; no hace falta volver a descargar.',
    keyConfirmationSucceeded: 'La confirmación de las claves se registró.',
    retryKeyConfirmation: 'Reintentar confirmación',
    retryingKeyConfirmation: 'Confirmando...',
    verificationError:
      'No se pudo preparar la verificación; la solicitud no fue enviada. Inténtalo de nuevo.',
    creationRateLimited:
      'Demasiadas solicitudes. Inténtalo en {seconds} segundos.',
    creationOutcomeUnknown:
      'Se interrumpió la conexión y no recibimos el resultado. Hive podría haber procesado la solicitud. Conserva esta página y tus claves; vuelve a intentar desde aquí para comprobar el mismo intento.',
    creationPending:
      'Hive aún no confirma el resultado final. Conserva esta página y tus claves; puedes volver a intentar este mismo proceso más tarde. Referencia: {correlationId}.',
    creationErrors: {
      creationContextChanged:
        'El contexto de creación ya no coincide con este intento. Conserva tus claves y vuelve al inicio. Una cuenta simulada no se puede reutilizar como una cuenta real.',
      accountAlreadyExists:
        'Ese nombre ya existe en Hive. Comprueba el nombre de usuario antes de continuar.',
      ticketNotFound: 'El ticket no existe en la base de datos.',
      ticketInUse:
        'El ticket está siendo usado por otra solicitud. Inténtalo más tarde.',
      ticketUsed: 'El ticket ya no tiene usos disponibles.',
      creationInProgress:
        'Ya hay una solicitud para esta cuenta en curso. Espera un momento y vuelve a intentarlo.',
      usernameNotAllowed: 'Este nombre de usuario no está permitido.',
      usernameTooSimilar:
        'El nombre es demasiado parecido a una cuenta creada recientemente.',
      keysNotConfirmed:
        'No se confirmó la descarga de las claves. Reintenta la confirmación.',
      serviceUnavailable:
        'No se pudo completar una comprobación del servicio. Inténtalo más tarde.',
      generic:
        'No se pudo completar la creación. Revisa el nombre de usuario y el ticket.',
    },
    createPrefix: 'Crear',
    advancedKeys: 'Ver claves avanzadas',
  },
  progress: {
    modalTitle: 'Creando tu cuenta',
    modalSubtitle: 'Por favor espera mientras procesamos tu solicitud',
    stepVerifying: 'Verificando información',
    stepCreating: 'Creando la cuenta',
    stepRedirecting: 'Redirigiendo',
    statusActive: 'En progreso...',
    statusCompleted: 'Completado',
    statusError: 'Error',
    creatingPrefix: 'Creando',
    preparing: 'Preparando tu cuenta',
    creatingOnHive: 'Creando en Hive',
    confirming: 'Confirmando',
    created: 'Cuenta creada',
    ariaLabel: 'Progreso de creación de cuenta',
  },
  success: {
    title: 'Tu cuenta está lista',
    metaDescription: 'Tu cuenta en Hive está lista.',
    welcomeTitle: '¡Bienvenido a Hive!',
    accountCreatedLead: 'Felicidades, la cuenta',
    accountCreatedTail: 'ha sido creada exitosamente.',
    body: 'Ya puedes usar tu cuenta en Hive.',
    readySubtitle: 'Tu cuenta está lista para acceder a Hive.',
    activeBody: 'ya está activo en Hive.',
    keychainCta: 'Descargar Keychain',
    postCta: '+ Publicar',
    keychainTitle: 'Configura Hive Keychain',
    keychainDownloadTitle: 'Descargar Hive Keychain',
    keychainDownloadBody: 'Gestiona tus claves y firma transacciones',
    keychainBody:
      'Usa tu usuario y el Master Password que acabas de guardar para agregar tu cuenta.',
    keychainInstall: 'Instalar Hive Keychain',
    keychainBadgeExtension: 'Extensión',
    keychainBadgeGooglePlay: 'Google Play',
    keychainBadgeAppStore: 'App Store',
    exploreTitle: 'Aplicaciones del ecosistema',
    exploreBody:
      'Explora y comienza a interactuar con la comunidad usando estas DApps.',
    favoriteBadge: 'Favorita',
    appIconAlt: 'Icono',
    communityTitle: '¿Necesitas ayuda? ¡Únete a la comunidad!',
    communityBody:
      'Ingresa a nuestro grupo de Telegram para recibir apoyo, compartir ideas y aprender más sobre Hive.',
    communityCta: 'Unirse al Grupo',
    simulated: {
      title: 'Ensayo completado',
      metaDescription:
        'Completaste el flujo de creación. No se creó una cuenta Hive.',
      welcomeTitle: 'Ensayo completado',
      accountCreatedLead: 'Completaste el flujo con el usuario',
      accountCreatedTail: '. No se creó una cuenta en Hive.',
      readySubtitle:
        'Si descargaste claves, consérvalas. No sirven en la red hasta un lanzamiento real.',
    },
    apps: {
      peakd: 'Plataforma social avanzada',
      hiveblog: 'Portal social clásico',
      threespeak: 'Video descentralizado',
      ecency: 'Social + mobile',
      inleo: 'Microblogging & finance',
      liketu: 'Fotos y lifestyle',
    },
  },
  keys: {
    header: 'CLAVES DE CUENTA HIVE - {USERNAME}',
    footer: `Generado con ${BRAND.NAME} - ${BRAND.URL}`,
    keepSafe: '⚠️  GUARDA ESTAS CLAVES SEGURAS - NUNCA LAS COMPARTAS ⚠️',
    masterKey: 'CLAVE MASTER',
    ownerKey: 'CLAVE PRIVADA OWNER',
    activeKey: 'CLAVE PRIVADA ACTIVE',
    postingKey: 'CLAVE PRIVADA POSTING',
    memoKey: 'CLAVE PRIVADA MEMO',
    generatedAtLabel: 'Generado:',
    keysetIdLabel: 'ID del lote:',
    pdfTitle: 'Tu usuario: {username}',
    // Hive role ids and Keychain's "Master Password" stay in English.
    pdfMasterPasswordLabel: 'Master Password',
    pdfRolesHeading: 'Roles',
    pdfRoleKeyTitle: 'Clave {role}:',
    pdfWindowTitle: 'Claves de {username}',
    roleNames: {
      owner: 'OWNER',
      active: 'ACTIVE',
      posting: 'POSTING',
      memo: 'MEMO',
      master: 'MASTER',
    },
    descriptions: {
      posting:
        'Publica, comenta, vota y autoriza acciones sociales en las aplicaciones. No transfiere HIVE ni HBD por sí sola. Una aplicación puede aceptar esta firma para operaciones que ella define, así que no la compartas.',
      active:
        'Mueve HIVE, HBD y Hive Power: transferencias, intercambios, power up y power down. Quien la tiene puede disponer de los fondos de la cuenta.',
      owner:
        'Cambia las demás claves y puede recuperar la cuenta. También puede hacer lo que hace la clave active. Guárdala fuera de línea.',
      memo: 'Cifra y descifra los memos de las transferencias y otros mensajes cifrados de la cuenta. Quien la tiene puede leer esos memos. No mueve fondos por sí sola.',
      master:
        'De esta contraseña se derivan el resto de las claves. Quien la tiene controla la cuenta por completo. Guárdala fuera de línea y no la reutilices.',
    },
  },
  downloadModal: {
    title: 'Seleccionar formato de descarga',
    subtitle: 'Elige cómo quieres guardar tus claves',
    formats: {
      txt: {
        title: 'Archivo de texto (.txt)',
        description: 'Formato simple y universal',
      },
      pdf: {
        title: 'Documento PDF (.pdf)',
        description: 'Formato profesional con descripciones',
      },
    },
  },
  messages: {
    keysDownloaded: 'Claves descargadas en formato {format}',
    downloadError: 'Error al descargar las claves',
    pdfGenerationFailed: 'Error al generar el PDF.',
    unsupportedFormat: 'Formato no soportado: {format}',
  },
  ...privateEs,
}
