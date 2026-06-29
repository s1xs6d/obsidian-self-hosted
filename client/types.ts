// Shared type definitions for the OSH client shim

export interface FsResult {
  error?: string;
  code?: string;
  path?: string;
  data?: string;
  base64?: string;
  exists?: boolean;
  ok?: boolean;
  entries?: FsEntry[];
  target?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  isSymbolicLink?: boolean;
  size?: number;
  mode?: number;
  mtime?: string | number;
  ctime?: string | number;
  atime?: string | number;
  [key: string]: unknown;
}

export interface FsEntry {
  name: string;
  isFile?: boolean;
  isDirectory?: boolean;
  isSymbolicLink?: boolean;
}

export interface FsStat {
  isFile: () => boolean;
  isDirectory: () => boolean;
  isBlockDevice: () => boolean;
  isCharacterDevice: () => boolean;
  isSymbolicLink: () => boolean;
  isFIFO: () => boolean;
  isSocket: () => boolean;
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
}

export interface FsOpts {
  encoding?: string | null;
  mode?: number | null;
  flag?: string;
  recursive?: boolean;
  withFileTypes?: boolean;
  interval?: number;
  highWaterMark?: number;
}

export interface FsPayload {
  path: string;
  encoding?: string | null;
  mode?: number | null;
  flag?: string;
  recursive?: boolean;
  withFileTypes?: boolean;
  data?: string;
  base64?: string;
  from?: string;
  to?: string;
  src?: string;
  dest?: string;
  target?: string;
  len?: number;
  atime?: number;
  mtime?: number;
  [key: string]: unknown;
}

export interface IpcResult {
  result?: unknown;
  error?: string;
  __navigate__?: string;
  [key: string]: unknown;
}

export interface IpcListener {
  fn: (event: unknown, data: unknown) => void;
  once: boolean;
}

export interface Watcher {
  close: () => void;
  on: (event: string, cb: (...args: unknown[]) => void) => Watcher;
  addListener: (event: string, cb: (...args: unknown[]) => void) => Watcher;
  removeListener: (event: string, cb: (...args: unknown[]) => void) => Watcher;
}

export interface FdEntry {
  fd: number;
  path: string;
  mode: number;
  reading: boolean;
  writing: boolean;
  append: boolean;
  pos: number;
  data: string | Uint8Array;
  dirty: boolean;
  exists: boolean;
}

export interface DirEntry {
  name: string;
  isFile?: () => boolean;
  isDirectory?: () => boolean;
  isSymbolicLink?: () => boolean;
}

export interface DirHandle {
  path: string;
  entries: DirEntry[];
  pos: number;
  closed: boolean;
  closeSync: () => void;
  readSync: () => DirEntry | null;
}

export interface StreamListener {
  [event: string]: ((...args: unknown[]) => void) | ((...args: unknown[]) => void)[] | undefined;
  data?: (...args: unknown[]) => void;
  end?: () => void;
  close?: () => void;
  error?: (err: Error) => void;
  finish?: () => void;
}

export interface ReadStream {
  on: (event: string, cb: (...args: unknown[]) => void) => ReadStream;
  once: (event: string, cb: (...args: unknown[]) => void) => ReadStream;
  removeListener: (event: string, cb: (...args: unknown[]) => void) => ReadStream;
  pipe: (dest: { write: (chunk: unknown) => void; end: () => void }) => unknown;
  resume: () => ReadStream;
  destroy: () => void;
}

export interface WriteStream {
  write: (chunk: unknown, enc?: string, cb?: (err?: Error) => void) => boolean;
  end: (chunk?: unknown, enc?: string, cb?: () => void) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => WriteStream;
  once: (event: string, cb: (...args: unknown[]) => void) => WriteStream;
  removeListener: (event: string, cb: (...args: unknown[]) => void) => WriteStream;
  destroy: (err?: Error) => void;
}

declare global {
  interface Window {
    __oshObsAPI?: Record<string, unknown>;
    __oshParentDir?: string;
    queryLocalFonts?: () => Promise<Array<{ family: string }>>;
    __oshFsShim?: Record<string, unknown>;
    __oshIpcListeners?: Record<string, unknown[]>;
    __oshIpcRenderer?: Record<string, unknown>;
    __oshIpcBound?: boolean;
    __oshElectronShim?: Record<string, unknown>;
    __oshWsState?: Record<string, unknown>;
    __oshWsBound?: boolean;
    __oshConnState?: Record<string, unknown>;
    __oshConnBound?: boolean;
    __oshConnHide?: () => void;
    __oshConnSchedule?: () => void;
    __oshReady?: boolean;
    electron?: Record<string, unknown>;
    ipcRenderer?: Record<string, unknown>;
    app?: Record<string, unknown>;
    require?: ((module: string) => unknown) & { resolve?: (name: string) => string; cache?: Record<string, unknown> };
  }

  interface Navigator {
    userAgentData?: {
      platform: string;
      brands: Array<{ brand: string; version: string }>;
      mobile: boolean;
    };
  }

  // Make globalThis.process available (optional, may not exist in browser)
  // eslint-disable-next-line no-var
  var process: { platform: string; arch: string; env: Record<string, string | undefined>; versions: Record<string, string>; [key: string]: unknown } | undefined;
}

export type ErrorWithCode = Error & { code?: string; path?: string; errno?: number };
