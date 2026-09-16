/// <reference types="astro/client" />

// Extensión de tipos para variables de entorno del proyecto
interface ImportMetaEnv {
  readonly HIVE_CREATOR_ACCOUNT: string
  readonly HIVE_DELEGATOR_ACCOUNT: string
  readonly HIVE_CREATOR_ACTIVE_KEY: string
  readonly HIVE_DELEGATOR_POSTING_KEY: string
  readonly HIVE_TX_MODE: string
  readonly SESSION_SECRET: string // For HMAC-SHA256 cookie signing
  readonly BEEKEEPER_WALLET_PASSWORD: string
  readonly AUTH_SECRET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Declaraciones de módulos para importaciones de efectos secundarios (side-effect imports)
declare module '@fontsource-variable/sora' {
  // Esta es una importación de efectos secundarios (CSS/fuentes)
  // No exporta nada, solo carga los estilos
}
