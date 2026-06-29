import type { ErrorWithCode, FsOpts } from "../types";

export type FsCallback<T = unknown> = (err: ErrorWithCode | null, result?: T) => void;

export function normalizeOpts(opts: unknown): FsOpts {
  if (!opts) return {};
  if (typeof opts === "string") return { encoding: opts };
  return opts as FsOpts;
}

export function resolveCallback<T>(optsOrCb: unknown, cb?: FsCallback<T>): FsCallback<T> {
  return typeof optsOrCb === "function" ? (optsOrCb as FsCallback<T>) : cb || (() => {});
}

export function makeError(msg: string, code?: string, path?: string): ErrorWithCode {
  const err: ErrorWithCode = new Error(msg);
  err.code = code || "EUNKNOWN";
  if (path !== undefined) err.path = path;
  return err;
}
