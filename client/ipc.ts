import { BASE_URL, getVaultId, setVaultId, vaultQuery } from "./config";
import { bus } from "./lib/service-bus";
import { debugLog, warn } from "./log";
import { syncXhr } from "./sync-xhr";
import type { IpcListener, IpcResult } from "./types";
import { wsInvoke, wsSend } from "./websocket";

// — Custom app icon state (handled locally without server dependency) —
let _customIconName: string | null = null;
let _customIconDataUrl: string | null = null;

const _MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

function _bytesToDataUrl(data: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return "data:" + mime + ";base64," + btoa(binary);
}

function _normalizeIconData(fileName: string | null, data: string | Uint8Array | ArrayBuffer | null): void {
  if (!fileName || !data) {
    _customIconName = null;
    _customIconDataUrl = null;
    return;
  }
  _customIconName = fileName;
  let bytes: Uint8Array;
  if (typeof data === "string") {
    const bin = atob(data);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return;
  }
  const ext = (fileName.split(".").pop() || "png").toLowerCase();
  const mime = _MIME_BY_EXT[ext] || "image/png";
  _customIconDataUrl = _bytesToDataUrl(bytes, mime);
}

function _updateFavicon(url: string | null): void {
  // Remove all existing icon/apple-touch-icon links so none of them
  // compete with our custom icon (the static handler injects multiple).
  document
    .querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
    .forEach((el) => el.remove());
  if (!url) return;
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = url;
  document.head.appendChild(link);
}

function _updatePreviewImg(): void {
  if (!_customIconDataUrl) return;
  const items = document.querySelectorAll(".setting-item");
  for (const item of items) {
    const nameEl = item.querySelector(".setting-item-name");
    if (nameEl && nameEl.textContent.includes("Custom app icon")) {
      const desc = item.querySelector(".setting-item-description");
      if (!desc) break;
      let img = desc.querySelector("img");
      if (img) {
        img.src = _customIconDataUrl;
      } else {
        desc.innerHTML = "";
        img = document.createElement("img");
        img.className = "setting-command-icon";
        img.src = _customIconDataUrl;
        desc.appendChild(img);
      }
      break;
    }
  }
}

// Persist the custom icon to the server (or delete it) asynchronously.
function _persistIcon(fileName: string | null, data: string | Uint8Array | ArrayBuffer | null): void {
  if (fileName && data) {
    let b64 = data;
    if (typeof data !== "string") {
      try {
        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        let bin = "";
        for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
        b64 = btoa(bin);
      } catch (_) {}
    }
    fetch(BASE_URL + "/api/icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: fileName, base64: b64 }),
    }).catch(() => {});
  } else {
    fetch(BASE_URL + "/api/icon", { method: "DELETE" }).catch(() => {});
  }
}

// On page load: restore the custom icon from the server so that favicon and
// get-icon work correctly before the user opens Settings.
fetch(BASE_URL + "/api/icon-meta")
  .then((r) => r.json())
  .then((meta) => {
    if (meta && meta.exists) {
      _customIconName = "server"; // truthy — causes get-icon to return "api/icon"
      _updateFavicon(BASE_URL + "/api/icon");
    }
  })
  .catch(() => {});

