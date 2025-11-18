/// <reference types="astro/client" />

// Extensión de tipos para variables de entorno del proyecto
interface ImportMetaEnv {
	readonly HIVE_CREATOR_ACCOUNT: string
	readonly HIVE_DELEGATOR_ACCOUNT: string
	readonly HIVE_CREATOR_ACTIVE_KEY: string
	readonly HIVE_DELEGATOR_ACTIVE_KEY: string
	readonly MAINNET: string // "TRUE" | "FALSE" as string
	readonly SESSION_SECRET: string // For HMAC-SHA256 cookie signing
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}