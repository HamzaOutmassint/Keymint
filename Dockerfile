FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Generation and compilation do not need access to a live database.
RUN DATABASE_URL=postgresql://keymint_build:keymint_build@127.0.0.1:1/keymint_build npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder --chown=nextjs:nextjs /app/scripts/validate-production.ts ./scripts/validate-production.ts
COPY --from=builder --chown=nextjs:nextjs /app/lib/server-env.ts ./lib/server-env.ts
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1
CMD ["npm", "start"]