// Non-IPC fetch helper for /api/browse, /api/native, etc.
export function asyncPost(path: string, body: Record<string, unknown>): Promise<Response | undefined> {
  return fetch(BASE_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((e): undefined => {
    warn("asyncPost " + path + " failed: " + e.message);
    return undefined;
  });
}

// ipcRenderer event emitter — persisted so Obsidian's registered listeners
// survive HMR re-executions.
if (!window.__oshIpcListeners) window.__oshIpcListeners = {};
const _listeners = window.__oshIpcListeners as Record<string, IpcListener[]>;

export function ipcOn(channel: string, listener: (event: unknown, data: unknown) => void): void {
  (_listeners[channel] = _listeners[channel] || []).push({ fn: listener, once: false });
}

export function ipcOnce(channel: string, listener: (event: unknown, data: unknown) => void): void {
  (_listeners[channel] = _listeners[channel] || []).push({ fn: listener, once: true });
}

export function ipcRemoveListener(channel: string, listener: (event: unknown, data: unknown) => void): void {
  if (_listeners[channel]) {
    _listeners[channel] = _listeners[channel].filter((l) => l.fn !== listener);
  }
}

export function ipcRemoveAllListeners(channel?: string): void {
  if (channel) delete _listeners[channel];
  else Object.keys(_listeners).forEach((k) => delete _listeners[k]);
}

export function ipcDispatch(channel: string, event: unknown, data: unknown): void {
  const listeners = _listeners[channel];
  if (!listeners?.length) return;
  const toRemove = [];
  listeners.forEach((l) => {
    try {
      l.fn(event, data);
    } catch (e) {
      warn("ipcListener error on " + channel + ": " + e.message);
    }
    if (l.once) toRemove.push(l.fn);
  });
  toRemove.forEach((fn) => ipcRemoveListener(channel, fn));
}

function _handleResult(result: unknown): unknown {
  const r = result as Record<string, unknown>;
  if (r && Object.prototype.hasOwnProperty.call(r, "result")) result = r.result;
  const r2 = result as Record<string, unknown>;
  if (r2 && typeof r2 === "object" && r2.__navigate__) {
    const url = r2.__navigate__ as string;
    const match = url.match(/[?&]vault=([^&]+)/);
    if (match) setVaultId(decodeURIComponent(match[1]));
    setTimeout(() => location.assign(url), 0);
    const clean = Object.fromEntries(Object.entries(r2).filter(([k]) => k !== "__navigate__"));
    return clean.ok !== undefined ? clean.ok : clean;
  }
  return result;
}

export function ipcSendSync(channel: string, ...args: unknown[]): unknown {
  debugLog("ipcSendSync: " + channel);
  if (channel === "set-icon") {
    const [fileName, data] = args;
    const hasData = !!(fileName && data);
    _normalizeIconData(hasData ? fileName as string : null, hasData ? data as string | Uint8Array | ArrayBuffer : null);
    _persistIcon(hasData ? fileName as string : null, hasData ? data as string | Uint8Array | ArrayBuffer : null);
    return;
  }
  if (channel === "get-icon") {
    // Return "api/icon" so Obsidian's O() function produces a server-relative URL.
    // With app.getPath("userData")="" the result is "api/icon?timestamp",
    // which our IconHandler serves correctly.
    // Fall back to the bundled Obsidian icon when no custom icon is set.
    return _customIconName ? "api/icon" : "icon.png";
  }
  if (channel === "file-url") {
    return ""; // No local file URL scheme
  }
  // Direct HTTP POST — one round trip, no WS+poll coordination overhead.
  // The previous WS sync-invoke path required two messages (WS frame + HTTP poll)
  // and introduced a race-condition window, making it slower than plain HTTP.
  const result = syncXhr("POST", BASE_URL + "/ipc/sync" + vaultQuery(), { channel, args });
  return _handleResult(result);
}

// Server-side HTTP proxy for Obsidian's requestUrl().
// Obsidian does: ipcRenderer.once(replyChannel, cb); ipcRenderer.send("request-url", replyChannel, opts)
// We POST to /api/fetch; the Go server performs the HTTP request (bypassing CORS).
function _handleRequestUrl(replyChannel: string, opts: Record<string, unknown> = {}): void {
  const sendOpts: {
    url: unknown;
    method: unknown;
    headers: unknown;
    contentType: unknown;
    body?: string;
    bodyBase64?: string;
  } = {
    url: opts.url || "",
    method: opts.method || "GET",
    headers: opts.headers || {},
    contentType: opts.contentType || "",
  };
  if (opts.body) {
    if (typeof opts.body === "string") {
      sendOpts.body = opts.body;
    } else {
      try {
        const rawBody = opts.body as ArrayBuffer | ArrayBufferView;
        const view = ArrayBuffer.isView(rawBody)
          ? new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)
          : new Uint8Array(rawBody as ArrayBuffer);
        let bin = "";
        for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
        sendOpts.bodyBase64 = btoa(bin);
      } catch (_) {}
    }
  }

  fetch(BASE_URL + "/api/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sendOpts),
  })
    .then((r) => r.json())
    .then((r) => {
      if (r && r.error) {
        ipcDispatch(replyChannel, { sender: ipcRenderer }, { error: r.error });
        return;
      }
      let ab = new ArrayBuffer(0);
      try {
        const ct = (r.headers?.["content-type"] || r.headers?.["Content-Type"]) ?? "";
        const isText =
          r.text !== undefined &&
          !r.binary &&
          (/^(text\/|application\/(json|javascript|x-javascript|xml|x-www-form-urlencoded))/i.test(ct) || !r.base64);
        if (isText) {
          ab = new TextEncoder().encode(r.text || "").buffer;
        } else if (r.base64) {
          const bin = atob(r.base64);
          const arr = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
          ab = arr.buffer;
        }
      } catch (_) {}
      // body must be truthy so Obsidian's Promise resolves correctly
      const payload: Record<string, unknown> = {
        status: r.status || 0,
        headers: r.headers || {},
        arrayBuffer: ab,
        body: ab,
        text: r.text || "",
      };
      try {
        payload.json = JSON.parse(r.text);
      } catch (_) {
        payload.json = null;
      }
      ipcDispatch(replyChannel, { sender: ipcRenderer }, payload);
    })
    .catch((e) => ipcDispatch(replyChannel, { sender: ipcRenderer }, { error: String(e?.message || e) }));
}

