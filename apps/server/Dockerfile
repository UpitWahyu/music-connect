FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/types/package.json packages/types/
COPY packages/protocol/package.json packages/protocol/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @music-connect/types build \
 && pnpm --filter @music-connect/shared build \
 && pnpm --filter @music-connect/protocol build \
 && pnpm --filter @music-connect/server exec prisma generate --schema ../../../prisma/schema.prisma \
 && pnpm --filter @music-connect/server build

# SEC-20: prune devDependencies in a throwaway stage so the runtime image only
# ever receives the production dependency tree. CI=true is required for pnpm to
# prune non-interactively (it otherwise aborts without a TTY).
FROM build AS prod-deps
RUN CI=true pnpm prune --prod

FROM base AS runner
ENV NODE_ENV=production
# curl is only needed for the HEALTHCHECK below.
RUN apk add --no-cache curl

# SEC-20: run as the unprivileged `node` user, never as root.
COPY --from=prod-deps /app/apps/server/dist ./apps/server/dist
COPY --from=prod-deps /app/apps/server/package.json ./apps/server/package.json
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/prisma ./prisma
RUN chown -R node:node /app
WORKDIR /app/apps/server
USER node
EXPOSE 3000

# SEC-20: the server exposes an unauthenticated /health liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-3000}/health" || exit 1

CMD ["node", "dist/index.js"]
