# HolaHive

Free Hive accounts with browser-generated private keys.

Built with Astro 7, Better Auth, and `@hiveio/wax`. The account-creation flow
generates private keys client-side and sends public keys to the server.

---

## Roadmap

Five phases. Ship, learn, finish.

|       | Phase        | What we do                                                                                                   | Done when                                                                                                     |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **1** | **Build**    | Close the simulated-pilot gates, then run an invite-only pilot on a deployed instance. Keep user keys local. | People can complete the simulated flow and give useful feedback without believing a Hive account was created. |
| **2** | **Friction** | Watch real users stall. Kill the dead ends. Rebuild the idea around acquisition.                             | New users finish without a guide.                                                                             |
| **3** | **Prove**    | Lock v1. Test with the Hive community.                                                                       | Community can create accounts without us in the loop.                                                         |
| **4** | **Attract**  | Turn the site into a growth surface, not a form.                                                             | The page itself pulls people in.                                                                              |
| **5** | **Ship**     | A finished product. Trusted, reliable, ready to scale.                                                       | We would hand this to a stranger.                                                                             |

We are in **phase 1**. The next milestone is a **closed simulated pilot**; it is
not a public launch and does not create Hive accounts. The app is **not ready to
invite participants yet**: the success page currently says an account was
created even in simulation, and there is no remote pilot deployment. Complete
the simulated-pilot gates before inviting participants.

The simulated pilot is separate from a real Hive launch. Local tests and builds
do not validate a remote deployment, a participant pilot, backup restoration,
or real Hive broadcasts. The Docker configuration targets one persistent Node
process with SQLite and one replica. A remote database requires its own
deployment and consistency validation.

---

## Personal invitations

`/invite` lets a person sign in with GitHub or X and receive a personal link into
the existing account-creation flow. Each provider identity receives one ticket
with one use. Signing in again recovers that ticket, including an in-progress
or completed creation. The campaign has a total issuance cap; it does not reset
daily and recovering a ticket does not consume another place.

Configure these private runtime variables (see `.env.example`):

```dotenv
INVITE_IDENTITY_SECRET=  # 64 hex characters; generate once: openssl rand -hex 32
AUTH_SECRET=            # at least 32 characters; different from the identity secret
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
BETTER_AUTH_URL=https://join.holahive.com
AUTH_ORIGIN=https://join.holahive.com
```

Register the exact OAuth callbacks under that origin:

- `/api/invite/auth/callback/github`
- `/api/invite/auth/callback/twitter`

GitHub uses `read:user`; X uses `users.read` and `tweet.read`. The application
does not require the person's email or retain provider access tokens. Better
Auth handles OAuth state/PKCE and an encrypted invitation-session cookie, which
is separate from the administrator's authentication. Public invitation auth
routes do not expose profile updates, account linking or password registration.

With the base database initialized, run `pnpm invite:init` once against the
intended database. This explicitly adds the invitation tables and a ticket
invariant trigger without changing existing account or ticket data. Existing
deployments are not migrated by invitation HTTP requests. Keep the identity
secret in backups: changing it changes every identity fingerprint, and the
database rejects a mismatching key. Do not reset the ledger between campaigns.

After initialization, administrators can activate or pause the campaign and
set its total issuance cap at `/management/invites`. New campaigns start
paused with a cap of zero; previously issued invitations remain recoverable.

The ledger stores a provider-scoped HMAC fingerprint, a hash of the opaque link
token and the ticket reference. The encrypted session also carries the public
provider username for the welcome message. Opening the personal link and
consuming its ticket require the matching verified social session; sharing the
link or copying its code does not transfer access. Sessions expire after one
hour; sign in again at `/invite` to recover the same invitation. Existing creation
reservations, rollback and uncertain transaction reconciliation remain
authoritative; viewing a link never spends it.

The allowance is per social account. It does not establish that accounts from
different providers, or several accounts on one provider, belong to one person.

## Stack

Astro 7.2 · TypeScript · Tailwind v4 · libsql · Better Auth · Hive Keychain · wax 2.0.2 · Beekeeper · Node standalone · pnpm

---

## Setup

Use the patched Node.js 24 LTS release pinned in `.nvmrc` and `.node-version`.
The Dokploy Dockerfile pins the same runtime.

```bash
nvm install
nvm use
pnpm install
cp .env.example .env.local
```

The package manager is pinned in `package.json` (`pnpm@11.22.0`). Use
`pnpm install --frozen-lockfile` when reproducing the committed dependency set.

Required configuration (`.env.local` for development; inject environment variables
before starting the production process):

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

Local SQLite is the default and works without Turso credentials, network access,
or a sync process. Use a remote database only when the deployment explicitly
chooses it.

Optional Turso remote:

```bash
DATABASE_URL=libsql://your-database-org.turso.io
TURSO_AUTH_TOKEN=
```

Default DB is local SQLite (`file:holahive.db`). Use separate databases for
simulated validation and a public live deployment. Tickets have no execution mode;
Accounts and CreationAttempts record how a creation ran.

The Docker image uses `/data/holahive.db` by default. Mount `/data` as a persistent
Dokploy volume and keep one application replica while SQLite is authoritative.
`GET /api/health` checks database connectivity without contacting Hive.

The base schema is defined in `src/lib/database.ts`. There is no general
incremental migration runner; invitations have a separate, explicit additive
initializer (`pnpm invite:init`).
Before pointing a deployment at an existing database, run `pnpm db:diagnose`.
`pnpm db:init` is for an empty database or an already compatible schema; it does
not migrate old table layouts. `pnpm db:reset` deletes the local database and is
only for disposable development data.

