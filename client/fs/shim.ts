import type {
  DirHandle,
  ErrorWithCode,
  FdEntry,
  FsEntry,
  FsOpts,
  FsPayload,
  FsResult,
  FsStat,
  ReadStream,
  Watcher,
  WriteStream,
} from "../types";

export interface FsShim {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, opts?: FsOpts | string | null) => string | Uint8Array;
  writeFileSync: (path: string, data: string | Uint8Array | ArrayBuffer, opts?: FsOpts | string | null) => void;
  appendFileSync: (path: string, data: string, opts?: FsOpts | string | null) => void;
  statSync: (path: string) => FsStat;
  lstatSync: (path: string) => FsStat;
  mkdirSync: (path: string, opts?: FsOpts | number | null) => void;
  rmdirSync: (path: string, opts?: FsOpts | null) => void;
  readdirSync: (path: string, opts?: FsOpts | null) => (FsEntry | string)[];
  unlinkSync: (path: string) => void;
  renameSync: (from: string, to: string) => void;
  copyFileSync: (src: string, dest: string, flags?: number) => void;
  chmodSync: (path: string, mode: number) => void;
  accessSync: (path: string, mode?: number) => void;
  realpathSync: (path: string) => string;
  readlinkSync: (path: string) => string;
  symlinkSync: (target: string, path: string) => void;
  truncateSync: (path: string, len?: number) => void;

  readFile: (
    path: string,
    opts: FsOpts | string | ((err: ErrorWithCode | null, data?: string | Uint8Array) => void),
    cb?: (err: ErrorWithCode | null, data?: string | Uint8Array) => void,
  ) => void;
  writeFile: (
    path: string,
    data: string | Uint8Array | ArrayBuffer,
    opts: FsOpts | string | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;
  appendFile: (
    path: string,
    data: string,
    opts: FsOpts | string | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;
  stat: (
    path: string,
    opts?: FsOpts | ((err: ErrorWithCode | null, stat?: FsStat) => void),
    cb?: (err: ErrorWithCode | null, stat?: FsStat) => void,
  ) => void;
  lstat: (
    path: string,
    opts?: FsOpts | ((err: ErrorWithCode | null, stat?: FsStat) => void),
    cb?: (err: ErrorWithCode | null, stat?: FsStat) => void,
  ) => void;
  readdir: (
    path: string,
    opts?: FsOpts | ((err: ErrorWithCode | null, entries?: (FsEntry | string)[]) => void),
    cb?: (err: ErrorWithCode | null, entries?: (FsEntry | string)[]) => void,
  ) => void;
  mkdir: (
    path: string,
    opts?: FsOpts | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;
  rmdir: (
    path: string,
    opts?: FsOpts | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;
  rename: (from: string, to: string, cb?: (err: ErrorWithCode | null) => void) => void;
  unlink: (path: string, cb?: (err: ErrorWithCode | null) => void) => void;
  copyFile: (
    src: string,
    dest: string,
    flags: number | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;
  access: (
    path: string,
    mode: number | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;
  chmod: (path: string, mode: number, cb?: (err: ErrorWithCode | null) => void) => void;
  realpath: (
    path: string,
    opts?: FsOpts | ((err: ErrorWithCode | null, path?: string) => void),
    cb?: (err: ErrorWithCode | null, path?: string) => void,
  ) => void;
  truncate: (
    path: string,
    len: number | ((err: ErrorWithCode | null) => void),
    cb?: (err: ErrorWithCode | null) => void,
  ) => void;

  watch: (
    path: string,
    opts?: FsOpts | ((event: string, filename: string) => void),
    listener?: (event: string, filename: string) => void,
  ) => Watcher;
  watchFile: (
    path: string,
    opts?: FsOpts | ((event: string, filename: string) => void),
    listener?: (event: string, filename: string) => void,
  ) => Watcher;
  unwatchFile: () => void;

  createReadStream: (path: string, opts?: FsOpts) => ReadStream;
  createWriteStream: (path: string, opts?: FsOpts) => WriteStream;

  constants: Record<string, number>;
  promises: Record<string, (...args: unknown[]) => Promise<unknown>>;

  _fds: Record<number, FdEntry>;
  _nextFd: number;
  _getFd: (fd: number) => FdEntry;
  openSync: (path: string, flags: number, mode?: number) => number;
  closeSync: (fd: number) => void;
  readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => number;
  writeSync: (
    fd: number,
    buffer: string | Uint8Array,
    offset?: number,
    length?: number,
    position?: number | null,
  ) => number;
  fstatSync: (fd: number) => FsStat;
  ftruncateSync: (fd: number, len?: number) => void;
  fsyncSync: (fd: number) => void;
  fdatasyncSync: (fd: number) => void;
  fchmodSync: (fd: number, mode: number) => void;
  fchownSync: (fd: number, uid: number, gid: number) => void;
  lutimesSync: (path: string, atime: number | Date, mtime: number | Date) => void;
  utimesSync: (path: string, atime: number | Date, mtime: number | Date) => void;
  opendirSync: (path: string, opts?: FsOpts) => DirHandle;
}
