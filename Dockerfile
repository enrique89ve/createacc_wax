FROM node:24.22.1-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV="production"
ENV HOST="0.0.0.0"
ENV PORT="4321"
ENV DATABASE_URL="file:/data/holahive.db"

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@11.22.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN pnpm build \
  && mkdir -p /data /app/storage_root-node/.beekeeper \
  && chown -R node:node /data /app/storage_root-node

VOLUME ["/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node
CMD ["./node_modules/.bin/tsx", "scripts/start-server.ts"]
