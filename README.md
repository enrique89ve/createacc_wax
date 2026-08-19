## HolaHive

Aplicacion web segura para la creacion de cuentas gratuitas en la blockchain Hive. Construida con Astro 7.2 y TailwindCSS v4, enfocada en privacidad y seguridad — las llaves privadas de Hive nunca son leidas ni almacenadas por el servidor, toda la generacion de llaves ocurre en el navegador del usuario.

### Stack

- **Framework**: Astro 7.2 con TypeScript (strict mode)
- **Styling**: TailwindCSS v4 via Vite plugin
- **Database**: SQLite con @libsql/client (local o Turso Cloud)
- **Auth**: bcryptjs (admin) + Hive Keychain (builders) + Better Auth (libsql)
- **Blockchain**: @hiveio/wax 2.0.2 + @hiveio/beekeeper 1.28.7-rc0
- **Adapter**: @astrojs/node (standalone)
- **Package Manager**: pnpm

---

## Setup

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env.local
```

El mismo `.env.local` funciona para desarrollo y produccion. Variables requeridas:

```bash
# Hive blockchain
HIVE_CREATOR_ACCOUNT=your-creator-account
HIVE_DELEGATOR_ACCOUNT=your-delegator-account
HIVE_CREATOR_ACTIVE_KEY=5JNHfZY.....
HIVE_DELEGATOR_POSTING_KEY=5JNHfZY.....

# Seguridad
AUTH_SECRET=your-random-secret-min-32-chars
SESSION_SECRET=generate-with-openssl-rand-base64-64
BEEKEEPER_WALLET_PASSWORD=your-secure-wallet-password

# Entorno
MAINNET=false   # false = testnet, TRUE = mainnet con failover
```

#### Variables opcionales (Database)

Por defecto usa SQLite local (`file:holahive.db`). Para Turso Cloud:

```bash
DATABASE_URL=libsql://your-database-org.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOi...
```

Para embedded replica (local + cloud sync):

```bash
DATABASE_URL=file:replica.db
TURSO_AUTH_TOKEN=eyJhbGciOi...
TURSO_SYNC_URL=libsql://your-database-org.turso.io
```

### 3. Inicializar base de datos y crear admin

```bash
# Inicializar schema (tablas, triggers, indices)
pnpm db:init

# Crear cuenta admin (interactivo)
pnpm admin:create

# O automatizado (CI/CD, Docker)
ADMIN_USERNAME=admin ADMIN_PASSWORD=SecurePass123! pnpm admin:create
```

La base de datos solo permite **1 admin** (enforced por trigger SQL). El password se hashea con bcrypt (10 rounds) y se almacena en la tabla `Users`.

### 4. Iniciar desarrollo

```bash
pnpm dev    # Ejecuta db:init automaticamente + astro dev
```

---

## Comandos

### Desarrollo

| Comando | Descripcion |
|---------|-------------|
| `pnpm dev` | Servidor de desarrollo (auto-ejecuta db:init) |
| `pnpm build` | Build de produccion |
| `pnpm preview` | Preview del build de produccion |

### Base de datos

| Comando | Descripcion |
|---------|-------------|
| `pnpm db:init` | Inicializar schema (tablas, triggers, indices) |
| `pnpm db:reset` | Eliminar DB y recrear schema |
| `pnpm db:seed` | Poblar DB con datos de prueba |
| `pnpm db:quickstart` | Reset + seed en un solo paso |

### Admin

| Comando | Descripcion |
|---------|-------------|
| `pnpm admin:create` | Crear cuenta admin (interactivo o via env vars) |
| `pnpm admin:reset` | Cambiar password del admin existente |
| `pnpm admin:check` | Ver estado actual del admin |
| `pnpm admin:setup` | Mostrar ayuda de admin management |

---

## Flujo de autenticacion

### Admin (password)

```
pnpm admin:create
    -> bcrypt.hash(password, 10)
    -> INSERT INTO Users (role='admin')
    -> Trigger: prevent_multiple_admins (max 1 admin)
    -> Trigger: enforce_admin_password_constraint (admin DEBE tener password)

