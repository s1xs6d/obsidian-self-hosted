import { isPathSeparator, isWindowsDeviceRoot, normalizeStringWin32 } from "./shared";

function isAbsolute(path) {
  if (!path || typeof path !== "string" || path.length === 0) return false;
  const code = path.charCodeAt(0);
  if (code === 47 || code === 92) return true;
  if (path.length > 2 && path.charCodeAt(1) === 58) {
    const code2 = path.charCodeAt(2);
    if (code2 === 47 || code2 === 92) return true;
  }
  return false;
}

function normalize(path) {
  if (!path || typeof path !== "string" || path.length === 0) return ".";
  let rootEnd = 0;
  let device = "";
  let isAbsoluteFlag = false;
  const firstCode = path.charCodeAt(0);
  if (path.length === 1) {
    return firstCode === 47 || firstCode === 92 ? "\\" : path;
  }
  if (firstCode === 47 || firstCode === 92) {
    isAbsoluteFlag = true;
    const secondCode = path.charCodeAt(1);
    if (secondCode === 47 || secondCode === 92) {
      let j = 2;
      const last = j;
      for (; j < path.length; ++j) {
        const c = path.charCodeAt(j);
        if (c === 47 || c === 92) break;
      }
      if (j < path.length && j !== last) {
        const firstPart = path.slice(last, j);
        let last2 = j;
        for (++j; j < path.length; ++j) {
          const c = path.charCodeAt(j);
          if (c !== 47 && c !== 92) break;
        }
        if (j < path.length && j !== last2) {
          last2 = j;
          for (++j; j < path.length; ++j) {
            const c = path.charCodeAt(j);
            if (c === 47 || c === 92) break;
          }
          if (j === path.length) {
            device = "\\\\" + firstPart + "\\" + path.slice(last2);
            rootEnd = j;
          } else if (j !== last2) {
            device = "\\\\" + firstPart + "\\" + path.slice(last2, j);
            rootEnd = j;
          }
        }
      }
    } else {
      rootEnd = 1;
    }
  } else if (isWindowsDeviceRoot(firstCode)) {
    if (path.charCodeAt(1) === 58) {
      device = path.slice(0, 2);
      rootEnd = 2;
      if (path.length > 2) {
        const code2 = path.charCodeAt(2);
        if (code2 === 47 || code2 === 92) {
          isAbsoluteFlag = true;
          rootEnd = 3;
        }
      }
    }
  }
  let tail = rootEnd < path.length ? normalizeStringWin32(path.slice(rootEnd), !isAbsoluteFlag) : "";
  if (tail.length === 0 && !isAbsoluteFlag) tail = ".";
  if (tail.length > 0 && isPathSeparator(path.charCodeAt(path.length - 1))) tail += "\\";
  const prefix = device + (isAbsoluteFlag ? "\\" : "");
  return prefix + tail;
}

function join() {
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    const arg = arguments[i];
    if (arg && typeof arg === "string") parts.push(arg);
  }
  if (parts.length === 0) return ".";
  return normalize(parts.join("\\"));
}

function resolve(..._args: string[]): string {
  let resolvedDevice = "";
  let resolvedTail = "";
  let resolvedAbsolute = false;
  for (let i = arguments.length - 1; i >= -1; i--) {
    let path;
    if (i >= 0) {
      path = arguments[i];
      if (!path || typeof path !== "string") continue;
    } else {
      path = "C:\\";
    }
    const len = path.length;
    let rootEnd = 0;
    let device = "";
    let isAbsoluteFlag = false;
    const code = path.charCodeAt(0);
    if (len === 1) {
      if (code === 47 || code === 92) {
        isAbsoluteFlag = true;
        rootEnd = 1;
      }
    } else if (code === 47 || code === 92) {
      isAbsoluteFlag = true;
      rootEnd = 1;
    } else if (isWindowsDeviceRoot(code)) {
      if (len > 1 && path.charCodeAt(1) === 58) {
        device = path.slice(0, 2);
        rootEnd = 2;
        if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
          isAbsoluteFlag = true;
          rootEnd = 3;
        }
      }
    }
    const tail = path.slice(rootEnd);
    if (device && resolvedDevice && device.toLowerCase() !== resolvedDevice.toLowerCase()) continue;
    if (!resolvedDevice && device) resolvedDevice = device;
    if (!resolvedAbsolute) {
      resolvedTail = tail + "\\" + resolvedTail;
      resolvedAbsolute = isAbsoluteFlag;
    }
    if (resolvedAbsolute && resolvedDevice) break;
  }
  resolvedTail = normalizeStringWin32(resolvedTail, !resolvedAbsolute);
  return resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || ".";
}

function dirname(path) {
  if (!path || typeof path !== "string" || path.length === 0) return ".";
  let rootEnd = -1;
  let end = -1;
  let matchedSlash = true;
  let offset = 0;
  const code = path.charCodeAt(0);
  if (path.length === 1) return code === 47 || code === 92 ? path : ".";
  if (code === 47 || code === 92) {
    rootEnd = offset = 1;
    if (path.charCodeAt(1) === 47 || path.charCodeAt(1) === 92) {
      let j = 2;
      const last = j;
      for (; j < path.length; ++j) {
        const c = path.charCodeAt(j);
        if (c === 47 || c === 92) break;
      }
      if (j < path.length && j !== last) {
        let last2 = j;
        for (++j; j < path.length; ++j) {
          const c = path.charCodeAt(j);
          if (c !== 47 && c !== 92) break;
        }
        if (j < path.length && j !== last2) {
          last2 = j;
          for (++j; j < path.length; ++j) {
            const c = path.charCodeAt(j);
            if (c === 47 || c === 92) break;
          }
          if (j === path.length) return path;
          if (j !== last2) {
            rootEnd = offset = j + 1;
          }
        }
      }
    }
  } else if (isWindowsDeviceRoot(code)) {
    if (path.length > 1 && path.charCodeAt(1) === 58) {
      rootEnd = 2;
      offset = 2;
      if (path.length > 2 && isPathSeparator(path.charCodeAt(2))) {
        rootEnd = offset = 3;
      }
    }
  }
  for (let i = path.length - 1; i >= offset; --i) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return rootEnd > 0 ? path.slice(0, rootEnd) : ".";
  if (rootEnd > 0 && end < rootEnd) return path.slice(0, rootEnd);
  return path.slice(0, end);
}

