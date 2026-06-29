export function warn(msg) {
  console.warn("[electron-shim] " + msg);
}

export function debugLog(msg) {
  if (globalThis.__electronShimDebug) {
    console.debug("[electron-shim] " + msg);
  }
}
