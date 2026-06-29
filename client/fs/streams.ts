import { BASE_URL, getVaultId } from "../config";
import type { FsOpts } from "../types";
import type { FsShim } from "./shim";
import { normalizeOpts } from "./types";

interface StreamSelf {
  on(event: string, cb: (...args: unknown[]) => void): StreamSelf;
  once(event: string, cb: (...args: unknown[]) => void): StreamSelf;
  removeListener(event: string, cb: (...args: unknown[]) => void): StreamSelf;
  resume?(): StreamSelf;
  pipe?(dest: { write: (chunk: unknown) => void; end: () => void }): unknown;
  destroy(): void;
  write?(chunk: unknown, enc?: string, cb?: (() => void) | null): boolean;
  end?(chunk?: unknown, enc?: string | (() => void), cb?: (...args: unknown[]) => void): void;
}

interface StreamListeners {
  data?: (chunk: unknown) => void;
  end?: () => void;
  close?: () => void;
  error?: (err: Error) => void;
  finish?: () => void;
  [key: string]: unknown;
}

export function createReadStream(shim: FsShim, path: string, opts?: FsOpts) {
  const listeners: StreamListeners = {};
  const o = normalizeOpts(opts || {});
  const highWaterMark = o.highWaterMark || 65536;
  let destroyed = false;
  let resumeScheduled = false;
  const _self: StreamSelf = {
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = cb;
      return _self;
    },
    once(event: string, cb: (...args: unknown[]) => void) {
      const wrapper = (...args: unknown[]) => {
        cb(...args);
        _self.removeListener(event, wrapper);
      };
      listeners[event] = listeners[event] || [];
      (listeners[event] as unknown[]).push(wrapper);
      return _self;
    },
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      if (listeners[event]) {
        const arr = listeners[event] as unknown[];
        listeners[event] = arr.filter((l: unknown) => l !== cb) as unknown;
      }
      return _self;
    },
    pipe(dest: { write: (chunk: unknown) => void; end: () => void }) {
      _self.on("data", (chunk: unknown) => {
        dest.write(chunk);
      });
      _self.on("end", () => {
        dest.end();
      });
      _self.resume?.();
      return dest;
    },
    resume() {
      if (resumeScheduled || destroyed) return _self;
      resumeScheduled = true;
      _startStream();
      return _self;
    },
    destroy() {
      destroyed = true;
      (listeners.close as () => void)?.();
    },
  };

  async function _startStream() {
    try {
      const params = new URLSearchParams({ path });
      const vault = getVaultId();
      if (vault) params.set("vault", vault);
      const enc = o.encoding;
      if (enc && enc !== "buffer") params.set("encoding", enc);
      const url = BASE_URL + "/api/fs/readFile?" + params.toString();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, encoding: enc && enc !== "buffer" ? enc : null }),
      });
      if (!response.ok) {
        listeners.error?.(new Error("readStream: HTTP " + response.status));
        return;
      }

      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const pump = async () => {
        while (!destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (enc === "utf8" || enc === "utf-8" || !enc) {
            const text = new TextDecoder().decode(value, { stream: true });
            listeners.data?.(text);
          } else if (typeof enc === "string") {
            listeners.data?.(new TextDecoder(enc).decode(value, { stream: true }));
          } else {
            listeners.data?.(new Uint8Array(value.buffer));
          }
        }
        if (!destroyed) {
          listeners.end?.();
          listeners.close?.();
        }
      };
      pump().catch((err: Error) => {
        if (!destroyed) listeners.error?.(err);
      });
    } catch (err) {
      if (!destroyed) listeners.error?.(err as Error);
    }
  }

  return _self;
}

export function createWriteStream(shim: FsShim, path: string, opts?: FsOpts) {
  const listeners: StreamListeners = {};
  const o = normalizeOpts(opts || {});
  const CHUNK_THRESHOLD = 65536;
  let buffer: Uint8Array[] = [];
  let bufferSize = 0;
  let ended = false;
  let destroyed = false;
  let pendingFlush: Promise<void> | null = null;
  let bytesWritten = 0;
  const _self: StreamSelf = {
    write(chunk: unknown, enc?: string | (() => void), cb?: (err?: Error) => void) {
      if (ended || destroyed) {
        if (typeof cb === "function") cb(new Error("write after end"));
        return false;
      }
      if (typeof chunk === "string") {
        const bytes = new TextEncoder().encode(chunk);
        buffer.push(bytes);
        bufferSize += bytes.length;
      } else if (chunk instanceof Uint8Array) {
        buffer.push(chunk);
        bufferSize += chunk.length;
      } else if (chunk instanceof ArrayBuffer) {
        buffer.push(new Uint8Array(chunk));
        bufferSize += chunk.byteLength;
      } else {
        const str = String(chunk);
        const bytes = new TextEncoder().encode(str);
        buffer.push(bytes);
        bufferSize += bytes.length;
      }
      if (typeof cb === "function") cb();
      if (bufferSize >= CHUNK_THRESHOLD) _flush();
      return bufferSize < CHUNK_THRESHOLD * 4;
    },
    end(chunk?: unknown, enc?: string | (() => void), cb?: (...args: unknown[]) => void) {
      ended = true;
      if (typeof chunk === "function") {
        cb = chunk as (...args: unknown[]) => void;
        chunk = null;
      }
      if (chunk) {
        _self.write?.(chunk, enc as string | undefined, null);
      }
      (pendingFlush || Promise.resolve()).then(() => _doEnd(cb));
    },
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = cb;
      return _self;
    },
    once(event: string, cb: (...args: unknown[]) => void) {
      const wrapper = (...args: unknown[]) => {
        cb(...args);
        _self.removeListener(event, wrapper);
      };
      listeners[event] = listeners[event] || [];
      (listeners[event] as unknown[]).push(wrapper);
      return _self;
    },
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      if (listeners[event]) {
        const arr = listeners[event] as unknown[];
        listeners[event] = arr.filter((l: unknown) => l !== cb) as unknown;
      }
      return _self;
    },
    destroy(err?: Error) {
      destroyed = true;
      buffer = [];
      bufferSize = 0;
      if (err) listeners.error?.(err);
      listeners.close?.();
    },
  };

  async function _flush() {
    if (buffer.length === 0) return;
    const chunks = buffer.splice(0);
    bufferSize = 0;
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    bytesWritten += merged.length;
    const vault = getVaultId();
    const url =
      BASE_URL +
      "/api/fs/writeRaw?path=" +
      encodeURIComponent(path) +
      (vault ? "&vault=" + encodeURIComponent(vault) : "");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: merged,
      });
      const result: Record<string, unknown> = await res.json();
      if (result?.error) throw new Error(result.error as string);
    } catch (err) {
      destroyed = true;
      listeners.error?.(err as Error);
      throw err;
    }
  }

  function _doEnd(cb?: (...args: unknown[]) => void) {
    return _flush()
      .then(() => {
        if (!destroyed) {
          listeners.finish?.();
          listeners.close?.();
        }
        if (typeof cb === "function") cb(null);
      })
      .catch((err: Error) => {
        listeners.error?.(err);
        if (typeof cb === "function") cb(err);
      });
  }

  return _self;
}
