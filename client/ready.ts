import { electronShim } from "./electron";
import { fsShim } from "./fs/index";
import { debugLog } from "./log";
import { pathShim } from "./path";
import { platform, proc } from "./process";

function onReady() {
  const osClass = platform === "darwin" ? "mod-macos" : platform === "win32" ? "mod-windows" : "mod-linux";
  document.body.classList.add(osClass);

  globalThis.dispatchEvent(
    new CustomEvent("electron-shim-ready", {
      detail: { electronShim, fsShim, pathShim },
    }),
  );
  debugLog("electron-shim loaded, platform=" + proc.platform + ", electron=" + proc.versions.electron);
}

if (!window.__oshReady) {
  window.__oshReady = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
}
