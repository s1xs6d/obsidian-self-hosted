import { BASE_URL, getVaultId, vaultQuery } from "./config";
import { bus } from "./lib/service-bus";
import { warn } from "./log";

interface WsMessage {
  type: "result" | "error" | "event";
  id?: string;
  channel?: string;
  payload?: unknown;
  result?: unknown;
  error?: string;
}

const WS_BASE = BASE_URL.replace(/^http/, "ws");

// Persist WebSocket state across HMR re-executions so connections aren't
// duplicated and in-flight callbacks survive the shim reload.
type WsState = {
  ws: WebSocket | null;
  wsReady: boolean;
  wsCbs: Record<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  wsPending: string[];
  wsfs: WebSocket | null;
  wsfsReady: boolean;
  wsfsCbs: Record<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  wsfsPending: string[];
};

if (!window.__oshWsState) {
  window.__oshWsState = {
    ws: null, wsReady: false, wsCbs: {}, wsPending: [],
    wsfs: null, wsfsReady: false, wsfsCbs: {}, wsfsPending: [],
  } satisfies WsState;
}
const S = window.__oshWsState as WsState;

export const getWs      = () => S.ws;
export const getWsReady = () => S.wsReady;
export const getWsfs    = () => S.wsfs;
export const getWsfsReady = () => S.wsfsReady;

export function wsSend(msg: unknown) {
  const data = JSON.stringify(msg);
  if (S.wsReady && S.ws) S.ws.send(data);
  else S.wsPending.push(data);
}

export function wsInvoke(channel: string, args: unknown[]) {
  const id = Math.random().toString(36).slice(2);
  return new Promise<unknown>((resolve, reject) => {
    S.wsCbs[id] = { resolve, reject };
    wsSend({ type: "invoke", id, channel, args, vault: getVaultId() });
  });
}

export function wsfsInvoke(op: string, payload: unknown) {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return new Promise<unknown>((resolve, reject) => {
    S.wsfsCbs[id] = { resolve, reject };
    const data = JSON.stringify({ type: "invoke", id, op, payload: payload || {}, vault: getVaultId() });
    if (S.wsfsReady && S.wsfs) S.wsfs.send(data);
    else S.wsfsPending.push(data);
  });
}

export function wsConnect() {
  if (S.ws) return; // already connected — skip on HMR re-run or duplicate call
  try {
    S.ws = new WebSocket(WS_BASE + "/ws" + vaultQuery());
  } catch (e: unknown) {
    warn("WebSocket unavailable: " + (e as Error).message);
    return;
  }

  S.ws.onopen = () => {
    S.wsReady = true;
    bus.emit("ws:open");
    S.wsPending.splice(0).forEach((msg) => S.ws!.send(msg));
  };

  S.ws.onmessage = (e) => {
    let msg: WsMessage;
    try { msg = JSON.parse(e.data) as WsMessage; } catch (_) { return; }

    if (msg.type === "result" || msg.type === "error") {
      const cb = S.wsCbs[msg.id];
      if (cb) {
        delete S.wsCbs[msg.id];
        msg.type === "error" ? cb.reject(new Error(msg.error)) : cb.resolve(msg.result);
      }
      return;
    }

    if (msg.type === "event" && msg.channel) {
      bus.emit("ipc:dispatch", msg.channel, { sender: null }, msg.payload || {});
    }
  };

  S.ws.onclose = () => {
    S.wsReady = false;
    S.ws = null;
    const cbs = { ...S.wsCbs };
    Object.keys(S.wsCbs).forEach((k) => delete S.wsCbs[k]);
    Object.values(cbs).forEach((cb) => cb.reject(new Error("WebSocket closed")));
    bus.emit("ws:close");
  };

  S.ws.onerror = () => S.ws?.close();
}

export function wsfsConnect() {
  if (S.wsfs) return; // already connected
  try {
    S.wsfs = new WebSocket(WS_BASE + "/ws-fs" + vaultQuery());
  } catch (e: unknown) {
    warn("wsfs WebSocket unavailable: " + (e as Error).message);
    return;
  }

  S.wsfs.onopen = () => {
    S.wsfsReady = true;
    bus.emit("wsfs:open");
    S.wsfsPending.splice(0).forEach((msg) => S.wsfs!.send(msg));
  };

  S.wsfs.onmessage = (e) => {
    let msg: WsMessage;
    try { msg = JSON.parse(e.data) as WsMessage; } catch (_) { return; }
    const cb = S.wsfsCbs[msg.id];
    if (cb && (msg.type === "result" || msg.type === "error")) {
      delete S.wsfsCbs[msg.id];
      msg.type === "error" ? cb.reject(new Error(msg.error || "fs error")) : cb.resolve(msg.result);
    }
  };

  S.wsfs.onclose = () => {
    S.wsfsReady = false;
    S.wsfs = null;
    const cbs = { ...S.wsfsCbs };
    Object.keys(S.wsfsCbs).forEach((k) => delete S.wsfsCbs[k]);
    Object.values(cbs).forEach((cb) => cb.reject(new Error("wsfs closed")));
    bus.emit("wsfs:close");
  };

  S.wsfs.onerror = () => S.wsfs?.close();
}

if (!window.__oshWsBound) {
  window.__oshWsBound = true;
  bus.on("conn:reconnect", () => { wsConnect(); wsfsConnect(); });
}
