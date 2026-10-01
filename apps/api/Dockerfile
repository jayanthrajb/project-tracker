FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/api ./apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @project-tracker/api

FROM node:20-alpine AS production-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma ./apps/api/prisma
RUN npm ci --omit=dev --workspace @project-tracker/api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

RUN mkdir -p /app/apps/api/uploads && chown -R node:node /app
USER node
WORKDIR /app/apps/api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(async (response) => { if (!response.ok) process.exit(1); const body = await response.json(); if (body.status !== 'ok') process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/src/server.js"]
