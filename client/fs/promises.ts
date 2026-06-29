import { warn } from "../log";
import type { FsOpts } from "../types";
import type { FsShim } from "./shim";

export function createPromises(shim: FsShim) {
  return {
    readFile: (p: string, o?: FsOpts | string | null) =>
      new Promise<string | Uint8Array>((res, rej) =>
        shim.readFile(p, o || {}, (e: Error | null, d?: string | Uint8Array) =>
          e ? rej(e) : res(d as string | Uint8Array),
        ),
      ),
    writeFile: (p: string, d: string | Uint8Array | ArrayBuffer, o?: FsOpts | string | null) =>
      new Promise<void>((res, rej) => shim.writeFile(p, d, o || {}, (e: Error | null) => (e ? rej(e) : res()))),
    appendFile: (p: string, d: string, o?: FsOpts | string | null) =>
      new Promise<void>((res, rej) => shim.appendFile(p, d, o || {}, (e: Error | null) => (e ? rej(e) : res()))),
    stat: (p: string) =>
      new Promise((res, rej) =>
        shim.stat(p, (e: Error | null, s?: ReturnType<typeof shim.statSync>) => (e ? rej(e) : res(s))),
      ),
    lstat: (p: string) =>
      new Promise((res, rej) =>
        shim.lstat(p, (e: Error | null, s?: ReturnType<typeof shim.lstatSync>) => (e ? rej(e) : res(s))),
      ),
    readdir: (p: string, o?: FsOpts | null) =>
      new Promise((res, rej) => shim.readdir(p, o || {}, (e: Error | null, d?: unknown[]) => (e ? rej(e) : res(d)))),
    mkdir: (p: string, o?: FsOpts | null) =>
      new Promise<void>((res, rej) => shim.mkdir(p, o || {}, (e: Error | null) => (e ? rej(e) : res()))),
    rmdir: (p: string, o?: FsOpts | null) =>
      new Promise<void>((res, rej) => shim.rmdir(p, o || {}, (e: Error | null) => (e ? rej(e) : res()))),
    rename: (f: string, t: string) =>
      new Promise<void>((res, rej) => shim.rename(f, t, (e: Error | null) => (e ? rej(e) : res()))),
    unlink: (p: string) => new Promise<void>((res, rej) => shim.unlink(p, (e: Error | null) => (e ? rej(e) : res()))),
    copyFile: (s: string, d: string, f?: number) =>
      new Promise<void>((res, rej) => shim.copyFile(s, d, f || 0, (e: Error | null) => (e ? rej(e) : res()))),
    access: (p: string, m?: number) =>
      new Promise<void>((res, rej) => shim.access(p, m || 0, (e: Error | null) => (e ? rej(e) : res()))),
    chmod: (p: string, m: number) =>
      new Promise<void>((res, rej) => shim.chmod(p, m, (e: Error | null) => (e ? rej(e) : res()))),
    realpath: (p: string, o?: FsOpts | null) =>
      new Promise<string>((res, rej) =>
        shim.realpath(p, o || {}, (e: Error | null, r?: string) => (e ? rej(e) : res(r as string))),
      ),
    truncate: (p: string, l?: number) =>
      new Promise<void>((res, rej) => shim.truncate(p, l || 0, (e: Error | null) => (e ? rej(e) : res()))),
    rm(path: string, opts?: { recursive?: boolean; force?: boolean }) {
      opts = opts || {};
      return new Promise<void>((res, rej) => {
        if (opts.recursive)
          shim.rmdir(path, { recursive: true }, (e: Error | null) => (!e || opts.force ? res() : rej(e)));
        else shim.unlink(path, (e: Error | null) => (!e || opts.force ? res() : rej(e)));
      });
    },
    open(path: string, _flags: number, _mode?: number) {
      warn("fs.promises.open() returns a fake FileHandle");
      return Promise.resolve({
        read: (buf: Uint8Array) => Promise.resolve({ bytesRead: 0, buffer: buf }),
        write: (buf: Uint8Array) => Promise.resolve({ bytesWritten: 0, buffer: buf }),
        readFile: (o?: FsOpts) => shim.promises.readFile(path, o),
        writeFile: (d: string | Uint8Array | ArrayBuffer, o?: FsOpts) => shim.promises.writeFile(path, d, o),
        close: () => Promise.resolve(),
        stat: () => shim.promises.stat(path),
        chmod: (m: number) => shim.promises.chmod(path, m),
        chown: () => Promise.resolve(),
        truncate: (l: number) => shim.promises.truncate(path, l),
        datasync: () => Promise.resolve(),
        sync: () => Promise.resolve(),
        on: () => {},
      });
    },
    watch(_filename: string, _opts?: FsOpts) {
      // No-op async iterator — all writes go through our Go server so
      // external changes cannot occur and polling is unnecessary.
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              // Never resolves, effectively an empty infinite stream.
              return new Promise<{ value: unknown; done: boolean }>(() => {
                void 0;
              });
            },
            return() {
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
      };
    },
  };
}
