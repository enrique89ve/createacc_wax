# HolaHive

Free Hive accounts. Keys never leave the browser.

Built with Astro 7, Better Auth, and `@hiveio/wax`. Private keys are generated client-side. The server never reads or stores them.

---

## Roadmap

Five phases. Ship, learn, finish.

| | Phase | What we do | Done when |
|---|---|---|---|
| **1** | **Build** | Stand up the core. Create accounts. Keep keys local. Auth that holds. | The product works end to end. |
| **2** | **Friction** | Watch real users stall. Kill the dead ends. Rebuild the idea around acquisition. | New users finish without a guide. |
| **3** | **Prove** | Lock v1. Test with the Hive community. | Community can create accounts without us in the loop. |
| **4** | **Attract** | Turn the site into a growth surface, not a form. | The page itself pulls people in. |
| **5** | **Ship** | A finished product. Trusted, reliable, ready to scale. | We would hand this to a stranger. |

We are in **phase 1**.

---

## Stack

Astro 7.2 · TypeScript · Tailwind v4 · libsql · Better Auth · Hive Keychain · wax 2.0.2 · Beekeeper · Node standalone · pnpm

---

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Required in `.env.local` (dev and prod):

```bash
HIVE_CREATOR_ACCOUNT=
HIVE_DELEGATOR_ACCOUNT=
HIVE_CREATOR_ACTIVE_KEY=
HIVE_DELEGATOR_POSTING_KEY=

AUTH_SECRET=           # ≥ 32 chars
SESSION_SECRET=        # openssl rand -base64 64
BEEKEEPER_WALLET_PASSWORD=

HIVE_TX_MODE=simulate   # or broadcast for live mainnet transmission
```

Optional Turso:

```bash
DATABASE_URL=libsql://your-database-org.turso.io
TURSO_AUTH_TOKEN=
```

Default DB is local SQLite (`file:holahive.db`). One database for simulate and live. Tickets have no execution mode — only Accounts records how a creation ran.

```bash
pnpm db:init
pnpm admin:create      # or ADMIN_USERNAME=… ADMIN_PASSWORD=… pnpm admin:create
pnpm dev               # runs db:init, then astro dev
```

One admin only. Enforced in SQL. Password is bcrypt (10 rounds).

---

## Commands

| Command | |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Preview production build |
| `pnpm db:init` | Schema |
| `pnpm db:reset` | Drop DB, recreate schema |
| `pnpm db:seed` | Test data (`SEED_ADMIN_PASSWORD` required) |
| `pnpm db:quickstart` | Reset + seed |
| `pnpm admin:create` | Create admin |
| `pnpm admin:reset` | Rotate admin password |
| `pnpm admin:check` | Admin status |

## Validaciones internas

No hay GitHub Actions. Las comprobaciones se corren en local:

| Command | |
|---|---|
| `pnpm test` | Unit tests (`HIVE_TX_MODE=simulate`) |
| `pnpm check` | Types + lint |
| `pnpm wax:self-test` | WAX/mainnet diagnostics without broadcast |
| `pnpm test:simulation` | Integration simulation against the local DB |

---

## Auth

**Admin** — password. `POST /api/auth/management-login` → bcrypt → Better Auth session cookie.

**Builder** — Hive Keychain. `GET /api/auth/challenge` issues a one-time nonce (2 min). Client signs. Server verifies with wax, binds the session to the user. Mutations never trust a raw user id from the client.

---

## Layout

```
src/
  components/    UI
  consts/        Brand, SEO, config
  layouts/       Base, public, builders, management
  lib/           Chain, db, auth, sessions
  pages/         Pages + API
scripts/         DB + admin
```

| Layout | |
|---|---|
| `Base.astro` | HTML + meta |
| `Layout.astro` | Public, indexable |
| `BuildersLayout.astro` | `/builders/*`, noindex |
| `ManagementLayout.astro` | `/management/*`, noindex |

---

## Security

- Keys generated in the browser. Never sent. Never stored.
- Admin passwords: bcrypt.
- Creation cookies: HMAC-SHA256.
- Sessions: Better Auth (`user` / `session` in libsql), `AUTH_SECRET`.
- Keychain: one-time nonces.
- Rate limits on IP, fingerprint, username.
- Validate on client and server.
- RBAC: admin vs builder.
- SQL triggers: one admin, immutable roles.
- CSP in middleware.

---

## Fork / rebrand

Identity lives in `src/consts/branding.ts`.

```ts
export const BRAND = {
  NAME: 'YourBrand',
  TAGLINE: '…',
  URL: 'https://your-domain.com',
  LOGO_ALT: 'YourBrand',
  APP_ID: 'YourBrand/1.0.0',        // frozen once on-chain
  CLAIM_APP_ID: 'yourBrandCreateAcc', // frozen once on-chain
} as const
```

Replace `public/favicon.svg`, `public/og.jpg`, logos in `src/assets/`. Colors: `@theme` in `src/styles/global.css`.

Do not change `APP_ID` or `CLAIM_APP_ID` after accounts or claims have gone on-chain. Changing `BEEKEEPER_CONFIG.SESSION_SALT` kills existing wallet sessions.
