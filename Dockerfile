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

# The container always runs as root, and /vault is a bind-mounted host
# directory git doesn't own — git refuses to touch it ("dubious ownership")
# unless told otherwise. Baking this into the image (root's own, isolated
# $HOME — not a real user's machine) covers every git invocation, including
# ones the app's own -c safe.directory=* flag might miss (see server/ws/exec.go).
#
# credential.helper=store: without a helper, git can only get credentials by
# prompting a tty — fine in the OSH terminal, but the Git plugin's non-pty
# child_process calls have no tty to prompt on and just fail. `store` caches
# whatever's entered once (e.g. via the OSH terminal) in ~/.git-credentials
# (plaintext — persisted via the osh-home:/root volume, see README) so later
# non-interactive invocations don't need to prompt at all.
#
# core.pager=cat: git usually detects a non-tty stdout and skips paging on
# its own, but that's a heuristic, not a guarantee — if it ever mispredicts on
# the plugin's pipe-based (no-tty) path, `less` would block forever waiting
# for input that can never arrive, hanging that WS connection. Belt-and-
# suspenders. (The interactive OSH terminal still has a real pty, so `less`
# there works fine if invoked explicitly, e.g. `git -c core.pager=less log`.)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory '*' \
    && git config --global credential.helper store \
    && git config --global core.pager ""

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
# Set OSH_TERMINAL=true to enable the terminal modal (experimental)
# ENV OSH_TERMINAL=true

EXPOSE 27123

ENTRYPOINT ["./osh-server"]
