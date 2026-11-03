# The manager portal is a separate package with its own dependencies, built first so the server
# image carries only its output and never the frontend's node_modules.
FROM node:24-bookworm-slim AS portal
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY server ./server
COPY tests ./tests
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY data/pack.json ./data/pack.json
COPY --from=portal /app/web/dist ./web/dist
# In-memory Postgres: the home card is interaction-scoped per the brief, so nothing needs a disk,
# and there is no lock file to go stale when the free tier restarts the container.
ENV HOST=0.0.0.0 PORT=10000 LOCAL_DB_PATH=memory:// PACK_PATH=data/pack.json
EXPOSE 10000
USER node
CMD ["node","--env-file-if-exists=/etc/secrets/storeiq.env","dist/server/src/index.js"]
