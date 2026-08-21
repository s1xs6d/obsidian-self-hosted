#!/bin/bash

set -e

ROOT_DIR=$(pwd)
WORK_DIR="${ROOT_DIR}/.obsidian-tmp"

PINNED_VERSION="${1:-}"
TARGET_DIR="${2:-static}"
mkdir -p "$TARGET_DIR"
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

cleanup() {
    EXIT_CODE=$?
    cd "$ROOT_DIR"
    
    if [ $EXIT_CODE -ne 0 ]; then
        echo "Error occurred. Cleaning up directories..."
        rm -rf "$WORK_DIR"
        rm -rf "$TARGET_DIR"/*
    else
        echo "Cleaning up..."
        rm -rf "$WORK_DIR"
    fi
}

trap cleanup EXIT

if [ -n "$PINNED_VERSION" ] && [ "$PINNED_VERSION" != "latest" ]; then
    LATEST_VERSION="$PINNED_VERSION"
    echo "Using pinned version: v${LATEST_VERSION}"
else
    echo "Fetching latest version info..."
    LATEST_VERSION=$(curl -s https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    if [ -z "$LATEST_VERSION" ]; then
        echo "Error: Failed to fetch the latest version."
        exit 1
    fi
    echo "Latest version: v${LATEST_VERSION}"
fi

if [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
fi
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

BASE_URL="https://github.com/obsidianmd/obsidian-releases/releases/download/v${LATEST_VERSION}"

# Every stable release ships the standalone .asar.gz asset (~9 MB); only
# pre-release tags lack it, and those are not supported here.
ASAR_GZ_NAME="obsidian-${LATEST_VERSION}.asar.gz"
ASAR_NAME="obsidian-${LATEST_VERSION}.asar"

echo "Downloading ${ASAR_GZ_NAME}..."
if ! curl -f -sSL -o "$ASAR_GZ_NAME" "${BASE_URL}/${ASAR_GZ_NAME}"; then
    echo "Error: ${ASAR_GZ_NAME} is not published for v${LATEST_VERSION}."
    exit 1
fi

echo "Decompressing..."
gzip -d -c "$ASAR_GZ_NAME" > "$ASAR_NAME"

SRC_OBSIDIAN_ASAR="${ASAR_NAME}"

if [ ! -f "$SRC_OBSIDIAN_ASAR" ]; then
    echo "Error: obsidian.asar missing from package."
    exit 1
fi

echo "Extracting ASAR content directly to target..."
rm -rf "$TARGET_DIR"/*
npx -y asar extract "${SRC_OBSIDIAN_ASAR}" "$TARGET_DIR"

echo "Success: Core resources placed at $TARGET_DIR"