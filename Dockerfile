# PATS container image: the web app and, with `npm run worker` as the command, the background worker.
# Build:  docker build -t pats .            (add --build-arg PATS_ENV=demo for a demo environment)
# Run:    docker run -p 3000:3000 -e DATABASE_URL=… -e SESSION_SECRET=… pats

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG PATS_ENV=""
ENV NEXT_TELEMETRY_DISABLED=1 PATS_ENV=${PATS_ENV}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG PATS_ENV=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 PATS_ENV=${PATS_ENV} FILE_STORE_DIR=/data/files
# Full dependencies: the worker, migrations and the demo seed run from TypeScript sources via tsx.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json package-lock.json next.config.ts tsconfig.json drizzle.config.ts postcss.config.mjs ./
COPY src ./src
COPY drizzle ./drizzle
COPY brand ./brand
COPY docker/entrypoint.sh /usr/local/bin/pats-entrypoint
RUN mkdir -p /data/files && chown -R node:node /data /app
USER node
EXPOSE 3000
ENTRYPOINT ["pats-entrypoint"]
CMD ["npm", "start"]