```bash
pnpm db:init
SEED_ADMIN_PASSWORD="..." pnpm db:seed   # optional, on a fresh local DB only
pnpm admin:create      # or ADMIN_USERNAME=… ADMIN_PASSWORD=… pnpm admin:create
pnpm dev               # runs db:init, then astro dev
```

`pnpm dev` and `pnpm invite:init` load `.env.local`. Standalone DB and admin
commands use the process environment: export the required variables first,
especially `DATABASE_URL` when targeting a nondefault database. Never run reset
or seed commands against an existing deployment.

One admin only. Enforced in SQL. Password is bcrypt (10 rounds).

---

## Commands

| Command              |                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Dev server                                                                                  |
| `pnpm build`         | Production build                                                                            |
| `pnpm preview`       | Preview production build                                                                    |
| `pnpm db:init`       | Apply current schema (`CREATE IF NOT EXISTS`)                                               |
| `pnpm invite:init`   | Initialize the personal-invitation schema; campaign starts paused                           |
| `pnpm db:diagnose`   | Read-only schema/version preflight and consistency report; exits nonzero on critical issues |
| `pnpm db:reset`      | Delete local DB and recreate schema; disposable development data only                       |
| `pnpm db:seed`       | Test data (`SEED_ADMIN_PASSWORD` required)                                                  |
| `pnpm db:quickstart` | Reset + seed                                                                                |
| `pnpm admin:create`  | Create admin                                                                                |
| `pnpm admin:reset`   | Rotate admin password                                                                       |
| `pnpm admin:check`   | Admin status                                                                                |

## Validation

Checks run locally; this repository has no GitHub Actions workflow. Run tests
against a disposable SQLite database, with no real Hive broadcast:

```bash
validation_dir=$(mktemp -d)
DATABASE_URL="file:$validation_dir/tests.db" HIVE_TX_MODE=simulate pnpm verify
pnpm build
```

Build with synthetic credentials or no local secret file when inspecting
generated assets. Production secrets belong in the running server environment.

| Command                  |                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `pnpm test`              | Unit tests (`HIVE_TX_MODE=simulate`)                                                                         |
| `pnpm check`             | Types + lint                                                                                                 |
| `pnpm verify`            | `check` then `test`                                                                                          |
| `pnpm verify:simulation` | `verify` + WAX self-test + simulation                                                                        |
| `pnpm state`             | SELECT-only DB observation. Fails if the DB is missing or schema is outdated; never initializes or migrates. |
| `pnpm wax:self-test`     | WAX/mainnet diagnostics without broadcast                                                                    |
| `pnpm test:simulation`   | Integration simulation against the local DB                                                                  |

---

## Auth

**Admin** — password. `POST /api/auth/management-login` → bcrypt → Better Auth session cookie.

**Builder** — Hive Keychain Posting proof. `POST /api/auth/challenge` receives the username and persists the exact server-generated message (canonical origin, server timestamp, nonce, username; 2 min expiry). The client signs that message; verification consumes the challenge once and issues an HttpOnly signed Builder cookie. Builders have no identity row in `user`; credits belong to Hive usernames. Challenge and verify enforce origin/CSRF checks.

Blocking a Hive username denies Builder access and consumption of its existing tickets. Unblocking restores ticket usability without resetting credits or history. The atomic reservation checks the denylist even if earlier validation succeeded.

Tickets persist `total_uses`, `remaining_uses`, and optional `revoked_at`. `used_uses`, `kind` (`single_use`/`multi_use`) and lifecycle status are derived from those facts. A revoked ticket retains its remaining uses and can be restored without changing balances.

Builders exchange credits one-to-one for ticket uses and manage their own
tickets. Admins assign Builder credits and can issue audited system-funded
single-use tickets. Personal invitations also use system-funded tickets and
enforce social-identity ownership during reservation. The campaign controls
belong exclusively to Admins; Builders cannot activate it or change its cap.

## Repository hygiene

Only the root README is published as Markdown documentation. Internal plans,
audit requests, agent settings, browser captures, generated output, databases
and real `.env` files stay local through `.gitignore`. `.env.example` contains
placeholders only. Review the staged file list and diff before each commit;
ignore rules do not remove files that were already tracked.

---

## Layout

```text
src/
  components/    UI
  consts/        Brand, SEO, config
  layouts/       Base, public, builders, management
  lib/           Chain, db, auth, sessions
  pages/         Pages + API
scripts/         DB + admin
```

| Layout                   |                          |
| ------------------------ | ------------------------ |
| `Base.astro`             | HTML + meta              |
| `Layout.astro`           | Public, indexable        |
| `BuildersLayout.astro`   | `/builders/*`, noindex   |
| `ManagementLayout.astro` | `/management/*`, noindex |

---

## Security

- Account keys generated in browser memory; creation requests carry public keys.
- Admin passwords: bcrypt.
- Creation cookies: HMAC-SHA256.
- Admin sessions: Better Auth (`user` / `session` in libsql), `AUTH_SECRET`. Builder sessions: signed HttpOnly cookies.
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
  APP_ID: 'YourBrand/1.0.0', // frozen once on-chain
  CLAIM_APP_ID: 'yourBrandCreateAcc', // frozen once on-chain
} as const
```

Replace `public/favicon.svg`, `public/og.jpg`, logos in `src/assets/`. Colors: `@theme` in `src/styles/global.css`.

Do not change `APP_ID` or `CLAIM_APP_ID` after accounts or claims have gone on-chain. Changing `BEEKEEPER_CONFIG.SESSION_SALT` kills existing wallet sessions.
