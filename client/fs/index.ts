import type { DirHandle, FdEntry, FsEntry, FsOpts, FsStat, ReadStream, Watcher, WriteStream } from "../types";
import * as async from "./async";
import { fsConstants } from "./constants";
import { createFdTable } from "./fd";
import { createPromises } from "./promises";
import type { FsShim } from "./shim";
import { makeStat } from "./stat";
import { createReadStream, createWriteStream } from "./streams";
import * as sync from "./sync";

export type { FsShim };

// No-op watcher: Obsidian calls fs.watch to detect external file changes.
// In our environment all writes go through the Go server via fsShim, so
// Obsidian already knows about every change it makes. External modifications
// are not possible, so polling is pointless and only wastes /fs/stat calls.
function makeNoopWatcher(): Watcher {
  return {
    close() {},
    on(_event: string, _cb: unknown) {
      return this;
    },
    addListener(_event: string, _cb: unknown) {
      return this;
    },
    removeListener(_event: string, _cb: unknown) {
      return this;
    },
  };
}

export function buildFsShim(): FsShim {
  const shim = {} as FsShim;

  // Attach constants
  shim.constants = fsConstants as unknown as Record<string, number>;

  // Attach sync operations
  shim.existsSync = sync.existsSync;
  shim.readFileSync = sync.readFileSync;
  shim.writeFileSync = sync.writeFileSync;
  shim.appendFileSync = sync.appendFileSync;
  shim.statSync = sync.statSync;
  shim.lstatSync = sync.lstatSync;
  shim.mkdirSync = sync.mkdirSync;
  shim.rmdirSync = sync.rmdirSync;
  shim.readdirSync = sync.readdirSync;
  shim.unlinkSync = sync.unlinkSync;
  shim.renameSync = sync.renameSync;
  shim.copyFileSync = sync.copyFileSync;
  shim.chmodSync = sync.chmodSync;
  shim.accessSync = sync.accessSync;
  shim.realpathSync = sync.realpathSync;
  shim.readlinkSync = sync.readlinkSync;
  shim.symlinkSync = sync.symlinkSync;
  shim.truncateSync = sync.truncateSync;

  // Attach async operations
  shim.readFile = async.readFile;
  shim.writeFile = async.writeFile;
  shim.appendFile = async.appendFile;
  shim.stat = async.stat;
  shim.lstat = async.lstat;
  shim.readdir = async.readdir;
  shim.mkdir = async.mkdir;
  shim.rmdir = async.rmdir;
  shim.rename = async.rename;
  shim.unlink = async.unlink;
  shim.copyFile = async.copyFile;
  shim.access = async.access;
  shim.chmod = async.chmod;
  shim.realpath = async.realpath;
  shim.truncate = async.truncate;

  // No-op watchers — see comment on makeNoopWatcher above
  shim.watch = (_path: string, _opts?: unknown, _listener?: unknown) => makeNoopWatcher();
  shim.watchFile = (_path: string, _opts?: unknown, _listener?: unknown) => makeNoopWatcher();
  shim.unwatchFile = () => {};

  // Attach streams
  shim.createReadStream = (path: string, opts?: FsOpts) => createReadStream(shim, path, opts) as unknown as ReadStream;
  shim.createWriteStream = (path: string, opts?: FsOpts) =>
    createWriteStream(shim, path, opts) as unknown as WriteStream;

  // Attach fd operations
  const fd = createFdTable(shim);
  shim._fds = fd._fds;
  shim._nextFd = fd._nextFd;
  shim._getFd = fd._getFd;
  shim.openSync = fd.openSync;
  shim.closeSync = fd.closeSync;
  shim.readSync = fd.readSync;
  shim.writeSync = fd.writeSync;
  shim.fstatSync = fd.fstatSync;
  shim.ftruncateSync = fd.ftruncateSync;
  shim.fsyncSync = fd.fsyncSync;
  shim.fdatasyncSync = fd.fdatasyncSync;
  shim.fchmodSync = fd.fchmodSync;
  shim.fchownSync = fd.fchownSync;
  shim.lutimesSync = fd.lutimesSync;
  shim.utimesSync = fd.utimesSync;
  shim.opendirSync = fd.opendirSync as unknown as (path: string, opts?: FsOpts) => DirHandle;

  // Attach promises
  shim.promises = createPromises(shim) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

  return shim;
}

// Persist fsShim across HMR re-executions so Obsidian's captured `require('fs')`
// reference keeps pointing to the same object with updated implementations.
if (!window.__oshFsShim) window.__oshFsShim = {};
export const fsShim = window.__oshFsShim as unknown as FsShim;
Object.assign(fsShim, buildFsShim());
