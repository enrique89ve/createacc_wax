## Project Overview

HolaHive is a secure web application for creating free Hive blockchain accounts. Built with Astro 5.12 and TailwindCSS v4, it focuses on privacy and security - Hive private keys are never read or stored by the server, and all key generation happens in the user's browser.

se usa la libreria @hiveio/wax para las operaciones con la blockchain Hive

## Architecture

- **Framework**: Astro with TypeScript (strict mode)
- **Styling**: TailwindCSS v4 via Vite plugin
- **Structure**: Standard Astro project with layouts, components, and pages

## Setup & Configuration

### 1. Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

The same `.env.local` file works for both **development** and **production**. Just change the `MAINNET` variable:

**Development (Testnet):**
```bash
MAINNET=false  # Uses api.fake.openhive.network
```

**Production (Mainnet):**
```bash
MAINNET=TRUE  # Uses mainnet with failover
```

### 2. Required Environment Variables

```bash
# Hive accounts
HIVE_CREATOR_ACCOUNT=your-creator-account
HIVE_DELEGATOR_ACCOUNT=your-delegator-account
HIVE_CREATOR_ACTIVE_KEY=5JNHfZY.....
HIVE_DELEGATOR_ACTIVE_KEY=5JNHfZY.....

# Auth secret (min 32 chars)
AUTH_SECRET=your-random-secret-key

# Environment mode
MAINNET=false  # or TRUE for production
```

### 3. Development Commands

```bash
# Install dependencies
pnpm install

# Start dev server (auto-runs db:init)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## ESTILO DE DISEÑO INTERFACE

- Estilo moderno minimalista, estilo https://ui.shadcn.com/, usar solo el color rojo para alternar red-500 para botones importantes y green-500, y indigo-400 para lineas de bordes, para texto usar neutral-50
