import type { FsResult, FsStat } from "../types";

export function makeStat(raw: FsResult | undefined): FsStat {
  const isDir = !!raw?.isDirectory;
  const isFile = !!raw?.isFile;
  const isSymlink = !!raw?.isSymbolicLink;
  const mtime = raw?.mtime ? new Date(raw.mtime) : new Date(0);
  const ctime = raw?.ctime ? new Date(raw.ctime) : new Date(0);
  const atime = raw?.atime ? new Date(raw.atime) : new Date(0);
  const sz = raw?.size || 0;
  const mode = raw?.mode || (isDir ? 0o755 : 0o644);
  return {
    isFile: () => isFile,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => isSymlink,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode,
    nlink: 1,
    uid: 1000,
    gid: 1000,
    rdev: 0,
    size: sz,
    blksize: 4096,
    blocks: Math.ceil(sz / 512),
    atimeMs: atime.getTime(),
    mtimeMs: mtime.getTime(),
    ctimeMs: ctime.getTime(),
    birthtimeMs: ctime.getTime(),
    atime,
    mtime,
    ctime,
    birthtime: ctime,
  };
}
