# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV CI=1
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Asia/Ho_Chi_Minh \
    HDDT_DOCKER=1 \
    HDDT_BIND_HOST=0.0.0.0 \
    HDDT_PORT=3210 \
    HDDT_FIXED_PORT=1 \
    HDDT_NO_OPEN_BROWSER=1 \
    HDDT_APP_DATA_DIR=/data/app \
    HDDT_DATA_ROOT=/tmp/disabled-business-data \
    HDDT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tzdata chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/app /tmp/disabled-business-data \
 && chown -R node:node /data /tmp/disabled-business-data /app
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
