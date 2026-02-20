import { BRAND } from '@/consts/branding'

export type Locale = 'es' | 'en' | 'pt'

export interface Translations {
  readonly common: {
    readonly cancel: string
    readonly download: string
    readonly error: string
    readonly success: string
    readonly loading: string
    readonly close: string
  }
  readonly keys: {
    readonly header: string
    readonly footer: string
    readonly keepSafe: string
    readonly masterKey: string
    readonly ownerKey: string
    readonly activeKey: string
    readonly postingKey: string
    readonly memoKey: string
    readonly descriptions: {
      readonly posting: string
      readonly active: string
      readonly owner: string
      readonly memo: string
      readonly master: string
    }
  }
  readonly downloadModal: {
    readonly title: string
    readonly subtitle: string
    readonly formats: {
      readonly txt: {
        readonly title: string
        readonly description: string
      }
      readonly pdf: {
        readonly title: string
        readonly description: string
      }
    }
  }
  readonly messages: {
    readonly keysDownloaded: string
    readonly downloadError: string
    readonly pdfGenerationFailed: string
    readonly unsupportedFormat: string
  }
}

const es: Translations = {
  common: {
    cancel: 'Cancelar',
    download: 'Descargar',
    error: 'Error',
    success: 'Éxito',
    loading: 'Cargando...',
    close: 'Cerrar',
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
    descriptions: {
      posting:
        'Esta clave se utiliza para actividades sociales (publicar, comentar y votar). Esta clave tiene un conjunto limitado de permisos y no se puede utilizar para acciones monetarias. Por lo tanto, no puedes perder dinero si alguien más accede a esta clave.',
      active:
        'Esta clave tiene permisos adicionales para acciones relacionadas con el dinero más sensibles, como transferir e intercambiar monedas.',
      owner:
        'La clave del propietario es necesaria para cambiar las otras claves. Esta clave tiene permisos adicionales para recuperar tu cuenta o cambiar tus otras claves.',
      memo: 'Lo único que puede hacer la clave Memo es cifrar y descifrar mensajes privados que se envían a través de la cadena de bloques.',
      master:
        'Es la clave principal de la cual se derivan todas las otras claves de una cuenta, se utiliza solo en situaciones críticas para garantizar la máxima seguridad.',
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
}

const en: Translations = {
  common: {
    cancel: 'Cancel',
    download: 'Download',
    error: 'Error',
    success: 'Success',
    loading: 'Loading...',
    close: 'Close',
  },
  keys: {
    header: 'HIVE ACCOUNT KEYS - {USERNAME}',
    footer: `Generated with ${BRAND.NAME} - ${BRAND.URL}`,
    keepSafe: '⚠️  KEEP THESE KEYS SAFE - NEVER SHARE THEM ⚠️',
    masterKey: 'MASTER KEY',
    ownerKey: 'OWNER PRIVATE KEY',
    activeKey: 'ACTIVE PRIVATE KEY',
    postingKey: 'POSTING PRIVATE KEY',
    memoKey: 'MEMO PRIVATE KEY',
    descriptions: {
      posting:
        'This key is used for social activities (posting, commenting and voting). This key has a limited set of permissions and cannot be used for monetary actions. Therefore, you cannot lose money if someone else accesses this key.',
      active:
        'This key has additional permissions for more sensitive money-related actions, such as transferring and exchanging currencies.',
      owner:
        'The owner key is required to change the other keys. This key has additional permissions to recover your account or change your other keys.',
      memo: 'The only thing the Memo key can do is encrypt and decrypt private messages sent through the blockchain.',
      master:
        'It is the main key from which all other keys of an account are derived, used only in critical situations to ensure maximum security.',
    },
  },
  downloadModal: {
    title: 'Select download format',
    subtitle: 'Choose how you want to save your keys',
    formats: {
      txt: {
        title: 'Text file (.txt)',
        description: 'Simple and universal format',
      },
      pdf: {
        title: 'PDF document (.pdf)',
        description: 'Professional format with descriptions',
      },
    },
  },
  messages: {
    keysDownloaded: 'Keys downloaded in {format} format',
    downloadError: 'Error downloading keys',
    pdfGenerationFailed: 'Failed to generate PDF.',
    unsupportedFormat: 'Unsupported format: {format}',
  },
}

const pt: Translations = {
  common: {
    cancel: 'Cancelar',
    download: 'Baixar',
    error: 'Erro',
    success: 'Sucesso',
    loading: 'Carregando...',
    close: 'Fechar',
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

export const translations = {
  es,
  en,
  pt,
} as const

export class I18nManager {
  private static currentLocale: Locale = 'es'

  public static setLocale(locale: Locale): void {
    this.currentLocale = locale
  }

  public static getLocale(): Locale {
    return this.currentLocale
  }

  public static t(key: string, params?: Record<string, string>): string {
    const keys = key.split('.')
    let value: unknown =
      translations[this.currentLocale as keyof typeof translations]

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[k]
      } else {
        value = undefined
      }
    }

    if (typeof value !== 'string') {
      return key
    }

    // Replace parameters
    if (params) {
      return Object.entries(params).reduce(
        (text, [param, val]) => text.replace(`{${param}}`, val),
        value
      )
    }

    return value
  }

  public static getTranslations(): Translations {
    return translations[this.currentLocale as keyof typeof translations]
  }
}

// Convenience function to use in components
export const t = (key: string, params?: Record<string, string>): string =>
  I18nManager.t(key, params)
