import type { FdEntry, FsOpts } from "../types";
import { fsSyncCall } from "./calls";
import type { FsShim } from "./shim";

export function createFdTable(shim: FsShim) {
  const _fds: Record<number, FdEntry> = {};
  let _nextFd = 3;

  function _getFd(fd: number): FdEntry {
    const entry = _fds[fd];
    if (!entry) {
      const err = new Error("EBADF: bad file descriptor") as Error & { code: string; errno: number };
      err.code = "EBADF";
      err.errno = -9;
      throw err;
    }
    return entry;
  }

  function openSync(path: string, flags: number, mode?: number): number {
    const fd = _nextFd++;
    const writeMode = (flags & (shim.constants.O_WRONLY | shim.constants.O_RDWR)) !== 0;
    const appendMode = (flags & shim.constants.O_APPEND) !== 0;
    const create = (flags & shim.constants.O_CREAT) !== 0;
    const trunc = (flags & shim.constants.O_TRUNC) !== 0;
    const reading = !writeMode || (flags & shim.constants.O_RDWR) !== 0;

    let exists = false;
    let fileData: string | null = null;
    try {
      const s = shim.statSync(path);
      exists = true;
      if (trunc) fileData = "";
      else if (reading) fileData = shim.readFileSync(path, "utf8") as string;
    } catch (_) {
      if (!create) {
        const err = new Error("ENOENT: no such file or directory, open '" + path + "'") as Error & {
          code: string;
          errno: number;
          path: string;
        };
        err.code = "ENOENT";
        err.errno = -2;
        err.path = path;
        throw err;
      }
      fileData = "";
    }
    const entry: FdEntry = {
      fd,
      path,
      mode: mode || 0o644,
      reading,
      writing: writeMode,
      append: appendMode,
      pos: 0,
      data: fileData || "",
      dirty: !!(create || trunc),
      exists,
    };
    _fds[fd] = entry;
    return fd;
  }

  function closeSync(fd: number): void {
    const entry = _fds[fd];
    if (!entry) return;
    if (entry.dirty) fsyncSync(fd);
    delete _fds[fd];
  }

  function readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number {
    const entry = _getFd(fd);
    const pos = position !== null && position !== undefined ? position : entry.pos;
    const data = typeof entry.data === "string" ? new TextEncoder().encode(entry.data) : entry.data;
    const available = Math.min(length, data.length - pos);
    if (available <= 0) return 0;
    const slice = data.slice(pos, pos + available);
    if (buffer instanceof Uint8Array) {
      const targetOffset = offset || 0;
      for (let i = 0; i < slice.length; i++) buffer[targetOffset + i] = slice[i];
    }
    if (position === null || position === undefined) entry.pos = pos + available;
    return available;
  }

  function writeSync(
    fd: number,
    buffer: string | Uint8Array,
    offset?: number,
    length?: number,
    position?: number | null,
  ): number {
    const entry = _getFd(fd);
    let data: string;
    if (typeof buffer === "string") {
      data = buffer;
    } else if (buffer instanceof Uint8Array) {
      data = new TextDecoder().decode(buffer.subarray(offset || 0, (offset || 0) + (length || buffer.length)));
    } else {
      data = String(buffer);
    }
    if (entry.append) {
      entry.data += data;
    } else {
      const pos = position !== null && position !== undefined ? position : entry.pos;
      if (pos >= entry.data.length) {
        entry.data += data;
      } else {
        entry.data = entry.data.slice(0, pos) + data + entry.data.slice(pos + data.length);
      }
    }
    entry.dirty = true;
    if (position === null || position === undefined) entry.pos += data.length;
    return data.length;
  }

  function fstatSync(fd: number) {
    const entry = _getFd(fd);
    try {
      return shim.statSync(entry.path);
    } catch (_) {
      return shim.statSync("/nonexistent");
    }
  }

  function ftruncateSync(fd: number, len?: number): void {
    const entry = _getFd(fd);
    if (len !== undefined && len >= 0) {
      entry.data = entry.data.slice(0, len);
    } else {
      entry.data = "";
    }
    entry.dirty = true;
  }

  function fsyncSync(fd: number): void {
    const entry = _fds[fd];
    if (!entry || !entry.dirty) return;
    shim.writeFileSync(entry.path, entry.data, "utf8");
    entry.dirty = false;
  }

  function fdatasyncSync(fd: number): void {
    fsyncSync(fd);
  }

  function fchmodSync(fd: number, mode: number): void {
    const entry = _getFd(fd);
    try {
      shim.chmodSync(entry.path, mode);
    } catch (_) {
      // ignore
    }
  }

  function fchownSync(_fd: number, _uid: number, _gid: number): void {
    // no-op
  }

  function lutimesSync(_path: string, _atime: number | Date, _mtime: number | Date): void {
    // no-op
  }

  function utimesSync(path: string, atime: number | Date, mtime: number | Date): void {
    try {
      fsSyncCall("utimes", {
        path,
        atime: atime instanceof Date ? atime.getTime() : atime,
        mtime: mtime instanceof Date ? mtime.getTime() : mtime,
      });
    } catch (_) {
      // ignore
    }
  }

  function opendirSync(path: string, _opts?: FsOpts) {
    const entries = shim.readdirSync(path, { withFileTypes: true }) as unknown as { name: string; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }[];
    const dir: {
      path: string;
      entries: (
        | { name: string; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }
        | string
      )[];
      pos: number;
      closed: boolean;
      closeSync: () => void;
      readSync: () => unknown;
    } = {
      path,
      entries,
      pos: 0,
      closed: false,
      closeSync() {
        dir.closed = true;
      },
      readSync() {
        if (dir.closed || dir.pos >= dir.entries.length) return null;
        const entry = dir.entries[dir.pos++];
        if (typeof entry === "string") {
          return {
            name: entry,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          };
        }
        return entry;
      },
    };
    return dir;
  }

  return {
    _fds,
    _nextFd,
    _getFd,
    openSync,
    closeSync,
    readSync,
    writeSync,
    fstatSync,
    ftruncateSync,
    fsyncSync,
    fdatasyncSync,
    fchmodSync,
    fchownSync,
    lutimesSync,
    utimesSync,
    opendirSync,
  };
}
