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
# In-memory Postgres: the home card is interaction-scoped per the brief, so nothing needs a disk,
# and there is no lock file to go stale when the free tier restarts the container.
ENV HOST=0.0.0.0 PORT=10000 LOCAL_DB_PATH=memory:// PACK_PATH=data/pack.json
EXPOSE 10000
USER node
CMD ["node","dist/server/src/index.js"]
