# ── Stage 1: build ──────────────────────────────────────────────────────────
# Node is primary because init-obsidian.sh needs npx asar.
# Go is installed manually so both toolchains share one layer.
FROM node:22-bookworm-slim AS builder

ARG GO_VERSION=1.25.0

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates tar git \
    && ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
       | tar -C /usr/local -xz \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/go/bin:${PATH}"
ENV CGO_ENABLED=0
ENV GOOS=linux

WORKDIR /build

# JS dependencies (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Source files
COPY client/   ./client/
COPY server/   ./server/
COPY scripts/  ./scripts/
COPY tsconfig.json biome.json ./

# Download and extract the Obsidian bundle into static/
ARG OBSIDIAN_VERSION=latest
RUN bash scripts/init-obsidian.sh "${OBSIDIAN_VERSION}"

# Build client shim + Go server binary → dist/
RUN npm run build


# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/dist/osh-server ./osh-server
COPY --from=builder /build/dist/static     ./static

ARG OBSIDIAN_VERSION=latest
LABEL obsidian.version="${OBSIDIAN_VERSION}"

# Environment variables — all can be overridden in docker-compose.yml
ENV GIN_MODE=release
ENV OSH_OBSIDIAN_DIR=/app/static
ENV OSH_STATIC_DIR=/app/static
ENV OSH_ADDR=:27123
# /vault is the conventional mount point for the notes folder.
# Override with OSH_HOME=/ to disable path restrictions entirely.
ENV OSH_HOME=/vault

EXPOSE 27123

ENTRYPOINT ["./osh-server"]
