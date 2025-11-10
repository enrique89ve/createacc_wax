/**
 * Lista optimizada de cuentas sospechosas para HolaHive
 * Organizada por categorías para mejor mantenimiento
 */

// Cuentas administrativas y de sistema
const ADMIN_ACCOUNTS = [
	"admin", "root", "support", "help", "moderator", "mod", "owner",
	"system", "bot", "service", "daemon", "null", "undefined"
] as const

// Cuentas de test y temporales
const TEST_ACCOUNTS = [
	"test", "demo", "guest", "user", "anonymous", "temp", "temporary",
	"deleted", "removed", "banned", "example", "sample"
] as const

// Términos relacionados con fraude/spam
const FRAUD_TERMS = [
	"spam", "scam", "fake", "phishing", "fraud", "hack", "hacker", 
	"cheat", "abuse", "malware", "virus", "exploit"
] as const

// Plataformas blockchain específicas (solo las más confusas)
const BLOCKCHAIN_PLATFORMS = [
	"hive", "hiveblog", "steemit", "steem", "bitcoin", "btc", "ethereum", 
	"eth", "binance", "coinbase", "crypto", "nft"
] as const

// Términos ofensivos comunes (básicos)
const OFFENSIVE_TERMS = [
	"nazi", "hitler", "isis", "terrorist", "kill", "murder", "suicide",
	"rape", "pedophile", "drug", "cocaine", "heroin"
] as const

// Combinar todas las listas
export const SUSPICIOUS_ACCOUNTS = [
	...ADMIN_ACCOUNTS,
	...TEST_ACCOUNTS, 
	...FRAUD_TERMS,
	...BLOCKCHAIN_PLATFORMS,
	...OFFENSIVE_TERMS
] as const

// Patrones regex para detección rápida
export const SUSPICIOUS_PATTERNS = [
	/^(admin|root|mod|support)\d*$/i,          // admin123, root1, etc.
	/^(test|demo|guest)\d*$/i,                 // test123, demo1, etc. (menos restrictivo)
	/^(bot|spam|fake|scam)\d*$/i,              // bot123, spam1, etc.
	/^(hive|steem|bitcoin|crypto)\d*$/i,       // hive123, bitcoin1, etc.
	/^\d+$/,                                   // Solo números
	/^[a-z]{1,2}$/,                           // Una o dos letras
	/(.)\1{4,}/,                              // Caracteres repetidos 5+ veces (aaaaa)
	/^(.)(.)\1\2\1\2/,                        // Patrones repetitivos (ababab)
] as const

// Longitudes sospechosas
export const SUSPICIOUS_LENGTHS = {
	MIN_SUSPICIOUS: 16,  // Nombres muy largos son sospechosos
	MAX_PATTERN: 3       // Patrones muy cortos son sospechosos
} as const

export type SuspiciousAccount = (typeof SUSPICIOUS_ACCOUNTS)[number]