Login: POST /api/auth/management-login
    -> Rate limit check
    -> bcrypt.compare(password, hash)
    -> JWT firmado con AUTH_SECRET
    -> Cookie: authjs.session-token
```

### Builder (Hive Keychain)

```
GET /api/auth/challenge
    -> Genera nonce criptografico (TTL: 2 min, uso unico)

Login via Keychain:
    -> Firma mensaje con nonce del servidor
    -> Server: consumeNonce() (one-time use)
    -> Server: WAX verifica firma criptografica
    -> Server: Verifica publicKey en posting authorities
    -> JWT firmado con AUTH_SECRET
    -> Cookie: authjs.session-token
```

---

## Estructura del proyecto

```
src/
  components/    Componentes Astro UI
  consts/        Constantes centralizadas (SEO, validation, config)
  data/          Datos estaticos (suspicious accounts)
  layouts/       Layouts reutilizables (Base, Layout, Builders, Management)
  lib/           Servicios core (blockchain, database, auth, sessions)
  pages/         Paginas y API routes
  sections/      Secciones de paginas
  styles/        Estilos globales
  types/         Definiciones TypeScript
  utils/         Utilidades y helpers
scripts/         Scripts de inicializacion y admin
```

### Layouts

| Layout | Uso | SEO |
|--------|-----|-----|
| `Base.astro` | Fundacion HTML + meta tags | Configurable |
| `Layout.astro` | Paginas publicas con navbar | Indexable |
| `BuildersLayout.astro` | Area `/builders/*` con auth | noindex |
| `ManagementLayout.astro` | Area `/management/*` con RBAC | noindex + enhanced security |

---

## Seguridad

- Llaves privadas nunca se envian ni almacenan en el servidor
- Generacion de llaves 100% client-side (Web Crypto API)
- bcrypt con salt para passwords de admin
- HMAC-SHA256 para cookies de sesion de creacion
- Sesiones Better Auth (cookie + tablas `user`/`session` en libsql) firmadas con AUTH_SECRET
- Nonces criptograficos de uso unico para Keychain auth
- Rate limiting por IP/fingerprint + username
- Validacion dual (client + server) para usernames
- RBAC: admin y builder con permisos diferenciados
- Triggers SQL: max 1 admin, roles inmutables, integridad de password
- CSP headers configurados en middleware

---

## Rebranding (para forks)

Toda la identidad de marca esta centralizada en `src/consts/branding.ts`. Para hacer un rebrand completo:

### 1. Editar `src/consts/branding.ts`

```ts
export const BRAND = {
  NAME: 'TuMarca',
  TAGLINE: 'Tu descripcion...',
  URL: 'https://tu-dominio.com',
  LOGO_ALT: 'TuMarca',
  APP_ID: 'TuMarca/1.0.0',        // ⚠️ inmutable una vez en blockchain
  CLAIM_APP_ID: 'tuMarcaCreateAcc', // ⚠️ inmutable una vez en blockchain
} as const
```

### 2. Reemplazar assets visuales

- `public/favicon.svg` - Favicon del sitio
- `public/og.jpg` - Imagen de preview para redes sociales
- Logos en `src/assets/` (si existen)

### 3. Colores (opcional)

Editar el bloque `@theme {}` en `src/styles/global.css` para cambiar la paleta de colores.

### Importante

- `APP_ID` y `CLAIM_APP_ID` se escriben en la blockchain de Hive. Cambiarlos despues de haber creado cuentas o reclamado creditos rompe la verificacion de operaciones anteriores.
- `BEEKEEPER_CONFIG.SESSION_SALT` en `src/consts/constants.ts` invalida sesiones existentes si se cambia.
