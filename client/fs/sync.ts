import type { FsEntry, FsOpts, FsResult, FsStat } from "../types";
import { fsSyncCall } from "./calls";
import { makeStat } from "./stat";
import { normalizeOpts } from "./types";

export function existsSync(path: string): boolean {
  try {
    return !!(fsSyncCall("exists", { path }) as FsResult)?.exists;
  } catch (_) {
    return false;
  }
}

export function readFileSync(path: string, opts?: FsOpts | string | null): string | Uint8Array {
  const o = normalizeOpts(opts);
  const r = fsSyncCall("readFile", { path, encoding: o.encoding || null }) as FsResult;
  if (o.encoding || typeof opts === "string") return r.data || "";
  if (r.base64) {
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(0);
}

export function writeFileSync(
  path: string,
  data: string | Uint8Array | ArrayBuffer,
  opts?: FsOpts | string | null,
): void {
  const o = normalizeOpts(opts);
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
  fsSyncCall("writeFile", payload as import("../types").FsPayload);
}

export function appendFileSync(path: string, data: string, opts?: FsOpts | string | null): void {
  const o = normalizeOpts(opts);
  fsSyncCall("appendFile", {
    path,
    data: typeof data === "string" ? data : "",
    encoding: o.encoding || "utf8",
  });
}

export function statSync(path: string): FsStat {
  return makeStat(fsSyncCall("stat", { path }) as FsResult);
}

export function lstatSync(path: string): FsStat {
  try {
    return makeStat(fsSyncCall("lstat", { path }) as FsResult);
  } catch (_) {
    return statSync(path);
  }
}

export function mkdirSync(path: string, opts?: FsOpts | number | null): void {
  const o = normalizeOpts(opts);
  fsSyncCall("mkdir", { path, recursive: !!o.recursive, mode: o.mode || null });
}

export function rmdirSync(path: string, opts?: FsOpts | null): void {
  fsSyncCall("rmdir", { path, recursive: !!opts?.recursive });
}

export function readdirSync(path: string, opts?: FsOpts | null): (FsEntry | string)[] {
  const o = normalizeOpts(opts);
  const withTypes = !!o?.withFileTypes;
  const result = fsSyncCall("readdir", { path, withFileTypes: withTypes }) as FsResult;
  if (!result?.entries) return [];
  if (withTypes) {
    return result.entries.map((e: FsEntry) => ({
      name: e.name,
      isFile: () => !!e.isFile,
      isDirectory: () => !!e.isDirectory,
      isSymbolicLink: () => !!e.isSymbolicLink,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    })) as unknown as (FsEntry | string)[];
  }
  return result.entries;
}

export function unlinkSync(path: string): void {
  fsSyncCall("unlink", { path });
}

export function renameSync(from: string, to: string): void {
  fsSyncCall("rename", { from, to } as unknown as import("../types").FsPayload);
}

export function copyFileSync(src: string, dest: string, flags?: number): void {
  fsSyncCall("copyFile", { src, dest, flags: flags || 0 } as unknown as import("../types").FsPayload);
}

export function chmodSync(path: string, mode: number): void {
  try {
    fsSyncCall("chmod", { path, mode });
  } catch (_) {
    // ignore chmod errors
  }
}

export function accessSync(path: string, mode?: number): void {
  const r = fsSyncCall("access", { path, mode: mode || 0 }) as FsResult;
  if (!r?.ok) {
    const e = new Error(`ENOENT: no such file or directory, access '${path}'`) as Error & {
      code: string;
      path: string;
    };
    e.code = "ENOENT";
    e.path = path;
    throw e;
  }
}

export function realpathSync(path: string): string {
  try {
    return (fsSyncCall("realpath", { path }) as FsResult).path || path;
  } catch (_) {
    return path;
  }
}

export function readlinkSync(path: string): string {
  return (fsSyncCall("readlink", { path }) as FsResult).target || path;
}

export function symlinkSync(target: string, path: string): void {
  fsSyncCall("symlink", { target, path });
}

export function truncateSync(path: string, len?: number): void {
  fsSyncCall("truncate", { path, len: len || 0 });
}
