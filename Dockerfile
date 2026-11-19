# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
# Prisma needs OpenSSL; ca-certificates lets the API talk to managed Postgres over TLS.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
# The schema is copied first because `postinstall` runs `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
RUN npx prisma generate
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies pending migrations, then starts. Fine for one instance; with several, run `prisma migrate deploy` as a release step instead.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
