import { getVaultId } from "../config";
import { BASE_URL } from "../config";
import type { FsOpts, FsResult } from "../types";
import { fsAsyncCall } from "./calls";
import { makeStat } from "./stat";
import { makeError, normalizeOpts, resolveCallback } from "./types";

function getEnc(opts?: FsOpts | string | null): string | null {
  const o = normalizeOpts(typeof opts === "function" ? {} : opts);
  return o.encoding || null;
}

export function readFile(
  path: string,
  opts: FsOpts | string | ((err: Error | null, data?: string | Uint8Array) => void),
  cb?: (err: Error | null, data?: string | Uint8Array) => void,
): void {
  const callback = resolveCallback(opts, cb);
  const enc = getEnc(typeof opts === "function" ? null : opts);
  fsAsyncCall("readFile", { path, encoding: enc }, (err, r) => {
    if (err) return callback(err);
    if (enc || typeof opts === "string") {
      callback(null, r.data || "");
      return;
    }
    if (r.base64) {
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      callback(null, bytes);
    } else {
      callback(null, new Uint8Array(0));
    }
  });
}

export function writeFile(
  path: string,
  data: string | Uint8Array | ArrayBuffer,
  opts: FsOpts | string | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  const callback = resolveCallback(opts, cb);
  const o = normalizeOpts(typeof opts === "function" ? {} : opts);
  const RAW_THRESHOLD = 131072;
  if (typeof data === "string" && data.length > RAW_THRESHOLD) {
    const bytes = new TextEncoder().encode(data);
    const vault = getVaultId();
    fetch(
      `${BASE_URL}/api/fs/writeRaw?path=${encodeURIComponent(path)}${vault ? "&vault=" + encodeURIComponent(vault) : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      },
    )
      .then((r) => r.json())
      .then((r: Record<string, unknown>) => {
        if (r?.error) {
          const e = new Error(r.error as string) as Error & { code: string };
          e.code = (r.code as string) || "EIO";
          callback(e);
        } else {
          callback(null);
        }
      })
      .catch((e: Error) => callback(new Error("writeRaw: " + e.message)));
    return;
  }
  const payload: Record<string, unknown> = {
    path,
    encoding: o.encoding || "utf8",
    mode: o.mode || null,
    flag: o.flag || "w",
  };
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const arr = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    payload.base64 = btoa(String.fromCharCode(...arr));
  } else {
    payload.data = data;
  }
  fsAsyncCall("writeFile", payload as import("../types").FsPayload, (err) => callback(err || null));
}

export function appendFile(
  path: string,
  data: string,
  opts: FsOpts | string | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  const callback = resolveCallback(opts, cb);
  const o = normalizeOpts(typeof opts === "function" ? {} : opts);
  fsAsyncCall(
    "appendFile",
    { path, data: typeof data === "string" ? data : "", encoding: o.encoding || "utf8" },
    (err) => callback(err || null),
  );
}

export function stat(
  path: string,
  opts?: FsOpts | ((err: Error | null, stat?: ReturnType<typeof makeStat>) => void),
  cb?: (err: Error | null, stat?: ReturnType<typeof makeStat>) => void,
): void {
  if (typeof opts === "function") {
    cb = opts;
  }
  cb = cb || (() => {});
  fsAsyncCall("stat", { path }, (err, r) => (err ? cb(err) : cb(null, makeStat(r))));
}

export function lstat(
  path: string,
  opts?: FsOpts | ((err: Error | null, stat?: ReturnType<typeof makeStat>) => void),
  cb?: (err: Error | null, stat?: ReturnType<typeof makeStat>) => void,
): void {
  if (typeof opts === "function") {
    cb = opts;
  }
  cb = cb || (() => {});
  fsAsyncCall("lstat", { path }, (err, r) => (err ? cb(err) : cb(null, makeStat(r))));
}

export function readdir(
  path: string,
  opts?: FsOpts | ((err: Error | null, entries?: (import("../types").FsEntry | string)[]) => void),
  cb?: (err: Error | null, entries?: (import("../types").FsEntry | string)[]) => void,
): void {
  const callback = resolveCallback(opts, cb);
  const o = normalizeOpts(typeof opts === "function" ? {} : opts);
  fsAsyncCall("readdir", { path, withFileTypes: !!o?.withFileTypes }, (err, r) =>
    err ? callback(err) : callback(null, r?.entries || []),
  );
}

export function mkdir(
  path: string,
  opts?: FsOpts | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  const callback = resolveCallback(opts, cb);
  const o = normalizeOpts(typeof opts === "function" ? {} : opts);
  fsAsyncCall("mkdir", { path, recursive: !!o?.recursive, mode: o?.mode || null }, (err) => callback(err || null));
}

export function rmdir(
  path: string,
  opts?: FsOpts | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  const callback = resolveCallback(opts, cb);
  const o = normalizeOpts(typeof opts === "function" ? {} : opts);
  fsAsyncCall("rmdir", { path, recursive: !!o?.recursive }, (err) => callback(err || null));
}

export function rename(from: string, to: string, cb?: (err: Error | null) => void): void {
  cb = cb || (() => {});
  fsAsyncCall("rename", { from, to } as unknown as import("../types").FsPayload, (err) => cb(err || null));
}

export function unlink(path: string, cb?: (err: Error | null) => void): void {
  cb = cb || (() => {});
  fsAsyncCall("unlink", { path }, (err) => cb(err || null));
}

export function copyFile(
  src: string,
  dest: string,
  flags: number | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  if (typeof flags === "function") {
    cb = flags;
    flags = 0;
  }
  cb = cb || (() => {});
  fsAsyncCall("copyFile", { src, dest, flags: flags || 0 } as unknown as import("../types").FsPayload, (err) => cb(err || null));
}

export function access(
  path: string,
  mode: number | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  if (typeof mode === "function") {
    cb = mode;
    mode = 0;
  }
  cb = cb || (() => {});
  fsAsyncCall("access", { path, mode: mode || 0 }, (err, r) => {
    if (err) return cb(err);
    if (!(r as FsResult)?.ok) {
      const e = new Error(`EACCES: permission denied, access '${path}'`) as Error & { code: string; path: string };
      e.code = "EACCES";
      e.path = path;
      return cb(e);
    }
    cb(null);
  });
}

export function chmod(path: string, mode: number, cb?: (err: Error | null) => void): void {
  cb = cb || (() => {});
  fsAsyncCall("chmod", { path, mode }, (err) => cb(err || null));
}

export function realpath(
  path: string,
  opts?: FsOpts | ((err: Error | null, path?: string) => void),
  cb?: (err: Error | null, path?: string) => void,
): void {
  if (typeof opts === "function") {
    cb = opts;
  }
  cb = cb || (() => {});
  fsAsyncCall("realpath", { path }, (err, r) => (err ? cb(err) : cb(null, (r as FsResult)?.path || path)));
}

export function truncate(
  path: string,
  len: number | ((err: Error | null) => void),
  cb?: (err: Error | null) => void,
): void {
  if (typeof len === "function") {
    cb = len;
    len = 0;
  }
  cb = cb || (() => {});
  fsAsyncCall("truncate", { path, len: len || 0 }, (err) => cb(err || null));
}