function ipcSend(channel: string, ...args: unknown[]): void {
  debugLog("ipcSend: " + channel);
  if (channel === "set-icon") {
    const [fileName, data] = args;
    const hasData = !!(fileName && data);
    _normalizeIconData(hasData ? fileName as string : null, hasData ? data as string | Uint8Array | ArrayBuffer : null);
    _persistIcon(hasData ? fileName as string : null, hasData ? data as string | Uint8Array | ArrayBuffer : null);
    return;
  }
  // request-url is proxied via /api/fetch, not over the WebSocket
  if (channel === "request-url") {
    _handleRequestUrl(args[0] as string, args[1] as Record<string, unknown>);
    return;
  }
  wsSend({ type: "send", channel, args, vault: getVaultId() });
}

interface IpcRenderer {
  send: (channel: string, ...args: unknown[]) => void;
  sendSync: (channel: string, ...args: unknown[]) => unknown;
  sendToHost: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (ch: string, fn: (event: unknown, data: unknown) => void) => IpcRenderer;
  once: (ch: string, fn: (event: unknown, data: unknown) => void) => IpcRenderer;
  removeListener: (ch: string, fn: (event: unknown, data: unknown) => void) => IpcRenderer;
  removeAllListeners: (ch?: string) => IpcRenderer;
  eventNames: () => string[];
  listenerCount: (ch: string) => number;
}

// Stable ipcRenderer object — methods are updated on each HMR run so new
// implementations take effect, but Obsidian's captured reference stays valid.
if (!window.__oshIpcRenderer) window.__oshIpcRenderer = {};
export const ipcRenderer = window.__oshIpcRenderer as unknown as IpcRenderer;
Object.assign(ipcRenderer, {
  send: (channel: string, ...args: unknown[]) => ipcSend(channel, ...args),
  sendSync: (channel: string, ...args: unknown[]) => ipcSendSync(channel, ...args),
  sendToHost: (channel: string, ...args: unknown[]) => wsSend({ type: "send", channel, args, vault: getVaultId() }),
  invoke: (channel: string, ...args: unknown[]) => wsInvoke(channel, args).catch(() => undefined),
  on: (ch: string, fn: (event: unknown, data: unknown) => void) => { ipcOn(ch, fn); return ipcRenderer; },
  once: (ch: string, fn: (event: unknown, data: unknown) => void) => { ipcOnce(ch, fn); return ipcRenderer; },
  removeListener: (ch: string, fn: (event: unknown, data: unknown) => void) => { ipcRemoveListener(ch, fn); return ipcRenderer; },
  removeAllListeners: (ch?: string) => { ipcRemoveAllListeners(ch); return ipcRenderer; },
  eventNames: () => Object.keys(_listeners),
  listenerCount: (ch: string) => (_listeners[ch] || []).length,
});

if (!window.__oshIpcBound) {
  window.__oshIpcBound = true;
  bus.on("ipc:dispatch", (channel, event, data) => ipcDispatch(channel, event, data));
  bus.set("ws:invoke", wsInvoke);
}
