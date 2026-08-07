# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.3.14
ARG CLOUDFLARED_VERSION=2026.7.3

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS builder

WORKDIR /build

COPY package.json tsconfig.json index.ts ./
COPY src/ ./src/

RUN bun build ./index.ts \
    --target=bun \
    --minify \
    --outfile=/out/server.js

WORKDIR /build/frontend

COPY frontend/package.json ./
RUN bun install --no-save --registry https://registry.npmjs.org

COPY frontend/ ./
RUN bun run build

RUN mkdir -p /out/data \
    && touch /out/data/.keep \
    && chown -R 65532:65532 /out/data

FROM oven/bun:${BUN_VERSION}-slim AS bun-runtime

FROM cloudflare/cloudflared:${CLOUDFLARED_VERSION}

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=builder --chown=65532:65532 /out/server.js /app/server.js
COPY --from=builder --chown=65532:65532 /build/frontend/dist /app/frontend/dist
COPY --from=builder --chown=65532:65532 /out/data /data

WORKDIR /app

ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=9911 \
    DATA_DIR=/data \
    FRONTEND_DIR=/app/frontend/dist \
    CLOUDFLARED_PATH=/usr/local/bin/cloudflared \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

USER 65532:65532

VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/bun"]
CMD ["/app/server.js"]
