import { getVaultId } from "./config";
import { electronShim } from "./electron";
import { _currentWindow, makeWindow } from "./fake-window";
import { ipcRenderer } from "./ipc";
import { debugLog } from "./log";
import { pathShim } from "./path";
import { platform, proc } from "./process";
import { remote } from "./remote/index";

// Expose globals that Obsidian and plugins expect
globalThis.electronShim = electronShim;
globalThis.ipcRenderer = ipcRenderer;
globalThis.remote = remote;
globalThis.pathShim = pathShim;

// window.electron — Obsidian's app.js accesses these directly (not via require)
globalThis.electron = {
  remote,
  ipcRenderer,
  shell: remote.shell,
  clipboard: remote.clipboard,
  nativeTheme: remote.nativeTheme,
  webFrame: electronShim.webFrame,
  safeStorage: electronShim.safeStorage,
};

// Patch app.openWithDefaultApp once window.app is set by Obsidian.
// Only runs in vault context — starter/help pages never set window.app.
(function _patchOpenWithDefaultApp() {
  if (!getVaultId()) return;
  const _app = globalThis.app;
  if (_app && typeof _app.openWithDefaultApp === "function" && !_app._oshOwdPatched) {
    _app._oshOwdPatched = true;
    _app.openWithDefaultApp = (path) => {
      const adapter = _app.vault && _app.vault.adapter;
      const fullPath = adapter && typeof adapter.getFullPath === "function" ? adapter.getFullPath(path) : path;
      remote.shell.showItemInFolder(fullPath);
    };
    return;
  }
  setTimeout(_patchOpenWithDefaultApp, 200);
})();

// Override window.close() — in Electron, closes the starter window and focuses
// the vault editor. In the browser, navigate to the vault editor instead.
globalThis.close = () => {
  const id = getVaultId();
  if (id) globalThis.location.assign("/app?vault=" + encodeURIComponent(id));
  // If vault ID is unknown, stay on the current page.
};

// Node.js globals expected by CommonJS-style plugins
if (typeof globalThis.global === "undefined") globalThis.global = globalThis;
if (typeof globalThis.__dirname === "undefined") globalThis.__dirname = "/";
if (typeof globalThis.__filename === "undefined") globalThis.__filename = "/app.js";

// NOTE: Do NOT define window.module or window.exports globally.
// Browser UMD bundles check `typeof module !== 'undefined'` to choose between
// CommonJS and browser-global mode — a fake global.module breaks them.

// Patch ipcRenderer.sendSync for channels handled by the browser (not the server):
// "help" → open /help in a new tab
// "starter" → open /starter in a new tab
// "is-quitting" → always false (browser has no quit flow)
(() => {
  const _origSendSync = ipcRenderer.sendSync.bind(ipcRenderer);
  // biome-ignore lint/complexity/useArrowFunction: regular function needed for `arguments`
  ipcRenderer.sendSync = function (channel) {
    switch (channel) {
      case "help":
        globalThis.open(location.origin + "/help", "_blank", "noopener,width=600,height=500");
        return null;
      case "starter":
        globalThis.open(location.origin + "/starter", "_blank", "noopener");
        return null;
      case "is-quitting":
        return false;
      default:
        return _origSendSync.apply(null, arguments);
    }
  };
})();

// navigator.platform override — some Obsidian code checks this directly
try {
  Object.defineProperty(navigator, "platform", {
    get() {
      if (proc.platform === "darwin") return "MacIntel";
      if (proc.platform === "win32") return "Win32";
      return "Linux x86_64";
    },
    configurable: true,
  });
} catch (_) {}

// location.assign shim: intercept obsidian:// URIs
const _origAssign = globalThis.location.assign.bind(globalThis.location);
try {
  globalThis.location.assign = (url) => {
    if (typeof url === "string" && url.startsWith("obsidian://")) {
      globalThis.dispatchEvent(new CustomEvent("obsidian-protocol", { detail: url }));
      return;
    }
    _origAssign(url);
  };
} catch (e) {
  debugLog("Could not override location.assign: " + e.message);
}

// window.open shim:
// • obsidian:// URIs → fire custom event
// • about:blank popout windows → inject electron shim so Obsidian's WorkspaceWindow
//   constructor can call electronWindow.show() without throwing
const _origOpen = globalThis.open.bind(globalThis);
globalThis.open = (url, target, features) => {
  debugLog("window.open: url=" + url + " target=" + target);
  if (typeof url === "string" && url.startsWith("obsidian://")) {
    globalThis.dispatchEvent(new CustomEvent("obsidian-protocol", { detail: url }));
    return null;
  }
  // file:// URLs (from openWithDefaultApp / showItemInFolder) cannot be opened by
  // the browser from an http origin. Route them to the OshFileBrowser instead.
  if (typeof url === "string" && url.startsWith("file://")) {
    try {
      const path = decodeURIComponent(url.slice("file://".length));
      electronShim.shell.openPath(path);
    } catch (e) {
      debugLog("window.open file:// handler error: " + e);
    }
    return null;
  }
  const newWin = _origOpen(url, target, features);
  if (newWin && typeof url === "string" && url === "about:blank") {
    try {
      newWin.electronWindow = makeWindow();
      newWin.electron = electronShim;
      newWin.require = globalThis.require;
      newWin.ipcRenderer = electronShim.ipcRenderer;
    } catch (e) {
      debugLog("popout window shim injection failed: " + e);
    }
  }
  return newWin;
};
