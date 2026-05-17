FROM node:22.12-alpine AS deps
WORKDIR /app
# pnpm reproducible al minor exacto
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# python3/make/g++ necesarios para compilar el binding nativo de argon2
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22.12-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# libc6-compat: el node_modules copiado contiene argon2 con binding nativo musl
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# TODO(F1.3): descomentar cuando exista prisma/schema.prisma
# RUN pnpm prisma generate
RUN pnpm build

FROM node:22.12-alpine AS runtime
WORKDIR /app
# tini: PID 1 mínimo que reenvía señales correctamente → shutdown graceful de NestJS
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Non-root user — hardening §11.2
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nestjs
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/package.json ./
# Eliminar dev deps del node_modules copiado para reducir tamaño de imagen
RUN pnpm prune --prod
USER nestjs
EXPOSE 3000
# Node 22 tiene fetch nativo — no necesitamos curl ni wget
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