function basename(path, ext) {
  if (!path || typeof path !== "string") return "";
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  let i;
  if (path.length >= 2 && path.charCodeAt(1) === 58 && isWindowsDeviceRoot(path.charCodeAt(0))) {
    start = 2;
  }
  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path) return "";
    const extIdx = path.length - ext.length;
    let firstNonSlashEnd = -1;
    for (i = path.length - 1; i >= start; --i) {
      const code = path.charCodeAt(i);
      if (code === 47 || code === 92) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (i === extIdx) {
          if (ext === path.slice(extIdx, firstNonSlashEnd)) end = extIdx;
        }
      }
    }
    if (start === firstNonSlashEnd) start = extIdx;
    else if (end === -1) end = firstNonSlashEnd;
    if (start === end) end = extIdx;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  }
  for (i = path.length - 1; i >= start; --i) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return "";
  return path.slice(start, end);
}

function extname(path) {
  if (!path || typeof path !== "string") return "";
  let start = 0;
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  if (path.length >= 2 && path.charCodeAt(1) === 58 && isWindowsDeviceRoot(path.charCodeAt(0))) {
    start = startPart = 2;
  }
  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (code === 47 || code === 92) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
}

function relative(from, to) {
  if (from === to) return "";
  from = resolve(from);
  to = resolve(to);
  if (from.toLowerCase() === to.toLowerCase()) return "";
  let fromStart = 0;
  for (; fromStart < from.length; ++fromStart) {
    if (from.charCodeAt(fromStart) !== 92) break;
  }
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  let toStart = 0;
  for (; toStart < to.length; ++toStart) {
    if (to.charCodeAt(toStart) !== 92) break;
  }
  const toLen = to.length - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === 92) return to.slice(toStart + i + 1);
        if (i === 0) return to.slice(toStart + i);
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === 92) lastCommonSep = i;
        else if (i === 0) lastCommonSep = 0;
      }
      break;
    }
    const fc = from.charCodeAt(fromStart + i);
    const tc = to.charCodeAt(toStart + i);
    if (fc !== tc) break;
    if (fc === 92) lastCommonSep = i;
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === 92) {
      out = out.length === 0 ? ".." : out + "\\..";
    }
  }
  if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
  return to.slice(toStart + lastCommonSep + 1);
}

function format(pathObject) {
  if (!pathObject || typeof pathObject !== "object")
    throw new TypeError('The "pathObject" argument must be an Object.');
  const dir = pathObject.dir || pathObject.root || "";
  const base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir) return base;
  if (dir === pathObject.root) return dir + base;
  return dir + "\\" + base;
}

function parse(path) {
  const ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (!path || typeof path !== "string" || path.length === 0) return ret;
  let rootEnd = 0;
  const code = path.charCodeAt(0);
  if (path.length === 1) {
    if (code === 47 || code === 92) {
      ret.root = ret.dir = path;
      return ret;
    }
    ret.base = ret.name = path;
    return ret;
  }
  if (code === 47 || code === 92) {
    ret.root = "\\";
    rootEnd = 1;
    if (path.charCodeAt(1) === 47 || path.charCodeAt(1) === 92) {
      let j = 2;
      const last = j;
      for (; j < path.length; ++j) {
        if (path.charCodeAt(j) === 47 || path.charCodeAt(j) === 92) break;
      }
      if (j < path.length && j !== last) {
        let last2 = j;
        for (++j; j < path.length; ++j) {
          if (path.charCodeAt(j) !== 47 && path.charCodeAt(j) !== 92) break;
        }
        if (j < path.length && j !== last2) {
          last2 = j;
          for (++j; j < path.length; ++j) {
            if (path.charCodeAt(j) === 47 || path.charCodeAt(j) === 92) break;
          }
          if (j === path.length) {
            ret.root = ret.dir = path;
            return ret;
          }
          if (j !== last2) {
            ret.root = path.slice(0, j + 1);
            rootEnd = j + 1;
          }
        }
      }
    }
  } else if (isWindowsDeviceRoot(code)) {
    if (path.length > 1 && path.charCodeAt(1) === 58) {
      ret.root = path.slice(0, 2);
      rootEnd = 2;
      if (path.length > 2 && isPathSeparator(path.charCodeAt(2))) {
        ret.root = path.slice(0, 3);
        rootEnd = 3;
      }
    }
  }
  let startDot = -1;
  let startPart = rootEnd;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= rootEnd; --i) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (c === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    if (end !== -1) {
      ret.base = ret.name = path.slice(startPart, end);
    }
  } else {
    ret.name = path.slice(startPart, startDot);
    ret.base = path.slice(startPart, end);
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0 && startPart !== rootEnd) ret.dir = path.slice(0, startPart - 1);
  else ret.dir = ret.root;
  return ret;
}

export const win32 = {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  dirname,
  basename,
  extname,
  format,
  parse,
  sep: "\\",
  delimiter: ";",
};
